import { useEffect } from "react";
import { useApp } from "./state/store";
import { useLive } from "./core/liveStore";
import { useThemeEffect } from "./state/useThemeEffect";
import { useReducedMotionEffect } from "./state/useReducedMotionEffect";
import { FIRST_RUN_LS_KEY } from "./components/LiveFirstRun";
import Header from "./components/Header";
import LiveRegion from "./components/LiveRegion";
import ConnectBar from "./components/ConnectBar";
import ResumePrompt from "./components/ResumePrompt";
import Sidebar from "./components/Sidebar";
import Center from "./components/Center";
import RightRail from "./components/RightRail";
import Dock from "./components/Dock";
import SettingsView from "./components/SettingsView";
import FirstRunView from "./components/FirstRunView";
import AboutView from "./components/AboutView";
import CommandPalette from "./components/CommandPalette";

export default function App() {
  useThemeEffect();
  useReducedMotionEffect();
  const route = useApp((s) => s.route);
  const setRoute = useApp((s) => s.setRoute);
  const available = useLive((s) => s.available);

  // First launch in the desktop shell with no prior setup → open the wizard.
  useEffect(() => {
    if (!available) return;
    let seen = true;
    try {
      seen = localStorage.getItem(FIRST_RUN_LS_KEY) === "1";
    } catch {
      seen = false;
    }
    if (!seen) setRoute("first-run");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  return (
    <>
      <a href="#main" className="skip-link">Skip to main content</a>
      <div className="shell">
        <Header />
        <ConnectBar />
        <ResumePrompt />
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
      {route === "about" && <AboutView />}
      <CommandPalette />
      <LiveRegion />
    </>
  );
}
