# Accessibility

> **Note.** These are standing per-phase exit criteria. They now apply to the
> Valyria **extension** and its webviews (`--vscode-*` theming, `aria-live`
> regions, `:focus-visible`, `mountWebview`'s live region, `prefers-reduced-motion`);
> the editor chrome's accessibility is upstream Code-OSS's.

Keyboard-first navigation, visible focus, reduced-motion, and light/dark/system
are acceptance criteria on every phase's exit, not a cleanup pass
([PLAN.md](PLAN.md) D10). This is the model, what a grep can hold, and the
manual pass run per release.

## Structural invariants — `xtask check-a11y`

`cargo run -p xtask -- check-a11y` (part of `xtask all`, in CI) holds:

- **Every full-screen overlay traps focus.** `SettingsView`, `AboutView`,
  `CommandPalette`, `LiveFirstRun`, `FirstRunView` each call
  `useOverlayA11y(ref, onClose)` — focus moves in on open, `Tab` / `Shift+Tab`
  cycle within, `Escape` closes, focus returns to the trigger on close.
- **One tab-strip implementation.** `role="tablist"` appears only in
  `components/TabStrip.tsx` (roving `tabIndex`, Arrow/Home/End). Dock, Center,
  RightRail and the Terminal sub-tabs all use it.
- **Every `<img>` has an `alt`.**
- **No raw error strings** — enforced by the sibling `check-error-strings` gate;
  every error renders through `core/errors.ts` `present()` + `<ErrorState>`,
  which always states what happened, whether the agent stopped, whether action
  is needed, and what to do next (PRD §36).

## Built-in behaviours

- **Skip link** — `App.tsx` → `#main`.
- **Focus is never suppressed**, only restyled — `:focus-visible` +
  `--focus-ring` (`styles/global.css`).
- **Reduced motion** — the OS `prefers-reduced-motion` is respected, and the
  Settings → Application → "Reduced motion" toggle forces it on
  (`useReducedMotionEffect` sets `data-reduced-motion="1"` on `<html>`;
  `global.css` neutralizes transitions/animations, keeping `.spin` slow so
  "working" still reads). Persisted to `localStorage`.
- **Live region** — one polite `role="status"` (`components/LiveRegion.tsx`)
  announces connection transitions (reconnecting / degraded / incompatible) and
  approval arrivals.
- **Theme** — light / dark / system, `role="radiogroup"` in the header.

## Keyboard map

| Key | Action |
|---|---|
| `Cmd/Ctrl-K` | Open / close the command palette |
| `Tab` / `Shift-Tab` | Move focus; trapped inside an open overlay |
| `Escape` | Close the open overlay / palette / approval |
| `Arrow` keys | Move between tabs in a focused tab strip (`Home`/`End` jump to ends) |
| `Esc Esc` | Leave the integrated terminal for its tab strip (single `Esc` goes to the shell) |
| `Enter` | Activate the focused control; run the highlighted palette command |

## Manual pass — run per release

Against `npm run app:dev` (and once against a packaged build per tier-1 OS):

1. **axe DevTools** (browser extension) — scan each route: workspace, Settings,
   About, First-run, and the command palette open. Zero critical/serious
   violations; triage moderate ones.
2. **Keyboard-only traversal** — unplug the mouse. Reach every interactive
   element via `Tab`; confirm focus is always visible; open each overlay and
   confirm focus enters, is trapped, `Escape` exits, and focus returns to the
   trigger. Arrow-key through Dock / Center / RightRail / Terminal tabs.
3. **Screen reader** — VoiceOver (macOS) / NVDA (Windows) / Orca (Linux):
   - Landmarks read: banner, navigation ("Workspace sections"), main,
     complementary ("Context").
   - Open a workspace → the live region announces the connection state.
   - Trigger an approval → "Approval required" is announced.
   - Every tab, radio, switch and button has a name; tab strips announce
     "tab, N of M, selected".
   - Error surfaces read their full four-part text.
4. **Reduced motion** — turn the setting on; confirm the spinner slows and no
   transitions play; reload and confirm it persisted.
5. **Zoom / contrast** — 200% browser zoom: no clipped content, no horizontal
   scroll on the main column. Both themes legible.

Record the result (date, OS, SR, findings) in the release notes.
