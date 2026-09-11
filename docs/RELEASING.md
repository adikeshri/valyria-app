# Releasing Valyria App

How a `v*` release is cut, and the gates that must pass first. This app's
release depends on a **separate** release in the sibling `valyria` (Core)
repo — see [Core binary](#core-binary) below and
`valyria`'s own `docs/RELEASING.md`.

## Pipeline

`.github/workflows/release.yml`, triggered by `push: tags: ["v*"]` or
`workflow_dispatch` with a `tag` input (never creates/pushes a tag itself).

1. **`check`** — asserts every version field agrees with the pushed tag
   (`xtask check-versions`, see [Versioning](#versioning)) and that
   `core.lock.json`'s pinned Core release really exists and resolves to the
   pinned `git_rev` (`xtask verify-core-release`). Fails fast, before any
   build.
2. **`build`**, one job per target (`aarch64-apple-darwin`,
   `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`,
   `x86_64-pc-windows-msvc`), `fail-fast: false`:
   1. Checkout (incl. the `vscode/` submodule), `scripts/bootstrap.sh`.
   2. **Download + checksum-verify** the Core binary for this platform from
      `core.lock.json`'s `release` block (see [Core binary](#core-binary))
      into `extension/bin/valyria[.exe]`.
   3. Build `valyria-bridge-host`, compile the extension, run the branded
      Code-OSS gulp build (`scripts/build.sh`), then wrap the result into a
      real installer per OS — see [PACKAGING.md](PACKAGING.md) for the exact
      tooling (`create-dmg.ts`, the Inno Setup gulp task, `-build-deb`/
      `-build-rpm`).
   4. Checksum every packaged artifact; check
      `scripts/check-installer-size.sh`'s budget.
3. **`publish`** — assembles `SHA256SUMS`, writes `core-provenance.json`
   (the bundled Core release tag/rev — the in-app About surface reads it),
   and opens a **draft** GitHub Release with every platform's artifacts. Draft,
   not published automatically: several checklist items below are inherently
   manual, and every artifact is unsigned for now (see
   [Signing](#signing)) — a maintainer reviews and publishes by hand.

## Core binary

`valyria-app` does not build Core from source in its own pipeline. It
downloads a **prebuilt** `valyria` binary from a release already cut in the
sibling `valyria` repo, and verifies it against a pinned checksum before
bundling it — see `core.lock.json`'s `release` block:

```jsonc
"release": {
  "repository": "https://github.com/adikeshri/valyria.git",
  "tag": "v0.2.0",
  "artifacts": {
    "aarch64-apple-darwin": { "asset": "valyria-0.2.0-aarch64-apple-darwin", "sha256": "…" },
    // ...one entry per target triple
  }
}
```

`release.tag` must resolve (`git ls-remote`) to the same commit as
`core.lock.json`'s top-level `git_rev` — the field that pins the
`valyria-protocol`/`valyria-types` compile-time git dependencies. `xtask
verify-core` checks the `release` block's shape offline, on every PR; `xtask
verify-core-release` checks the tag actually resolves to `git_rev` over the
network, in `release.yml` only (never `ci.yml`). Bumping the Core pin is one
PR that updates `git_rev`/`protocol_version` (the existing flow) **and**
`release.tag` + all four `sha256` values together.

**No Core release has been cut yet** — `core.lock.json`'s `release` block
currently carries placeholder values (an unreachable tag, all-zero
checksums) so the offline shape check passes while `verify-core-release`
correctly fails until a real Core release exists. See the rollout order
below.

## Signing

**Unsigned today** — no `MACOS_SIGN_IDENTITY` / `WINDOWS_SIGN_PFX` secrets
are configured, so `scripts/build.sh`'s codesign/notarize/signtool hooks are
no-ops, matching Core's own release pipeline. Every release's notes say so
explicitly. See [PACKAGING.md §Signing](PACKAGING.md) for what activating
this later needs.

`SECURITY.md` reporting relies on **GitHub private vulnerability reporting** —
enable it in repo *Settings → Code security and analysis*.

## Versioning

`scripts/sync-version.mjs <version>` is the **only** thing that should write
`package.json`'s `version` (root, `extension/`, `chrome/`, `theme/`,
`packages/protocol/`, `packages/state/`) or `Cargo.toml`'s
`[workspace.package] version` — `xtask check-versions` asserts they all agree
on every PR. Tag format is plain `vX.Y.Z` (independent of Core's own version —
cross-repo traceability is `core.lock.json`'s `release` block plus
`core-provenance.json`, not matching version numbers), with `-rc.N`/`-alpha.N`
suffixes publishing as a GitHub prerelease instead of a full release.

## Bootstrapping this pipeline (no release has ever been cut)

1. Land Core's `release.yml` on Core's `main`, cut a disposable prerelease
   there (e.g. `v0.0.1-pipeline-test.1`) to prove Core's pipeline end to end
   — see `valyria`'s `docs/RELEASING.md`.
2. Point this repo's `core.lock.json` `release` block at that prerelease on a
   branch (not `main`) and confirm `xtask verify-core-release` passes.
3. Trigger this repo's `release.yml` via `workflow_dispatch` with a throwaway
   tag on that branch — proves the download+verify step, the cross-arch gulp
   build, and the new dmg/deb/rpm/Inno-Setup packaging all work, without
   touching `main` or real version numbers. Use the run to sanity-check
   `scripts/check-installer-size.sh`'s 120 MB placeholder budget against a
   real artifact and adjust it if unrealistic.
4. Only once both dry runs are clean: cut a real first Core release, point
   `core.lock.json` at it for real, merge to `main`. The first real
   `valyria-app` tag also goes through `workflow_dispatch` once before ever
   relying on a plain `push: tags:` cut.

## Pre-release checklist

Run before tagging. Gates marked with a script are enforced in CI; the rest
are manual QA a literal test can't automate (screen readers, visual diffing,
two installer versions side by side).

- [ ] `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --locked
      -- -D warnings`, `cargo test --workspace --locked`, `cargo run -q -p xtask
      -- all` — all green on `main`/the release branch.
- [ ] `npm run codegen && git diff --exit-code packages/protocol/src/generated`,
      `npm run typecheck`, `npm test` (root — the `packages/*` workspaces), and
      in `extension/`: `npm run check`, `npm test`,
      `bash scripts/check-bundle-size.sh`.
- [ ] `core.lock.json`'s `release.tag` names a real, already-published Core
      release, `xtask verify-core-release` passes, and the bundled sidecar's
      `core-provenance.json` will show the matching Core tag/rev.
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
- [ ] **Offline (§32)** — after a warm `cargo fetch --locked` + `npm ci`, cut
      outbound network and confirm the unit / pure / build layers need nothing
      more:
      ```sh
      cargo fetch --locked && npm ci && (cd extension && npm ci)
      sudo iptables -A OUTPUT -o lo -j ACCEPT && sudo iptables -A INPUT -i lo -j ACCEPT && sudo iptables -P OUTPUT DROP
      npm test && (cd extension && npm run compile) && cargo test --workspace --offline --locked && cargo run -q -p xtask -- all
      sudo iptables -P OUTPUT ACCEPT   # restore
      ```
      This was a CI job; it hung ~45 min on every hosted-runner attempt (cause
      never visible — killed-job logs 404) and was removed. `xtask check-layering`
      still bars any downloader crate, so no fetch path can regress in silently.
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
      / findings in the release notes. `xtask check-extension` gates the banned
      generic-error-string invariant (§36); it does not check accessibility
      structure, so this pass stays manual.
- [ ] **Visual regression** — on each tier-1 OS (macOS aarch64, Linux x86_64):
      screenshot every route (workspace, Settings, About, First-run, command
      palette) in **light and dark**, and eyeball-diff against the previous
      release's set. D11's WebView renders differently per platform, so this is
      per-OS. Keep the reference screenshots with the release.
- [ ] **Performance budgets (§9)** — spot-check against the table below.

### Performance budgets (§9) and how each is checked

> The two `apps/desktop/...` test paths below predate the Tauri→Code-OSS
> migration and were not re-verified as part of standing up this release
> pipeline — confirm they still exist (or find their Code-OSS-era
> equivalent) before relying on them.

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

1. `node scripts/sync-version.mjs X.Y.Z`; commit.
2. `git tag vX.Y.Z && git push origin main --tags`.
3. Watch the Actions run (`gh run watch`). A clean run means: 4 green `build`
   legs, then `publish` opening a **draft** release at
   `github.com/adikeshri/valyria-app/releases` with every platform's
   installer, checksums, and `core-provenance.json`.
4. Work through the [pre-release checklist](#pre-release-checklist) against
   the draft's artifacts (several items are manual QA the pipeline can't do).
5. Publish the release by hand.

In-app auto-update (pointing `build/product.overlay.json`'s empty
`updateUrl` at this release feed) is not wired yet — a known follow-up, not
part of this pipeline.
