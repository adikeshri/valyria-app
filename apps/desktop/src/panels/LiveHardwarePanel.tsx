import { useEffect, useState } from "react";
import { Check, AlertTriangle, XCircle, HelpCircle, Cpu, MemoryStick, HardDrive, Zap } from "lucide-react";
import { bridge, type DoctorCheck, type HardwareProbe } from "../core/bridge";
import { present } from "../core/errors";
import ErrorState from "../components/ErrorState";

const gib = (n: number) => (n / 1024 ** 3).toFixed(1);

/** §4.13 / CORE-INTERFACE G4 — `hardware_probe` gives a structured report
 *  (CPU, RAM, GPUs, unified-memory / accelerator flags, disk). `doctor_run`
 *  still provides the environment checks. Fields Core does not populate are
 *  marked, never invented. */
export default function LiveHardwarePanel() {
  const [hw, setHw] = useState<HardwareProbe | null>(null);
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([bridge.hardwareProbe(), bridge.doctorRun()])
      .then(([probe, doctor]) => {
        if (cancelled) return;
        setHw(probe);
        setChecks(doctor.checks);
      })
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return <ErrorState presentation={present(err, { context: "Probing hardware" })} />;
  }
  if (!hw || !checks) {
    return (
      <div style={{ padding: 14, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
        Probing hardware…
      </div>
    );
  }

  const accel =
    hw.accelerator_present === true
      ? "present"
      : hw.accelerator_present === false
        ? "absent"
        : "not probed";

  return (
    <div className="scroll-y" style={{ height: "100%", padding: "8px 0 12px" }}>
      <div className="section-label" style={{ padding: "4px 12px" }}>
        Hardware (hardware_probe)
      </div>
      <div style={{ padding: "0 12px", display: "grid", gap: 6 }}>
        <Row icon={<Cpu size={13} />} label="CPU">
          {hw.cpu.brand}
          <Dim>
            {" "}
            · {hw.cpu.physical_cores} cores / {hw.cpu.logical_cores} threads · {hw.cpu.arch}
          </Dim>
        </Row>
        <Row icon={<MemoryStick size={13} />} label="Memory">
          {gib(hw.ram_available_bytes)} GiB free
          <Dim> of {gib(hw.ram_total_bytes)} GiB</Dim>
          {hw.unified_memory && <Dim> · unified</Dim>}
        </Row>
        {hw.gpus.length === 0 ? (
          <Row icon={<Zap size={13} />} label="GPU">
            <Dim>none reported</Dim>
          </Row>
        ) : (
          hw.gpus.map((g, i) => (
            <Row key={i} icon={<Zap size={13} />} label="GPU">
              {g.name}
              <Dim>
                {g.vendor ? ` · ${g.vendor}` : ""}
                {g.core_count != null ? ` · ${g.core_count} cores` : ""}
                {g.vram_bytes != null ? ` · ${gib(g.vram_bytes)} GiB VRAM` : " · no dedicated VRAM"}
              </Dim>
            </Row>
          ))
        )}
        <Row icon={<Zap size={13} />} label="Accelerator">
          <Dim>{accel}</Dim>
        </Row>
        <Row icon={<HardDrive size={13} />} label="Disk">
          {gib(hw.disk_available_bytes)} GiB free
          <Dim> of {gib(hw.disk_total_bytes)} GiB</Dim>
        </Row>
        <Row icon={<HelpCircle size={13} />} label="OS">
          {hw.os}
          {hw.os_version ? ` ${hw.os_version}` : ""} <Dim>· {hw.arch}</Dim>
        </Row>
      </div>

      <div className="section-label" style={{ padding: "12px 12px 4px" }}>
        Environment checks (doctor_run)
      </div>
      {checks.map((c) => (
        <div key={c.name} style={{ display: "flex", gap: 8, padding: "6px 12px" }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}>{statusIcon(c.status)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-sm)" }}>{c.name}</div>
            {c.detail && (
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{c.detail}</div>
            )}
            {c.remediation && (
              <div style={{ fontSize: 11, color: "var(--warning)" }}>{c.remediation}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: "var(--text-sm)" }}>
      <span style={{ flexShrink: 0, alignSelf: "center", color: "var(--text-tertiary)" }}>
        {icon}
      </span>
      <span style={{ width: 84, flexShrink: 0, color: "var(--text-tertiary)" }}>{label}</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--text-tertiary)" }}>{children}</span>;
}

function statusIcon(status: string) {
  switch (status) {
    case "pass":
      return <Check size={14} style={{ color: "var(--success)" }} />;
    case "warn":
      return <AlertTriangle size={14} style={{ color: "var(--warning)" }} />;
    case "fail":
      return <XCircle size={14} style={{ color: "var(--danger)" }} />;
    default:
      return <HelpCircle size={14} style={{ color: "var(--text-tertiary)" }} />;
  }
}
