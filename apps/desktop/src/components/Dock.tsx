import { useRef } from "react";
import { Activity, Clock4, TerminalSquare, FlaskConical, GitCompareArrows, ChevronDown, ChevronUp } from "lucide-react";
import { useApp, type DockTab } from "../state/store";
import ActivityFeed from "../panels/ActivityFeed";
import TimelinePanel from "../panels/TimelinePanel";
import TerminalPanel from "../panels/TerminalPanel";
import TestPanel from "../panels/TestPanel";
import DiffViewerPanel from "../panels/DiffViewerPanel";

const tabs: { key: DockTab; label: string; icon: React.ReactNode }[] = [
  { key: "activity", label: "Activity", icon: <Activity size={13} /> },
  { key: "timeline", label: "Timeline", icon: <Clock4 size={13} /> },
  { key: "diff", label: "Diff", icon: <GitCompareArrows size={13} /> },
  { key: "tests", label: "Tests", icon: <FlaskConical size={13} /> },
  { key: "terminal", label: "Terminal", icon: <TerminalSquare size={13} /> },
];

export default function Dock() {
  const dockTab = useApp((s) => s.dockTab);
  const setDockTab = useApp((s) => s.setDockTab);
  const collapsed = useApp((s) => s.dockCollapsed);
  const toggleDock = useApp((s) => s.toggleDock);
  const dockRef = useRef<HTMLDivElement>(null);

  function onResizeStart(e: React.PointerEvent) {
    const el = dockRef.current;
    if (!el) return;
    const startY = e.clientY;
    const startH = el.getBoundingClientRect().height;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    function onMove(ev: PointerEvent) {
      const h = Math.min(560, Math.max(120, startH - (ev.clientY - startY)));
      if (el) el.style.height = `${h}px`;
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className={`dock ${collapsed ? "collapsed" : ""}`} ref={dockRef}>
      {!collapsed && <div className="resize-handle" onPointerDown={onResizeStart} title="Drag to resize" />}
      <div className="dock-head">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab no-native-focus ${dockTab === t.key ? "active" : ""}`}
            onClick={() => setDockTab(t.key)}
            style={{ padding: "6px 10px" }}
          >
            {t.icon} {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="icon-btn no-native-focus" title={collapsed ? "Expand" : "Collapse"} onClick={toggleDock}>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      <div className="dock-body">
        {dockTab === "activity" && <ActivityFeed />}
        {dockTab === "timeline" && <TimelinePanel />}
        {dockTab === "diff" && <DiffViewerPanel />}
        {dockTab === "tests" && <TestPanel />}
        {dockTab === "terminal" && <TerminalPanel />}
      </div>
    </div>
  );
}
