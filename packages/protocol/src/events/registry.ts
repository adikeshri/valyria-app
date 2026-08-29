// The event-payload decoder registry (docs/PLAN.md D5).
//
// Core's `WireEvent.payload` is schema-free by design (CORE-INTERFACE §1.G12):
// a field can be renamed under a *patch* bump. A naive `payload.tool_name` in a
// component fails silently — an empty cell, not an error.
//
// So every payload passes through a declared decoder here. Decoders are
// deliberately permissive: every field is optional and `.passthrough()` keeps
// unknown fields, so a real event is always typed and a renamed field degrades
// to "less informative" rather than "blank". A payload that is not even an
// object fails the decoder and the event still survives as
// `{ ok: false, reason, raw }`, which the Activity feed renders as a generic
// row with a raw-payload disclosure. Unknown `kind` values do the same.
//
// The set of `kind`s is gated: `KNOWN_EVENT_KINDS` here must equal
// `packages/protocol/schemas/event-kinds.txt` (a pinned copy of Core's
// `valyria_events::EventKind`), checked by `xtask check-protocol` and by
// `test/decoders.test.ts`.

import { z } from "zod";

/** The 21 event kinds `valyria_events::EventKind` emits today. Keep sorted and
 *  in sync with `schemas/event-kinds.txt`. */
export const KNOWN_EVENT_KINDS = [
  "approval_requested",
  "context_retrieved",
  "external_change_detected",
  "file_changed",
  "memory_written",
  "model_completed",
  "model_started",
  "plan_created",
  "progress_stalled",
  "resource_pressure",
  "state_changed",
  "task_completed",
  "task_failed",
  "task_paused",
  "task_started",
  "test_failed",
  "test_passed",
  "test_started",
  "tool_completed",
  "tool_started",
  "verification_evidence",
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

const s = z.string();
const anyObj = z.object({}).passthrough();

/** Per-kind payload decoders. Fields the UI reads, all optional, passthrough on
 *  the rest. Shapes verified against `fixtures/traces/` and CORE-INTERFACE §2. */
const PAYLOAD_DECODERS: Record<EventKind, z.ZodTypeAny> = {
  approval_requested: z
    .object({
      prompt: s.optional(),
      tool: s.optional(),
      category: s.optional(),
      target: s.optional(),
      risk: s.optional(),
    })
    .passthrough(),
  context_retrieved: z
    .object({
      items: z.array(z.unknown()).optional(),
      budget_used: z.number().optional(),
      budget_total: z.number().optional(),
    })
    .passthrough(),
  external_change_detected: z
    .object({ paths: z.array(s).optional() })
    .passthrough(),
  // `{ path, change }` normally; also reused for a completed rollback, whose
  // payload is `{ checkpoint_id, reverted }` — passthrough keeps both.
  file_changed: z
    .object({
      path: s.optional(),
      change: s.optional(),
      checkpoint_id: s.optional(),
      reverted: z.array(s).optional(),
    })
    .passthrough(),
  memory_written: anyObj,
  // `text` is model output — decoders type it, but selectors must never surface
  // it in the Activity narrative (§10).
  model_completed: z
    .object({ finish_reason: s.optional(), text: s.optional() })
    .passthrough(),
  model_started: z.object({ turn_index: z.number().optional() }).passthrough(),
  plan_created: z
    .object({ revision: z.number().optional(), steps: z.array(z.unknown()).optional() })
    .passthrough(),
  progress_stalled: z.object({ reason: s.optional() }).passthrough(),
  resource_pressure: anyObj,
  state_changed: z.object({ from: s.optional(), to: s.optional() }).passthrough(),
  task_completed: anyObj,
  task_failed: z.object({ reason: s.optional() }).passthrough(),
  task_paused: anyObj,
  task_started: z.object({ objective: s.optional() }).passthrough(),
  // `test_passed` / `test_failed` carry Core's VERIFY_RESULT payload verbatim
  // (valyria-agent driver.rs) — the same shape as `verification_evidence`.
  test_failed: z
    .object({
      command: s.optional(),
      passed: z.boolean().optional(),
      outcome: s.optional(),
      exit_code: z.number().optional(),
      failure_count: z.number().optional(),
      run_id: s.optional(),
      digest: s.optional(),
      summary: s.optional(),
    })
    .passthrough(),
  test_passed: z
    .object({
      command: s.optional(),
      passed: z.boolean().optional(),
      outcome: s.optional(),
      exit_code: z.number().optional(),
      failure_count: z.number().optional(),
      run_id: s.optional(),
      digest: s.optional(),
    })
    .passthrough(),
  // VERIFY effect issued: `{ command, kind, tier, rationale }`.
  test_started: z
    .object({
      command: s.optional(),
      kind: s.optional(),
      tier: s.optional(),
      rationale: s.optional(),
    })
    .passthrough(),
  tool_completed: z
    .object({
      tool: s.optional(),
      success: z.boolean().optional(),
      tool_invocation_id: s.optional(),
      rendered: s.optional(),
    })
    .passthrough(),
  tool_started: z
    .object({ tool: s.optional(), input: z.unknown().optional() })
    .passthrough(),
  verification_evidence: z
    .object({
      passed: z.boolean().optional(),
      command: s.optional(),
      kind: s.optional(),
      outcome: s.optional(),
      exit_code: z.number().optional(),
      failure_count: z.number().optional(),
      run_id: s.optional(),
      digest: s.optional(),
    })
    .passthrough(),
};

export function hasDecoder(kind: string): kind is EventKind {
  return Object.prototype.hasOwnProperty.call(PAYLOAD_DECODERS, kind);
}

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
    const r = raw as { kind?: unknown; seq?: unknown; ts_ms?: unknown };
    return {
      ok: false,
      reason: "bad_envelope",
      kind: typeof r?.kind === "string" ? r.kind : "?",
      seq: Number(r?.seq ?? -1),
      ts: Number(r?.ts_ms ?? 0),
      taskId: null,
      raw,
    };
  }
  const { kind, seq, ts_ms, task_id, payload } = env.data;
  const taskId = task_id ?? null;

  if (!hasDecoder(kind)) {
    return { ok: false, reason: "unknown_kind", kind, seq, ts: ts_ms, taskId, raw: payload };
  }

  const parsed = PAYLOAD_DECODERS[kind].safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: "bad_payload", kind, seq, ts: ts_ms, taskId, raw: payload };
  }

  return { ok: true, kind, seq, ts: ts_ms, taskId, payload: parsed.data };
}

/** Coverage: which kinds have a decoder tightened past `z.unknown()`.
 *  CI (`test/decoders.test.ts`) fails if any is `false` or if the kind set
 *  drifts from `schemas/event-kinds.txt`. */
export function coverageReport(): { kind: EventKind; tightened: boolean }[] {
  return KNOWN_EVENT_KINDS.map((kind) => ({
    kind,
    tightened: PAYLOAD_DECODERS[kind] !== undefined,
  }));
}
