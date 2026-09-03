# Valyria App — UX & editor identity

> How valyria-app stops reading as "a VS Code fork" **without forking the
> editor**. Everything here is reachable from the extension API,
> `configurationDefaults`, and two code-free built-ins — no new
> `build/patches/` entries (the doctrine in
> [ARCHITECTURE-VSCODE.md](ARCHITECTURE-VSCODE.md) §2 still holds).

Companion to [ARCHITECTURE-VSCODE.md](ARCHITECTURE-VSCODE.md) (topology, process
model, branding) and [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) (phase
status — this work is **Phase 12**).

## Constraints this was built to

| Decision | Value |
|---|---|
| Divergence from upstream | **Config + extension API only.** No new patches; the 3 branding patches are unchanged. |
| Audience | **Both, staged.** Familiar first; Valyria-native is opt-in, then the default for fresh installs. |
| Centre of gravity | **Dual-mode.** A per-workspace switch between an agent-driven layout and a traditional editor layout, sharing the same panels. |

## North star

1. **The task is the document.** The primary thing on screen is a Valyria task —
   its plan, edits, verification — not a file tree. Files are what you drill into.
2. **One identity, edge to edge.** Every glyph, accent, and string in the frame
   is Valyria's.
3. **The frame narrates.** The status bar continuously says what the agent is
   doing. A stationary chrome is a VS Code tell.
4. **Familiar is a setting, not the foundation.** Migrators get VS Code muscle
   memory by choosing Editor layout; the product's centre of gravity, and
   eventually its default, is the agent.

---

## Lever A — visual identity

The code-free **`chrome/`** built-in (`valyria-chrome`, same "no `main` ⇒
survives untrusted workspaces" trick as `theme/`):

- **Product icon theme** (`valyria`) — replaces the workbench codicon set with a
  solid geometric Valyria family: tree twisties, window / tab chrome, action and
  status glyphs, the activity-bar view icons. Built by
  [`chrome/tools/build_icons.py`](../chrome/tools/build_icons.py) from
  primitives (rect / polygon / disc / ring) in font units into a deterministic
  WOFF — no hand-authored SVG, so the family stays consistent. Undefined icons
  fall back to the stock codicon. `chrome/dist/` is committed;
  `scripts/check-chrome-icons.mjs` gates its coherence in CI.
- **File icon theme** (`valyria-files`) — **stock Seti file icons** (vendored
  MIT copy, `chrome/vendor/seti/`) with only the **folder** icons swapped for
  Valyria's rust folders. Language icons (Dockerfile, Python, `.env`, …) are
  something people rely on recognising, so they are left exactly as Seti draws
  them; the build injects `folder` / `folderExpanded` / `rootFolder*` and nothing
  else.
- **Colour** — the existing `theme/` (`Valyria Dark / Light / High Contrast`
  family, rust / dragon-fire) already carries a distinct palette; unchanged.
- **Status-bar voice** — see lever E.

## Lever B — chrome defaults

`chrome/`'s `configurationDefaults` (user-overridable, never locked):

```
window.commandCenter              false        # no title-bar command dropdown
window.menuBarVisibility          compact      # no full menu strip
window.titleSeparator             "  —  "
workbench.layoutControl.enabled   false        # no layout-control button
workbench.startupEditor           none         # the extension opens Valyria Home instead
workbench.editor.empty.hint       hidden       # no "Show All Commands" empty-editor hint
workbench.tree.indent             14
workbench.editor.tabActionCloseVisibility  true
explorer.compactFolders           false
+ workbench.productIconTheme / workbench.iconTheme -> the two themes above
```

These hold in untrusted workspaces and before the agent extension loads, because
the built-in is code-free.

## Lever C — dual-mode layout

`extension/src/session/layout.ts` (`LayoutController`) + the pure bundles in
`layoutBundles.ts`.

- **`agent`** — activity bar hidden, single editor tabs, editor actions hidden,
  breadcrumbs off, compact tab height, panel bottom. Navigation is driven from
  the Valyria surfaces.
- **`editor`** — activity bar on the side, multiple tabs, breadcrumbs on: a
  faithful VS Code-shaped layout for muscle memory.

A mode is a bundle of `workbench.*` / `window.*` settings applied at the
**Workspace** target (a user's Global settings are never rewritten) plus
`setContext('valyria.layoutMode', …)`. Only keys that genuinely differ between
the two layouts live in the bundles; the static identity defaults are lever B.
Switching is symmetric — a key present in one bundle but not the other is
cleared back to the user/default (`resolveLayoutSettings`).

- **Persistence** — the last explicit choice is remembered per workspace
  (`workspaceState`); a fresh workspace starts at `valyria.layout.defaultMode`.
  The `workbench.*` bundle is written only *after* an explicit choice (the
  toggle, a palette command, or first-run) — opening a repo on the default
  never drops a `.vscode/settings.json` it did not ask for; it just gets the
  `valyria.layoutMode` context.
- **`valyria.layout.applyWorkbenchDefaults`** (default `true`) — turn off to keep
  full manual control of the chrome; the mode context still drives the surfaces.
- **Controls** — status-bar item, `valyria.layout.toggleMode`
  (`⌘K ⌘L`), palette entries, and the first-run step.
- **Staged defaults** — ships at `defaultMode: "editor"`; a later release flips
  fresh installs to `"agent"` (existing choices preserved).

## Lever D — agent-as-editor surfaces

`extension/src/views/editorPanels.ts` (`EditorPanelManager`) — singleton
`WebviewPanel`s in the editor area, where a fork puts a file. Same pure selectors
as the sidebar views (`store/models.ts`).

| Surface | Command | What it is |
|---|---|---|
| **Home** | `valyria.openHome` (`⌘K ⌘H`) | The tab you land on (replaces the Welcome page): a task prompt, active + recent tasks, the runtime marker, the layout switch. Opened on activate in Agent layout, or whenever no folder is open, unless the window restored editors. |
| **Task Workspace** | `valyria.openWorkspacePanel` | The focused task as one document: conversation, plan, changed files (with ledger ownership), tests, verification, pending approval. |
| **Review Changes** | `valyria.reviewChanges` (`⌘K ⌘R`) | Agent-authored changes framed for approval; each row runs `git.openChange` into the editor's own diff. Ownership + `NOT RUN` come from Core (ledger + `task_report`) — never inferred. |

In Agent layout a surface owns editor column one, so files and diffs opened from
it land **beside** it as a detail pane (`dispatch.ts` `fileColumn()`).

**Custom document viewer** (`valyria.document`) — markdown / JSON under a
`.valyria` directory open to a Valyria-rendered view with a one-click "Open raw".
`priority: "default"`, scoped to that glob only.

## Lever E — interaction identity

- **Status-bar agent ticker** (`status.ts` + `tickerModel`) — a live phase read
  of the focused task: `Planning` → `Running cargo test` → `Editing 3 files` →
  `Blocked: approval` → `Verifying` → `Task done`. Pure projection of the event
  tail, no clock. Click → Task Workspace. Plus a one-click layout-mode item.
- **Keybindings** (additive, migrator-safe) — `⌘I` summon the task prompt from
  anywhere, `⌘K ⌘H` Home, `⌘K ⌘R` Review, `⌘K ⌘L` switch layout.
- **Command palette** — task verbs: "Valyria: Start a Task", "Review Changes",
  "Open Home", "Explain This Failure", "Use Agent Layout". Task-scoped entries
  are gated on `valyria.hasSession`.

## De-Microsoft: the bundled Copilot

Code-OSS 1.135 ships **GitHub Copilot chat** as a compiled-in built-in
(`vscode/extensions/copilot`) and wires it as `product.json`'s
`defaultChatAgent` — a "Build with Agent / Sign in" panel that both reads as a
fork tell and competes with the Valyria agent.

`scripts/bootstrap.sh` **removes the extension directory** (Code-OSS
folder-scans `extensions/` at runtime, so that is the whole removal; the
`vscode/` tree is reset every run, so it is a clean overlay-style deletion).
`product.json`'s `defaultChatAgent` is deliberately **not** overridden — Code-OSS
dereferences it unguarded during workbench startup, so nulling it white-screens
the window.

**Residual:** the *core* chat ViewPane (`vscode/out/.../contrib/chat`, not an
extension) still renders its empty "set up GitHub Copilot" state until a viewer
hides it. Fully removing it is patch-tier — see below.

---

## What stays VS Code (residual tells, config-only)

The Explorer / Search / SCM / Run / Extensions view containers still exist (the
activity bar can be hidden or relocated, not renamed); the core **chat view's**
empty state survives removing the Copilot extension; the Settings editor, the
Extensions "Marketplace" view, workspace-trust modal wording, and the `F1`
palette are upstream. Hiding the activity bar in Agent layout and driving
navigation from Home covers most of the visual impact. Closing the rest needs a
"curated shell patch set" — out of scope under the config-only constraint.

## Standing gates

All of [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) "Standing gates" apply:

- The new webviews (`home`, `workspace`, `review`, `customdoc`) are in the
  `axe` sweep (`test/a11y.test.ts`) and the keyboard-operability check.
- The layout bundles, the ticker phrases, and the three surface models are
  trace-replayed in `test/uxdiff.test.ts` — deterministic, no clock, no raw JSON.
- Layout modes write only user-overridable settings — nothing is locked, so
  "never trap the user" holds.
- `chrome/dist/` is generated + committed; a CI drift check (`git diff
  --exit-code chrome/dist`) and `scripts/check-chrome-icons.mjs` keep it honest.
- No new event decoder, no new patch, layering unchanged.
