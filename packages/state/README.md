# @valyria/state

The projection layer: a pure reducer plus selectors that fold Core's event
stream into a normalized store. Nothing here is authoritative — the whole store
rebuilds by replaying from `seq = 0`, which is what makes crash recovery a
property the tests check against recorded traces rather than a hope.

## Contents

| File | What |
|---|---|
| `store.ts` | The normalized shape: `tasks`, `plans`, `approvals`, per-task `files` / `tests`, the append-only `events` array, and the contiguity cursor. |
| `reducer.ts` | `applyBatch` / `applyDecoded` — synchronous, no `Date.now()`, no side effects. Idempotent on replay (a re-delivered `seq` is ignored). |
| `selectors.ts` | Pure reads: `tasksByRecency`, `changedFilesForTask`, `testResultsForTask`, `agentCommandsForTask`, `checkpointIdsForTask`, `pendingApprovalFor`, `activityLine`, … Sorted on `seq`, never wall clock. |

## Test

```bash
npm test -w @valyria/state   # replay traces from ../../fixtures/traces/
```
