import { Compass, Hash, ShieldCheck, PanelRightClose } from "lucide-react";
import { useApp, type RightTab } from "../state/store";
import ContextInspectorPanel, { SymbolsStub } from "../panels/ContextInspectorPanel";
import VerificationPanel from "../panels/VerificationPanel";

const tabs: { key: RightTab; label: string; icon: React.ReactNode }[] = [
  { key: "context", label: "Context", icon: <Compass size={13} /> },
  { key: "symbols", label: "Symbols", icon: <Hash size={13} /> },
  { key: "verify", label: "Verify", icon: <ShieldCheck size={13} /> },
];

export default function RightRail() {
  const rightTab = useApp((s) => s.rightTab);
  const setRightTab = useApp((s) => s.setRightTab);
  const collapsed = useApp((s) => s.rightCollapsed);
  const toggleRight = useApp((s) => s.toggleRight);

  if (collapsed) return null;

  return (
    <aside className="right-rail" aria-label="Context">
      <div className="tabstrip" style={{ paddingTop: 4 }}>
        {tabs.map((t) => (
          <button key={t.key} className={`tab no-native-focus ${rightTab === t.key ? "active" : ""}`} onClick={() => setRightTab(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="icon-btn no-native-focus" title="Collapse" onClick={toggleRight} style={{ marginBottom: 4 }}>
          <PanelRightClose size={14} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {rightTab === "context" && <ContextInspectorPanel />}
        {rightTab === "symbols" && <SymbolsStub />}
        {rightTab === "verify" && <VerificationPanel />}
      </div>
    </aside>
  );
}
