/**
 * Review Changes (docs/UX-DIFFERENTIATION.md, lever D) — agent-authored changes
 * framed for approval. Ownership + verification come from Core (ledger +
 * task_report); the app never infers ownership. Each row jumps into the
 * editor's own diff via `openDiff`.
 */
import { mountWebview } from "../shared/host";
import { h, section, badge, connBanner } from "../shared/render";
import { CMD, type ReviewModel } from "../shared/protocol";
import "./review.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

function ownershipBadge(o: string | null): HTMLElement {
  if (o === "agent_authored") return badge("agent", "muted");
  if (o === "concurrent_user_modification") return badge("also edited by you", "warn");
  if (o === "pre_existing") return badge("pre-existing", "muted");
  if (o) return badge(o.replace(/_/g, " "), "muted");
  return badge("unattributed", "muted");
}

function render(m: ReviewModel): void {
  root.replaceChildren();
  const banner = connBanner(m.connection);
  if (banner) root.append(banner);

  root.append(
    h(
      "div",
      { class: "rv-head" },
      h("span", { class: "rv-obj", text: m.objective ?? "No task in focus" }),
      m.reportStatus ? badge(m.reportStatus, m.reportStatus === "completed" ? "ok" : "muted") : null
    )
  );

  if (!m.ledgerAvailable) {
    root.append(
      h(
        "p",
        { class: "vy-empty" },
        "Core does not expose the change ledger for this session — files are listed from the event stream, without ownership attribution."
      )
    );
  }

  // --- approval callout ---
  if (m.approval) {
    const a = m.approval;
    const high = a.risk === "destructive" || a.risk === "network" || a.risk === "elevated";
    const allow = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, "Allow once") as HTMLButtonElement;
    const deny = h("button", { class: "vy-btn", type: "button" }, "Deny") as HTMLButtonElement;
    allow.addEventListener("click", () => ctrl?.command(CMD.resolveApproval, { allow: true, seq: a.seq, scope: "once" }));
    deny.addEventListener("click", () => ctrl?.command(CMD.resolveApproval, { allow: false, seq: a.seq }));
    root.append(
      h(
        "div",
        { class: `rv-approval${high ? " rv-approval--high" : ""}`, role: "alertdialog", "aria-label": "Approval requested" },
        h("p", { class: "rv-approval-prompt", text: a.prompt }),
        h("div", { class: "rv-approval-actions" }, allow, deny)
      )
    );
  }

  // --- files ---
  if (m.files.length) {
    const list = h("ul", { class: "vy-list", "aria-label": "Changed files" });
    for (const f of m.files) {
      const open = h("button", { class: "rv-filebtn", type: "button" }, "Open diff") as HTMLButtonElement;
      open.addEventListener("click", () => ctrl?.command(CMD.openDiff, { path: f.path }));
      list.append(
        h(
          "li",
          { class: "rv-file" },
          h("span", { class: "rv-path vy-mono", text: f.path }),
          f.change ? badge(f.change, f.change === "deleted" ? "bad" : "muted") : null,
          ownershipBadge(f.ownership),
          open
        )
      );
    }
    root.append(section(`Changed files (${m.files.length})`, list));
  } else {
    root.append(section("Changed files", h("p", { class: "vy-empty" }, "No file changes recorded for this task.")));
  }

  // --- verification ---
  if (m.verified.length || m.unverified.length) {
    const list = h("ul", { class: "vy-list", "aria-label": "Verification" });
    for (const v of m.verified) {
      list.append(h("li", { class: "rv-verify" }, badge(v.outcome, "ok"), h("span", { class: "vy-mono", text: v.command }), h("span", { text: v.kind })));
    }
    for (const u of m.unverified) {
      list.append(h("li", { class: "rv-verify" }, badge("NOT RUN", "warn"), h("span", { text: u })));
    }
    root.append(section("Verification", list));
  }

  const ws = h("button", { class: "vy-btn", type: "button" }, "Open Task Workspace ›") as HTMLButtonElement;
  ws.addEventListener("click", () => ctrl?.command(CMD.openSurface, { surface: "workspace" }));
  root.append(h("div", { class: "rv-footer" }, ws));
}

ctrl = mountWebview<ReviewModel>({ onState: render });
