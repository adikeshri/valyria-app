# Releasing Valyria App

How a `v*` release is cut, and the gates that must pass first. Companion to
[INTEGRATION.md §7](INTEGRATION.md) (the build pipeline) and
[PLAN.md §8 / §9](PLAN.md) (Phase 8 exit criteria and performance budgets).

## Pipeline

`.github/workflows/release.yml`, one matrix job per target
(`aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`,
`x86_64-pc-windows-msvc`):

1. Checkout the app; checkout Core at `core_ref` (`pinned` reads
   `core.lock.json`'s `git_rev`); record the resolved SHA.
2. Build `valyria` from Core for the target; stage it at
   `apps/desktop/src-tauri/binaries/valyria-<triple>`.
3. Write `src-tauri/core-provenance.json` (bundled as an app resource — the
   About surface reads it).
4. `tauri-action` runs `tauri build --config src-tauri/tauri.release.conf.json`,
   which merges in `bundle.externalBin` + the provenance resource.
5. **Bundle-size gate** — every installer must be < 120 MB (PLAN §9). Enforced in
   CI.
6. On a `v*` tag: a **draft** GitHub Release with installers +, when
   `TAURI_SIGNING_PRIVATE_KEY` is set, `latest.json` + `.sig` (the updater feed).
   Manual dispatch keeps installers as workflow artifacts only.

## Required repository secrets

| Secret | Purpose | Without it |
|---|---|---|
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | macOS codesign + notarization | macOS builds are unsigned; Gatekeeper warns |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | sign updater artifacts against `tauri.conf.json` `plugins.updater.pubkey` | no `latest.json`/`.sig`; the in-app updater finds nothing to install |

The updater **public** key is committed in
`apps/desktop/src-tauri/tauri.conf.json`. Generate a keypair with
`npx tauri signer generate`; keep the private key out of the repo.

`SECURITY.md` reporting relies on **GitHub private vulnerability reporting** —
enable it in repo *Settings → Code security and analysis*.

## Pre-release checklist

Run before tagging. The first three are the gates INTEGRATION §7 tracked as "not
yet wired"; two are manual QA because a literal test needs two installer
versions.

- [ ] `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --locked
      -- -D warnings`, `cargo test --workspace --locked`, `cargo run -q -p xtask
      -- all` — all green on `main`/the release branch.
- [ ] `npm run codegen && git diff --exit-code packages/protocol/src/generated`,
      `npm run typecheck`, `npm test`, `npm run lint -w desktop`,
      `npm run build -w desktop`.
- [ ] `core.lock.json` `git_rev` matches the Core revision the pipeline will
      build (`core_ref: pinned`), and the bundled sidecar's
      `core-provenance.json` `core_sha` will equal it.
- [ ] **Fresh-install proof-of-life**, per tier-1 OS (macOS aarch64, Linux
      x86_64): install the built artifact on a machine with no `~/.valyria`,
      launch, open a repository, confirm the first-run flow reaches "Runtime
      verified" (a harmless fake-model task completes end to end).
- [ ] **Model store byte-identical across upgrade.** On a machine with at least
      one real model installed:
      1. `find ~/.valyria/models -type f -print0 | sort -z | xargs -0 shasum -a 256 > /tmp/before.sha`
      2. install the new version over the old (or run the in-app updater).
      3. `find ~/.valyria/models -type f -print0 | sort -z | xargs -0 shasum -a 256 > /tmp/after.sha`
      4. `diff /tmp/before.sha /tmp/after.sha` — must be empty.
      The mechanism is already enforced (`xtask check-layering` bars a downloader
      crate; no fetch path exists — INTEGRATION D-INT-3); this is the
      confirmation.
- [ ] **Bundle size** < 120 MB per platform — also gated in CI, but eyeball the
      draft release's attached files.
- [ ] **Compatibility hard block** still works: point `VALYRIA_BIN` at a Core
      that reports a different protocol *major* (or bump `EXPECTED_PROTOCOL`
      locally) → opening a workspace routes to *About & Compatibility* with the
      blocker banner naming both versions. Restore before tagging.
- [ ] **Windows** installer runs, opens *About & Compatibility*, shows version +
      "Sessions: not available on this platform", and a workspace-open attempt
      surfaces `[bridge.platform.unsupported]` — no 20-second hang.
- [ ] **Accessibility manual pass** — run the checklist in
      [ACCESSIBILITY.md](ACCESSIBILITY.md) (axe DevTools per route, keyboard-only
      traversal, a screen-reader pass, reduced-motion, 200% zoom). Record OS / SR
      / findings in the release notes. The structural invariants are already
      gated by `xtask check-a11y` + `check-error-strings`.
- [ ] **Visual regression** — on each tier-1 OS (macOS aarch64, Linux x86_64):
      screenshot every route (workspace, Settings, About, First-run, command
      palette) in **light and dark**, and eyeball-diff against the previous
      release's set. D11's WebView renders differently per platform, so this is
      per-OS. Keep the reference screenshots with the release.
- [ ] **Performance budgets (§9)** — spot-check against the table below.

### Performance budgets (§9) and how each is checked

| Budget | Target | Check |
|---|---|---|
| Event ingest sustained | 5,000 events/s, no dropped frames | `packages/state/test/phase9.test.ts` (one 512-event pump batch folds < 40ms while a task runs) + `crates/valyria-bridge/tests/soak.rs` for real frame pacing |
| Workspace open → explorer usable, 100k files | < 2s | `apps/desktop/src/core/tree.test.ts` bounds the pure flatten; time the real open manually on a large repo |
| Diff render, 10,000-line file | < 150ms | `apps/desktop/src/core/diffstat.test.ts` bounds the pure line count; time the CodeMirror render manually |
| Keystroke → render, chat input | < 16ms | manual — type in the chat box, no perceptible lag |
| Cold start → interactive / → Ready | < 1.5s / < 3s | manual — stopwatch a cold launch and a workspace open |
| Idle memory, one workspace | < 400MB (excl. Core) | manual — Activity Monitor / `ps` after 5 min idle |
| Read-only surfaces usable through a long task | — | `crates/valyria-bridge/tests/soak.rs` (self-skips without a Core binary) |

## Cutting the release

1. Bump `version` in `apps/desktop/src-tauri/tauri.conf.json` and
   `apps/desktop/src-tauri/Cargo.toml` (keep them equal).
2. Commit, `git tag vX.Y.Z`, `git push --tags`.
3. The workflow drafts a Release. Review the attached installers, signing status,
   and (if configured) `latest.json`.
4. Publish the Release. The updater endpoint
   (`releases/latest/download/latest.json`) then serves it to installed apps.
