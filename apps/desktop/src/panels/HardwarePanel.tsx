import { Cpu, MemoryStick, Gauge, Sparkles, Zap } from "lucide-react";
import { hardware } from "../data/mock";
import { useLive } from "../core/liveStore";
import LiveHardwarePanel from "./LiveHardwarePanel";

export default function HardwarePanel() {
  const liveSession = useLive((s) => s.session);
  if (liveSession) return <LiveHardwarePanel />;
  return <MockHardwarePanel />;
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px" }}>
      <span style={{ color: "var(--text-tertiary)", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", width: 78, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function MockHardwarePanel() {
  return (
    <div className="scroll-y" style={{ height: "100%" }}>
      <Row icon={<Cpu size={13} />} label="CPU" value={`${hardware.cpu} (${hardware.cores} cores)`} />
      <Row icon={<MemoryStick size={13} />} label="RAM" value={`${hardware.ramGb} GB`} />
      <Row icon={<Zap size={13} />} label="GPU" value={hardware.gpu} />
      <Row icon={<Gauge size={13} />} label="VRAM" value={hardware.vramGb ? `${hardware.vramGb} GB` : "Unified memory"} />
      <Row icon={<Sparkles size={13} />} label="Accel." value={hardware.accelerator} />

      <div style={{ margin: "10px 12px", padding: 10, borderRadius: 8, background: "var(--accent-soft)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--accent-strong)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          <Sparkles size={12} /> Recommended
        </div>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginTop: 4 }}>{hardware.recommendedModel}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-secondary)", marginTop: 3 }}>
          Fits comfortably in {hardware.ramGb} GB unified memory with headroom for a 32k context window.
        </div>
      </div>

      <div style={{ padding: "0 12px 10px", fontSize: 10.5, color: "var(--text-tertiary)" }}>
        {hardware.os}
      </div>
    </div>
  );
}
