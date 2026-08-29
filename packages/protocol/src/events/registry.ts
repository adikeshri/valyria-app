// The event-payload decoder registry (docs/PLAN.md D5).
//
// Core's `WireEvent.payload` is schema-free by design (CORE-INTERFACE §1.G12):
// a field can be renamed under a *patch* bump. A naive `payload.tool_name` in a
// component fails silently — an empty cell, not an error.
//
// So every payload passes through a declared decoder here. A decoder that fails
// does NOT drop the event: it yields `{ ok: false, ... raw }`, which the
// Activity feed renders as a generic row with a "raw payload" disclosure.
// Unknown `kind` values do the same. The UI degrades to "less informative",
// never to "blank" or "crashed".
//
// Increment 1: the 21 known kinds are registered with passthrough schemas.
// Tightening each `z.object({...})` against a captured trace fixture is Phase 2,
// gated by `coverageReport()` below.

import { z } from "zod";

/** The 21 event kinds `valyria_events::EventKind` emits today (CORE-INTERFACE §1). */
export const KNOWN_EVENT_KINDS = [
  "task_started",
  "plan_created",
  "context_retrieved",
  "model_started",
  "model_completed",
  "tool_started",
  "tool_completed",
  "file_changed",
  "test_started",
  "test_passed",
  "test_failed",
  "approval_requested",
  "task_paused",
  "task_completed",
  "task_failed",
  "state_changed",
  "progress_stalled",
  "external_change_detected",
  "verification_evidence",
  "memory_written",
  "resource_pressure",
] as const;

export type EventKind = (typeof KNOWN_EVENT_KINDS)[number];

/** The transport-level envelope, which IS stable (only `payload` is loose). */
export const wireEventEnvelope = z.object({
  kind: z.string(),
  seq: z.number().int().nonnegative(),
  ts_ms: z.number().nonnegative(),
  task_id: z.string().nullable().optional(),
  payload: z.unknown(),
});
export type WireEvent = z.infer<typeof wireEventEnvelope>;

/**
 * Per-kind payload decoders. Passthrough for now (`z.unknown()`), so nothing is
 * asserted about payload shape yet — but the registry exists, the coverage gate
 * can see it, and tightening one decoder is a localized change.
 *
 * When a decoder is tightened past `z.unknown()`, add its kind to `TIGHTENED`
 * so `coverageReport()` tracks progress without reaching into zod internals.
 */
const PAYLOAD_DECODERS: Record<EventKind, z.ZodTypeAny> = KNOWN_EVENT_KINDS.reduce(
  (acc, k) => {
    acc[k] = z.unknown();
    return acc;
  },
  {} as Record<EventKind, z.ZodTypeAny>,
);

const TIGHTENED = new Set<EventKind>();

export type DecodedEvent =
  | {
      ok: true;
      kind: EventKind;
      seq: number;
      ts: number;
      taskId: string | null;
      payload: unknown;
    }
  | {
      ok: false;
      reason: "unknown_kind" | "bad_envelope" | "bad_payload";
      kind: string;
      seq: number;
      ts: number;
      taskId: string | null;
      raw: unknown;
    };

/** Decode one wire event tolerantly. Never throws. */
export function decodeEvent(raw: unknown): DecodedEvent {
  const env = wireEventEnvelope.safeParse(raw);
  if (!env.success) {
    return {
      ok: false,
      reason: "bad_envelope",
      kind: typeof (raw as { kind?: unknown })?.kind === "string" ? (raw as { kind: string }).kind : "?",
      seq: Number((raw as { seq?: unknown })?.seq ?? -1),
      ts: Number((raw as { ts_ms?: unknown })?.ts_ms ?? 0),
      taskId: null,
      raw,
    };
  }
  const { kind, seq, ts_ms, task_id, payload } = env.data;
  const taskId = task_id ?? null;

  if (!(KNOWN_EVENT_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, reason: "unknown_kind", kind, seq, ts: ts_ms, taskId, raw: payload };
  }

  const decoder = PAYLOAD_DECODERS[kind as EventKind];
  const parsed = decoder.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: "bad_payload", kind, seq, ts: ts_ms, taskId, raw: payload };
  }

  return { ok: true, kind: kind as EventKind, seq, ts: ts_ms, taskId, payload: parsed.data };
}

/**
 * Coverage gate hook (docs/PLAN.md §7 "Contract"). CI compares
 * `KNOWN_EVENT_KINDS` against the kinds actually present in the schema export
 * and in captured traces, and fails when Core emits a kind with no decoder.
 */
export function coverageReport(): { kind: EventKind; tightened: boolean }[] {
  return KNOWN_EVENT_KINDS.map((kind) => ({ kind, tightened: TIGHTENED.has(kind) }));
}
