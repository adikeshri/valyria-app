import { useApp } from "./state/store";
import { useThemeEffect } from "./state/useThemeEffect";
import Header from "./components/Header";
import ConnectBar from "./components/ConnectBar";
import Sidebar from "./components/Sidebar";
import Center from "./components/Center";
import RightRail from "./components/RightRail";
import Dock from "./components/Dock";
import SettingsView from "./components/SettingsView";
import FirstRunView from "./components/FirstRunView";
import CommandPalette from "./components/CommandPalette";

export default function App() {
  useThemeEffect();
  const route = useApp((s) => s.route);

  return (
    <>
      <a href="#main" className="skip-link">Skip to main content</a>
      <div className="shell">
        <Header />
        <ConnectBar />
        <div className="body">
          <Sidebar />
          <main id="main" className="main-column">
            <div className="center-and-right">
              <Center />
              <RightRail />
            </div>
            <Dock />
          </main>
        </div>
      </div>
      {route === "settings" && <SettingsView />}
      {route === "first-run" && <FirstRunView />}
      <CommandPalette />
    </>
  );
}
