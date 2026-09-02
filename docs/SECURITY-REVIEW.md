# Security & hardening review — Valyria extension

Phase 11 checklist. Automated items are gated in CI; manual items are signed off
per release.

## Process boundary

- [x] The extension host is a separate Node process from the renderer (Code‑OSS
  default). The Valyria extension adds no `nodeIntegration` to any webview.
- [x] The extension opens **no socket**. Core's Unix socket lives entirely
  inside `valyria-bridge-host`, a child process spoken to over stdio JSON‑RPC
  (`extension/src/bridge/host.ts`). — `xtask check-extension`
- [x] `valyria-bridge-host` depends only on `valyria-bridge`; `valyria-bridge`
  only on `valyria-protocol` / `valyria-types`. — `xtask check-layering`
- [x] The daemon outlives the UI and is per‑workspace; a crashed host is
  respawned with bounded backoff and re‑adopts the running daemon.

## Webviews

- [x] Every webview: `default-src 'none'`, a per‑resolve nonce gating the single
  `<script>`, styles/fonts/images limited to `webview.cspSource`,
  `localResourceRoots` = `out/webviews/` only. — `test/webview-html.test.ts`
- [x] Webviews hold no logic and issue no bridge calls directly — they render a
  view‑model and post typed intents; `makeWebviewDispatch` is the only path to
  a bridge call.
- [x] No `serious`/`critical` axe violations; no positive `tabindex`; native
  controls stay in the tab order. — `test/a11y.test.ts` (15 views)

## Secrets & network

- [x] No telemetry, no crash reporter, no marketplace — `product.overlay.json`
  clears every endpoint; gallery is Open VSX. — `scripts/verify-offline.sh`
- [x] The extension never downloads model weights; install/remove/activate call
  Core, which does it locally. A render test asserts no `http(s)://` in the
  Models DOM. — `test/phase6.test.ts`
- [x] No credential/token handling in the extension. Core's per‑instance auth
  token is generated and held by `valyria-bridge` (Rust), never surfaced.
- [ ] **Manual:** confirm a network‑namespaced launch (`unshare -n` / `pf`)
  reaches "ready" and completes the first‑run probe with zero outbound
  connections. (CI offline *integration* job — needs a real Core sidecar.)

## Errors (§36)

- [x] No banned generic error strings ("something went wrong", …). —
  `xtask check-extension`
- [x] User‑visible errors carry the underlying message, which includes the
  stable bridge `code` (`rpc::RpcError::bridge` puts it in `data`).
- [ ] **Manual:** every `showErrorMessage` / `showWarningMessage` call reads as
  an answer to §36's four questions (what happened · did the agent stop · is
  action needed · what next). 14 sites — reviewed per release.

## Trust

- [x] `capabilities.untrustedWorkspaces.supported = false`,
  `virtualWorkspaces.supported = false` — the extension declines to run in a
  restricted or virtual workspace rather than degrade silently.
- [x] Opening a repository is an explicit user act (`showOpenDialog` / an
  already‑open folder); it is the only path the agent reads or writes.

## Manual passes (per release)

- [ ] Screen‑reader walk (VoiceOver + NVDA) of the first‑run flow and each
  primary view.
- [ ] Keyboard‑only traversal of a full task: new task → approve → review diff →
  roll back, with no mouse.
- [ ] `axe` DevTools on the running webviews (real layout → catches contrast
  that jsdom can't).
