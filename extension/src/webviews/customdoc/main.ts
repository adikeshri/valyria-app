/**
 * Renderer for the Valyria document viewer (`.valyria/**` files). Markdown-lite
 * for `.md`, pretty JSON for `.json`, plus an "Open raw" button. No framework,
 * no network — the shared vanilla helpers only.
 */
import { mountWebview } from "../shared/host";
import { h } from "../shared/render";
import "./customdoc.css";

interface DocModel {
  kind: "md" | "json";
  name: string;
  text: string;
}

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

/** Deliberately tiny: headings, fenced code, list items, inline code, blank
 *  lines. Anything richer is one click away in the raw editor. */
function renderMarkdown(src: string): HTMLElement {
  const wrap = h("div", { class: "doc-md" });
  const lines = src.split("\n");
  let i = 0;
  let list: HTMLUListElement | null = null;
  const flushList = () => {
    if (list) {
      wrap.append(list);
      list = null;
    }
  };
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      flushList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++;
      wrap.append(h("pre", { class: "doc-code" }, h("code", { text: buf.join("\n") })));
      continue;
    }
    const hMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hMatch) {
      flushList();
      const level = hMatch[1]!.length;
      wrap.append(h(`h${level}` as "h1", { class: "doc-h", text: hMatch[2] ?? "" }));
      i++;
      continue;
    }
    const liMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    if (liMatch) {
      list ??= h("ul", { class: "doc-ul" }) as HTMLUListElement;
      list.append(h("li", { text: liMatch[1] ?? "" }));
      i++;
      continue;
    }
    flushList();
    if (line.trim()) wrap.append(h("p", { class: "doc-p", text: line }));
    i++;
  }
  flushList();
  return wrap;
}

function render(m: DocModel): void {
  root.replaceChildren();
  const openRaw = h("button", { class: "vy-btn", type: "button" }, "Open raw") as HTMLButtonElement;
  openRaw.addEventListener("click", () => ctrl?.command("openRaw"));
  root.append(
    h(
      "div",
      { class: "doc-bar" },
      h("span", { class: "doc-name", text: m.name }),
      openRaw
    )
  );
  if (m.kind === "json") {
    let pretty = m.text;
    try {
      pretty = JSON.stringify(JSON.parse(m.text), null, 2);
    } catch {
      /* show as-is if it isn't valid JSON */
    }
    root.append(h("pre", { class: "doc-code" }, h("code", { text: pretty })));
  } else {
    root.append(renderMarkdown(m.text));
  }
}

ctrl = mountWebview<DocModel>({ onState: render });
