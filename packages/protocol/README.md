# @valyria/protocol

TypeScript view of Core's wire contract, generated from vendored schemas.

## Layout

| Path | What |
|---|---|
| `schemas/` | Core's JSON schemas, vendored verbatim: `request.schema.json`, `response.schema.json`, `event.schema.json`, `version.txt`, `event-kinds.txt`, and `events/<kind>.schema.json` per-kind payload contracts. Pinned to the Core revision in the repo-root `core.lock.json`. |
| `src/generated/` | `request.ts` / `response.ts` / `event.ts` / `version.ts` — produced by `scripts/codegen.mjs` from `schemas/`. Committed; CI fails if they drift. |
| `src/capabilities.ts` | The known capability tokens and the surface → capability map the renderer gates UI on (never on a version string). |
| `src/events/registry.ts` | Per-`kind` payload **decoders**. Core's `payload` is schema-free by design, so every event passes through a tolerant zod decoder here — a renamed field degrades to "less informative", never a blank cell or a throw. |
| `compatVerdict(...)` | CORE-INTERFACE §4's compatibility table as a pure function. |

## Regenerate after a Core bump

```bash
# re-vendor from a sibling ../valyria checkout at the pinned rev, then:
npm run codegen -w @valyria/protocol
npm test -w @valyria/protocol
```

`xtask check-protocol` (a repo gate) checks the vendored schemas, the event-kind
list, and every per-kind payload contract byte-for-byte against `../valyria`.
