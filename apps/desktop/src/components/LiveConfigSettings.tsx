import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { bridge, type ConfigEntry } from "../core/bridge";
import { present } from "../core/errors";
import ErrorState from "./ErrorState";

/** D13 (CORE-INTERFACE G6) — there is no `config_set` on the wire, so the app
 *  writes Core's own `config.toml` and immediately re-reads `config_show` to
 *  render the **effective** value with its `origin`. If a policy floor or
 *  precedence rule overrode the write, that is what shows — not the optimistic
 *  value.
 *
 *  Core's config surface is small today: `config_show` reports only
 *  `permission.mode` (handled by the autonomy control), `log.format`, and
 *  `network` (a struct — we edit the `network.internet` leaf). */
export default function LiveConfigSettings() {
  const [entries, setEntries] = useState<ConfigEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bridge
      .configShow()
      .then((r) => !cancelled && setEntries(r.entries))
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  async function write(key: string, value: string) {
    setPending(key);
    setErr(null);
    try {
      const r = await bridge.configWrite("user", key, value);
      setEntries(r.entries);
    } catch (e) {
      setErr(String(e));
    } finally {
      setPending(null);
    }
  }

  if (err && !entries) {
    return <ErrorState presentation={present(err, { context: "Loading settings" })} />;
  }
  if (!entries) {
    return <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>Loading config…</p>;
  }

  const logFormat = entries.find((e) => e.key === "log.format");
  const network = entries.find((e) => e.key === "network");
  const internet = network ? /internet:\s*(\w+)/.exec(network.value)?.[1] ?? "?" : "?";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Setting
        label="Internet access for the agent"
        hint="Writes network.internet in Core's config; the policy floor may keep it stricter."
        origin={network?.origin}
        pending={pending === "network.internet"}
      >
        <Segmented
          value={internet}
          options={[
            { key: "denied", label: "Denied" },
            { key: "controlled", label: "Ask each time" },
            { key: "allowed", label: "Allowed" },
          ]}
          onPick={(v) => void write("network.internet", v)}
        />
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
          Effective: <code style={{ fontFamily: "var(--font-mono)" }}>{internet}</code>
        </div>
      </Setting>

      <Setting
        label="Log format"
        hint="Core's runtime log output."
        origin={logFormat?.origin}
        pending={pending === "log.format"}
      >
        <Segmented
          value={logFormat?.value ?? "pretty"}
          options={[
            { key: "pretty", label: "Pretty" },
            { key: "json", label: "JSON" },
          ]}
          onPick={(v) => void write("log.format", v)}
        />
      </Setting>

      <p style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>
        Iteration limits, verification policy and model roles aren't in Core's config surface yet (G6) — they can't be
        set from here.
      </p>
      {err && <ErrorState presentation={present(err, { context: "Saving the setting" })} compact />}
    </div>
  );
}

function Setting({
  label, hint, origin, pending, children,
}: {
  label: string; hint: string; origin?: string; pending: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {pending ? (
            <Loader2 size={12} className="spin" style={{ color: "var(--text-tertiary)" }} />
          ) : origin ? (
            <span className="local-tag">from {origin}</span>
          ) : null}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 6 }}>{hint}</div>
      {children}
    </div>
  );
}

function Segmented({
  value, options, onPick,
}: {
  value: string; options: { key: string; label: string }[]; onPick: (v: string) => void;
}) {
  return (
    <div role="radiogroup" style={{ display: "inline-flex", gap: 2, background: "var(--bg-hover)", borderRadius: 7, padding: 2 }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            role="radio"
            aria-checked={active}
            className="no-native-focus"
            disabled={active}
            onClick={() => onPick(o.key)}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, fontSize: 12,
              background: active ? "var(--bg-surface)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-tertiary)",
              boxShadow: active ? "var(--shadow-sm)" : "none",
            }}
          >
            {active && <Check size={11} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
