# Packaging Valyria

`scripts/build.sh [gulp-target]` on each target OS. It:

1. builds `valyria-bridge-host` (release) for the host triple → `extension/bin/`;
2. bundles a Core binary at `extension/bin/valyria[.exe]` — either already
   staged there (`.github/workflows/release.yml` downloads and
   checksum-verifies it from Core's GitHub Release before calling this
   script, per `core.lock.json`'s `release` block — see
   [RELEASING.md](RELEASING.md)) or supplied locally via `$VALYRIA_CORE_BIN`;
3. compiles the extension;
4. runs the Code-OSS gulp bundler for the host platform (an unpacked
   `VSCode-<platform>-<arch>/` app directory — `build.sh` itself stops here;
   `release.yml` does the final installer packaging below);
5. runs the signing hooks **if** the relevant credentials are in the env.

## Sidecars

Both `valyria-bridge-host` and `valyria` ship inside the app's `bin/`
resources. The extension resolves them via `context.extensionPath/bin/` (dev)
and the packaged resources `bin/` dir (release) — see
`extension/src/bridge/host.ts`. Model **weights are never bundled** and never
touched by an app update (§38); a release-gate test asserts the model store is
byte-identical across an upgrade.

## Per-OS gulp targets and installer packaging

`build.sh`'s gulp step produces an unpacked app directory per platform/arch;
`release.yml` wraps that into the actual distributable artifact using tooling
already vendored in the `vscode/` submodule:

| OS | gulp target(s) | installer artifact(s) |
|---|---|---|
| macOS (arm64, x64 — separately, no universal merge for v1) | `vscode-darwin-arm64-min`, `vscode-darwin-x64-min` | `.dmg` via the vendored `vscode/build/darwin/create-dmg.ts`; `.zip` via `ditto` (not plain `zip`, which corrupts `.app` bundles) as a fallback |
| Windows (x64) | `vscode-win32-x64-min` (build), then `vscode-win32-x64-user-setup` (already defined in `vscode/build/gulpfile.vscode.win32.ts`) | real Inno Setup `.exe` installer |
| Linux (x64) | `vscode-linux-x64-min` + `-build-deb` + `-build-rpm` | `.deb`, `.rpm`, plus a plain `.tar.gz` of the unpacked tree |

Every packaged artifact is checksummed (`sha256`) and checked against
`scripts/check-installer-size.sh`'s budget before upload.

## Signing (needs credentials — not in the repo)

| OS | mechanism | env the script reads |
|---|---|---|
| macOS | `codesign --options runtime` + `notarytool` + `stapler` | `MACOS_SIGN_IDENTITY`, `AC_*` notary creds |
| Windows | `signtool` with an EV cert; winget manifest | `WINDOWS_SIGN_PFX`, `WINDOWS_SIGN_PW` |
| Linux | detached GPG sig on the repo metadata | `LINUX_GPG_KEY` |

## Updates

`build/product.overlay.json` `updateUrl` points at the Valyria release feed
(empty in dev so a dev build never phones home). Core updates ship **only** with
an app update; release notes name the bundled Core rev.

## Windows tier 3 (G9)

`valyria-bridge-host` refuses `session/open` on Windows with
`bridge.platform.windows_tier3` and a link to CORE-INTERFACE G9. The installer
still lays down the app, the About / Compatibility view still reports every
version, and the extension shows the tier-3 banner. This is deliberate — a
Windows build that silently misbehaved would be worse.
