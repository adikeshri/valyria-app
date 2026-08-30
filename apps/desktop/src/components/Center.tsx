import { MessageSquare, ListChecks, FileCode, PanelRightOpen } from "lucide-react";
import { useApp, type CenterTab } from "../state/store";
import TabStrip, { type TabDef } from "./TabStrip";
import ChatPanel from "../panels/ChatPanel";
import TaskDetailPanel from "../panels/TaskDetailPanel";
import CodeViewerPanel from "../panels/CodeViewerPanel";

export default function Center() {
  const centerTab = useApp((s) => s.centerTab);
  const setCenterTab = useApp((s) => s.setCenterTab);
  const selectedFile = useApp((s) => s.selectedFile);
  const rightCollapsed = useApp((s) => s.rightCollapsed);
  const toggleRight = useApp((s) => s.toggleRight);

  const tabs: TabDef<CenterTab>[] = [
    { key: "chat", label: "Agent", icon: <MessageSquare size={13} /> },
    { key: "task", label: "Task", icon: <ListChecks size={13} /> },
    ...(selectedFile
      ? [{ key: "code" as const, label: selectedFile.split("/").pop() ?? "Code", icon: <FileCode size={13} /> }]
      : []),
  ];
  const active: CenterTab = centerTab === "code" && !selectedFile ? "chat" : centerTab;

  return (
    <div className="center">
      <div className="tabstrip">
        <TabStrip
          tabs={tabs}
          active={active}
          onSelect={setCenterTab}
          ariaLabel="Center panels"
          idPrefix="center"
          style={{ display: "flex", flex: 1 }}
        />
        {rightCollapsed && (
          <button className="icon-btn no-native-focus" title="Show context panel" onClick={toggleRight} style={{ marginBottom: 4 }}>
            <PanelRightOpen size={14} />
          </button>
        )}
      </div>
      <div className="center-content" role="tabpanel" id={`center-panel-${active}`} aria-labelledby={`center-tab-${active}`}>
        {active === "chat" && <ChatPanel />}
        {active === "task" && <TaskDetailPanel />}
        {active === "code" && <CodeViewerPanel />}
      </div>
    </div>
  );
}
