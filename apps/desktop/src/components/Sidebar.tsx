import { Files, GitCompareArrows, ListChecks, GitBranch, Boxes, Cpu } from "lucide-react";
import { useApp, type SidebarSection } from "../state/store";
import FileTreePanel from "../panels/FileTreePanel";
import ChangesPanel from "../panels/ChangesPanel";
import TaskHistoryPanel from "../panels/TaskHistoryPanel";
import GitPanel from "../panels/GitPanel";
import ModelsPanel from "../panels/ModelsPanel";
import HardwarePanel from "../panels/HardwarePanel";
import { modifiedFiles, taskHistory } from "../data/mock";

const items: { key: SidebarSection; icon: React.ReactNode; label: string; count?: number }[] = [
  { key: "files", icon: <Files size={17} />, label: "Explorer" },
  { key: "changes", icon: <GitCompareArrows size={17} />, label: "Changes", count: modifiedFiles.length },
  { key: "tasks", icon: <ListChecks size={17} />, label: "Tasks", count: taskHistory.length },
  { key: "git", icon: <GitBranch size={17} />, label: "Git" },
  { key: "models", icon: <Boxes size={17} />, label: "Models" },
];

const titles: Record<SidebarSection, string> = {
  files: "Explorer",
  changes: "Changes",
  tasks: "Task History",
  git: "Git",
  models: "Models",
  hardware: "Hardware",
};

export default function Sidebar() {
  const section = useApp((s) => s.sidebarSection);
  const setSection = useApp((s) => s.setSidebarSection);

  return (
    <>
      <nav className="sidebar" aria-label="Workspace sections">
        {items.map((it) => (
          <button
            key={it.key}
            className={`sidebar-rail-btn no-native-focus ${section === it.key ? "active" : ""}`}
            title={it.label}
            aria-pressed={section === it.key}
            onClick={() => setSection(it.key)}
          >
            {it.icon}
          </button>
        ))}
        <div className="sidebar-rail-spacer" />
        <button
          className={`sidebar-rail-btn no-native-focus ${section === "hardware" ? "active" : ""}`}
          title="Hardware"
          aria-pressed={section === "hardware"}
          onClick={() => setSection("hardware")}
        >
          <Cpu size={17} />
        </button>
      </nav>
      <div className="side-panel">
        <div className="side-panel-head">
          <span className="section-label">{titles[section]}</span>
        </div>
        <div className="side-panel-body">
          {section === "files" && <FileTreePanel />}
          {section === "changes" && <ChangesPanel />}
          {section === "tasks" && <TaskHistoryPanel />}
          {section === "git" && <GitPanel />}
          {section === "models" && <ModelsPanel />}
          {section === "hardware" && <HardwarePanel />}
        </div>
      </div>
    </>
  );
}
