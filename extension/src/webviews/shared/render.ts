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
