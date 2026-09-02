# Packaging Valyria

`scripts/build.sh [gulp-target]` on each target OS. It:

1. builds `valyria-bridge-host` (release) for the host triple → `extension/bin/`;
2. copies a Core binary from `$VALYRIA_CORE_BIN` → `extension/bin/valyria`
   (built elsewhere from the `core.lock.json` rev, per triple);
3. compiles the extension;
4. runs the Code-OSS gulp bundler for the host platform;
5. runs the signing hooks **if** the relevant credentials are in the env.

## Sidecars

Both `valyria-bridge-host` and `valyria` ship inside the app as `externalBin`
resources. The extension resolves them via `context.extensionPath/bin/` (dev)
and the packaged resources `bin/` dir (release) — see
`extension/src/bridge/host.ts`. Model **weights are never bundled** and never
touched by an app update (§38); a release-gate test asserts the model store is
byte-identical across an upgrade.

## Per-OS gulp targets

| OS | target(s) |
|---|---|
| macOS | `vscode-darwin-arm64-min`, `vscode-darwin-x64-min`, then a universal merge |
| Windows | `vscode-win32-x64`, `vscode-win32-arm64` (+ inno-setup for the installer) |
| Linux | `vscode-linux-x64-min` + `-build-deb` / `-build-rpm`; AppImage / snap separately |

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
