//! The event pump (docs/PLAN.md §4.3).
//!
//! Holds **one** long-lived `events_subscribe` connection per workspace, off
//! the UI thread. Events are coalesced into batches (~16ms window) carrying
//! `first_seq` / `last_seq` so the consumer can assert contiguity; on a gap or
//! a dropped stream the pump re-subscribes from the last applied `seq` rather
//! than guessing (Core replays from its journal — CORE-INTERFACE §1).

use std::path::PathBuf;
use std::time::Duration;

use futures::StreamExt;
use tokio::sync::mpsc;
use valyria_protocol::WireEvent;

use crate::client::CoreClient;

/// Coalescing window. A burst of thousands of events becomes a handful of
/// batches instead of thousands of channel sends / renders.
const COALESCE_WINDOW: Duration = Duration::from_millis(16);
/// Hard cap on a single batch, so a sustained firehose still yields regularly.
const MAX_BATCH: usize = 512;
/// Reconnect backoff bounds when the stream drops but Core may still be up.
const RECONNECT_MIN: Duration = Duration::from_millis(100);
const RECONNECT_MAX: Duration = Duration::from_secs(2);
const RECONNECT_ATTEMPTS: u32 = 5;

#[derive(Debug, Clone, serde::Serialize)]
pub struct EventBatch {
    pub first_seq: u64,
    pub last_seq: u64,
    pub events: Vec<WireEvent>,
    /// True when `first_seq` is not exactly one past the previously delivered
    /// `last_seq` — a hole. Only ever set once at least one batch has been
    /// delivered, or when the pump was started at an explicit resume cursor
    /// (`since > 0`) and Core's first event is not that cursor. The pump has
    /// already re-subscribed to backfill; this flags it for the reducer's
    /// `gapDetected` (docs/PLAN.md §2).
    pub gap_before: bool,
}

#[derive(Debug)]
pub enum PumpMessage {
    Batch(EventBatch),
    /// The subscription dropped and was re-established from `from`.
    Reconnected {
        from: u64,
    },
    /// The stream ended and could not be re-established (daemon likely gone).
    /// The session owner decides whether to restart the daemon.
    Closed {
        last_seq: u64,
    },
}

pub struct EventPump {
    rx: mpsc::Receiver<PumpMessage>,
    handle: tokio::task::JoinHandle<()>,
}

impl EventPump {
    /// Start pumping the full workspace stream. `applied_through` is the last
    /// `seq` the consumer has already applied — `0` for a full replay from the
    /// journal, or the reducer's `lastSeq` to resume after a UI restart. Core's
    /// `since` cursor is exclusive (`seq > since`), so this value is passed
    /// through as-is.
    ///
    /// `auth_token` is the daemon's per-instance client-auth token (G10) — pass
    /// `Session::auth_token`.
    pub fn start(socket_path: PathBuf, auth_token: Option<String>, applied_through: u64) -> Self {
        Self::start_scoped(socket_path, auth_token, applied_through, None)
    }

    /// Start pumping only one task's events plus workspace-global (task-less)
    /// ones (CORE-INTERFACE G11). The main desktop session does **not** use
    /// this — it needs the full, seq-contiguous stream for crash recovery
    /// (docs/PLAN.md D3). It backs a scoped consumer that does not (a detached
    /// single-task view), and is covered by `tests/stream_filter.rs`.
    pub fn start_scoped(
        socket_path: PathBuf,
        auth_token: Option<String>,
        applied_through: u64,
        task_id: Option<String>,
    ) -> Self {
        let (tx, rx) = mpsc::channel(64);
        let handle = tokio::spawn(pump_loop(
            socket_path,
            auth_token,
            task_id,
            applied_through,
            tx,
        ));
        Self { rx, handle }
    }

    pub async fn recv(&mut self) -> Option<PumpMessage> {
        self.rx.recv().await
    }

    pub fn abort(self) {
        self.handle.abort();
    }
}

impl Drop for EventPump {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

async fn pump_loop(
    socket_path: PathBuf,
    auth_token: Option<String>,
    task_id: Option<String>,
    applied_through: u64,
    tx: mpsc::Sender<PumpMessage>,
) {
    let client = CoreClient::with_token(socket_path, auth_token);

    // The last seq delivered to the consumer. Core's `since` is exclusive
    // (`seq > since`), so this doubles as the resubscribe cursor. `0` means
    // nothing applied yet — Core replays from its first event.
    let mut delivered_last: u64 = applied_through;
    let mut first_connect = true;

    loop {
        let mut stream = client
            .subscribe_for_task(delivered_last, task_id.clone())
            .await;

        if !first_connect
            && tx
                .send(PumpMessage::Reconnected {
                    from: delivered_last,
                })
                .await
                .is_err()
        {
            return;
        }
        first_connect = false;

        loop {
            match collect(&mut stream, delivered_last + 1).await {
                Collected::Events(events) => {
                    let first_seq = events.first().map(|e| e.seq).unwrap();
                    let last_seq = events.last().map(|e| e.seq).unwrap();
                    let gap_before = first_seq != delivered_last + 1;
                    delivered_last = last_seq;
                    let batch = EventBatch {
                        first_seq,
                        last_seq,
                        events,
                        gap_before,
                    };
                    if tx.send(PumpMessage::Batch(batch)).await.is_err() {
                        return; // consumer gone
                    }
                }
                Collected::Idle => {}
                Collected::StreamEnded => break,
            }
        }

        // Stream ended. Try to re-establish; if every attempt fails the daemon
        // is probably gone — tell the owner and stop.
        if !reconnect(&client, delivered_last, task_id.clone()).await {
            let _ = tx
                .send(PumpMessage::Closed {
                    last_seq: delivered_last,
                })
                .await;
            return;
        }
    }
}

enum Collected {
    Events(Vec<WireEvent>),
    Idle,
    StreamEnded,
}

/// Pull events for up to `COALESCE_WINDOW`, or until `MAX_BATCH`. Drops
/// anything below `min_wanted` (Core replays `since` inclusively on resume).
/// Returns `StreamEnded` only if the first `next()` yields `None`.
async fn collect(
    stream: &mut futures::stream::BoxStream<'static, WireEvent>,
    min_wanted: u64,
) -> Collected {
    let deadline = tokio::time::Instant::now() + COALESCE_WINDOW;
    let mut events: Vec<WireEvent> = Vec::new();

    match stream.next().await {
        None => return Collected::StreamEnded,
        Some(ev) => events.push(ev),
    }
    while events.len() < MAX_BATCH {
        match tokio::time::timeout_at(deadline, stream.next()).await {
            Ok(Some(ev)) => events.push(ev),
            Ok(None) => break, // stream ended mid-batch; deliver what we have
            Err(_) => break,   // window elapsed
        }
    }

    events.retain(|e| e.seq >= min_wanted);
    if events.is_empty() {
        return Collected::Idle;
    }
    events.sort_by_key(|e| e.seq);
    events.dedup_by_key(|e| e.seq);
    Collected::Events(events)
}

async fn reconnect(client: &CoreClient, cursor: u64, task_id: Option<String>) -> bool {
    let mut delay = RECONNECT_MIN;
    for _ in 0..RECONNECT_ATTEMPTS {
        tokio::time::sleep(delay).await;
        let mut probe = client.subscribe_for_task(cursor, task_id.clone()).await;
        match tokio::time::timeout(Duration::from_millis(200), probe.next()).await {
            Ok(Some(_)) => return true, // got an event
            Ok(None) => {}              // closed again → keep trying
            Err(_) => return true,      // open, just quiet
        }
        delay = (delay * 2).min(RECONNECT_MAX);
    }
    false
}
