# Valyria App — desktop renderer (visual prototype)

This is the **renderer half** of `valyria-app`: a Vite + React + TypeScript
implementation of every primary surface in [docs/PLAN.md](../../docs/PLAN.md) —
Workspace Explorer, Agent Chat, Task Panel, Agent Activity, Timeline, Code
Viewer, Diff Viewer, Terminal, Git Changes, Model Manager, Hardware Status,
Approvals, Settings, Task History, Context Inspector, Verification Inspector,
and the First-Run wizard — running against realistic local sample data
(`src/data/mock.ts`), themed for light/dark/system.

**What's not here yet**, by design (see the parent [README](../../README.md)
and [docs/CORE-INTERFACE.md](../../docs/CORE-INTERFACE.md)): the Tauri native
shell, the Rust protocol bridge (`crates/valyria-bridge`), and any connection
to a real Core daemon. Every panel is built against the exact data shapes
Core's protocol will provide, so wiring it up is a data-source swap — the
`docs/PLAN.md` Phase 1 milestone — not a rebuild.

## Run it

**As a web page** (fastest iteration, hot reload):

```bash
npm install
npm run dev
```

**As a real native app**, in a Tauri-managed window (macOS/Windows/Linux — needs a stable
Rust toolchain via [rustup](https://rustup.rs); on macOS you also need Xcode Command Line
Tools, `xcode-select --install`):

```bash
npm install
npm run app:dev     # compiles the Rust shell, opens a native window against the Vite dev server
```

First run compiles the whole Tauri/WebView dependency tree (~1-2 min); after that it's
fast. The window opens at 1440×900 (1024×640 minimum) with the Valyria icon, title, and
dock/taskbar entry — this is the actual desktop app, not a browser tab.

**To build an installer** (`.app`/`.dmg` on macOS, `.msi`/`.exe` on Windows, `.deb`/`.AppImage`
on Linux — each platform builds only its own installers, so run this on each target OS, or in
CI per-platform):

```bash
npm run app:build
```

Output lands in `src-tauri/target/release/bundle/`.

The native shell lives in [src-tauri/](src-tauri) — a thin Rust/Tauri wrapper (window config,
icons, bundler) with no app logic in it yet. `npm run tauri -- <command>` reaches the Tauri
CLI directly for anything not covered by the two scripts above (`icon`, `signer`, etc).

## What to look at

- **Agent tab** — chat, an inline approval card (Allow Once / Allow for Task /
  Deny), a live "working" indicator.
- **Task tab** — objective, plan with checkpoints, modified files with
  ownership badges, verification evidence, permissions.
- **Dock** (bottom) — Activity, Timeline (raw event inspector), Diff (real
  line-level diffing via the `diff` package), Tests (grouped by outcome, with
  stack traces), Terminal (a real `xterm.js` instance for your shell, kept
  visually and structurally separate from the read-only Agent Commands view —
  see PLAN §D7).
- **Right rail** — Context Inspector (provenance with trust level and token
  budget), a Symbols stub demonstrating the "honestly disabled" pattern
  (PLAN §D6), Verification.
- **⌘K** — command palette, keyboard-navigable.
- **Settings** (gear icon) — Agent autonomy control, Models, Security overview,
  Repository, Application — each field shows its origin the way `config_show`
  would report it.
- **Replay first-run experience** (via ⌘K) — the full onboarding wizard.
