import { MessageSquare, ListChecks, FileCode, PanelRightOpen } from "lucide-react";
import { useApp } from "../state/store";
import ChatPanel from "../panels/ChatPanel";
import TaskDetailPanel from "../panels/TaskDetailPanel";
import CodeViewerPanel from "../panels/CodeViewerPanel";

export default function Center() {
  const centerTab = useApp((s) => s.centerTab);
  const setCenterTab = useApp((s) => s.setCenterTab);
  const selectedFile = useApp((s) => s.selectedFile);
  const rightCollapsed = useApp((s) => s.rightCollapsed);
  const toggleRight = useApp((s) => s.toggleRight);

  return (
    <div className="center">
      <div className="tabstrip">
        <button className={`tab no-native-focus ${centerTab === "chat" ? "active" : ""}`} onClick={() => setCenterTab("chat")}>
          <MessageSquare size={13} /> Agent
        </button>
        <button className={`tab no-native-focus ${centerTab === "task" ? "active" : ""}`} onClick={() => setCenterTab("task")}>
          <ListChecks size={13} /> Task
        </button>
        {selectedFile && (
          <button className={`tab no-native-focus ${centerTab === "code" ? "active" : ""}`} onClick={() => setCenterTab("code")}>
            <FileCode size={13} /> {selectedFile.split("/").pop()}
          </button>
        )}
        <div style={{ flex: 1 }} />
        {rightCollapsed && (
          <button className="icon-btn no-native-focus" title="Show context panel" onClick={toggleRight} style={{ marginBottom: 4 }}>
            <PanelRightOpen size={14} />
          </button>
        )}
      </div>
      <div className="center-content">
        {centerTab === "chat" && <ChatPanel />}
        {centerTab === "task" && <TaskDetailPanel />}
        {centerTab === "code" && <CodeViewerPanel />}
      </div>
    </div>
  );
}
