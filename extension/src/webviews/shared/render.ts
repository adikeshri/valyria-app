/** Tiny vanilla-DOM helpers shared by the Valyria webviews. No framework. */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === "class") {
      node.className = String(v);
    } else if (k === "text") {
      node.textContent = String(v);
    } else if (typeof v === "boolean") {
      // aria-* wants the literal "true"/"false"; plain boolean attrs are toggled.
      if (k.startsWith("aria-")) node.setAttribute(k, v ? "true" : "false");
      else if (v) node.setAttribute(k, "");
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/**
 * The Valyria brand lockup — the folded dragon-fire "V" mark plus the wordmark,
 * for the top of the About and first-run surfaces. Static inline SVG, so it
 * needs no webview resource root and no extra CSP allowance.
 */
const BRAND_MARK_SVG = `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="vy-fire" x1="4" y1="3" x2="26" y2="27" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f7b45c"/><stop offset=".42" stop-color="#ec773c"/><stop offset="1" stop-color="#b5401d"/></linearGradient></defs><rect width="30" height="30" rx="7" fill="#131318"/><path d="M6.5 6h4.4l4.1 12.4L19.1 6h4.4l-6.1 18h-2.8L6.5 6z" fill="url(#vy-fire)"/></svg>`;

export function brandLockup(tagline?: string): HTMLElement {
  const wrap = h("div", { class: "vy-brand" });
  const mark = h("span", { class: "vy-brand-mark" });
  mark.innerHTML = BRAND_MARK_SVG;
  wrap.append(
    mark,
    h(
      "span",
      { class: "vy-brand-text" },
      h("span", { class: "vy-brand-name", text: "Valyria" }),
      tagline ? h("span", { class: "vy-brand-tag", text: tagline }) : null
    )
  );
  return wrap;
}

/** A titled section with a body. */
export function section(title: string, ...body: (Node | string | false | null)[]): HTMLElement {
  return h(
    "section",
    { class: "vy-section" },
    h("h2", { class: "vy-section-title", text: title }),
    ...body
  );
}

export function badge(text: string, kind?: "ok" | "warn" | "bad" | "muted"): HTMLElement {
  return h("span", { class: `vy-badge${kind ? ` vy-badge--${kind}` : ""}`, text });
}

export function empty(text: string): HTMLElement {
  return h("p", { class: "vy-empty", text });
}

/** A connection banner shown when not `ready`. Returns null when healthy. */
export function connBanner(connection: string): HTMLElement | null {
  if (connection === "ready") return null;
  const bad = connection === "failed" || connection === "incompatible";
  return h(
    "div",
    { class: `vy-conn${bad ? " vy-conn--bad" : ""}`, role: "status", "aria-live": "polite" },
    connection === "connecting" || connection === "reconnecting" || connection === "starting"
      ? `Connecting to Core (${connection})…`
      : `Core connection: ${connection}`
  );
}

export function stateLabel(state: string | null): string {
  if (!state) return "—";
  return state.replace(/_/g, " ");
}
