import { useRef } from "react";

export interface TabDef<K extends string> {
  key: K;
  label: string;
  icon?: React.ReactNode;
  /** colour for the active label; defaults to --accent-strong */
  accent?: string;
}

/**
 * The one tab-strip implementation in the app (docs/PLAN.md D10, enforced by
 * `xtask check-a11y`): `role="tablist"` with a roving `tabIndex` and
 * ArrowLeft/ArrowRight/Home/End navigation. Callers render their own panels
 * with `id={`${idPrefix}-panel-${key}`}` and
 * `aria-labelledby={`${idPrefix}-tab-${active}`}`.
 */
export default function TabStrip<K extends string>({
  tabs,
  active,
  onSelect,
  ariaLabel,
  idPrefix,
  className,
  style,
}: {
  tabs: readonly TabDef<K>[];
  active: K;
  onSelect: (key: K) => void;
  ariaLabel: string;
  idPrefix: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  const focusTab = (key: K) =>
    stripRef.current?.querySelector<HTMLButtonElement>(`#${idPrefix}-tab-${key}`)?.focus();

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === active);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === -1) return;
    e.preventDefault();
    const key = tabs[next]!.key;
    onSelect(key);
    focusTab(key);
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={className}
      style={style}
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            id={`${idPrefix}-tab-${t.key}`}
            role="tab"
            aria-selected={isActive}
            aria-controls={`${idPrefix}-panel-${t.key}`}
            tabIndex={isActive ? 0 : -1}
            className={`tab no-native-focus ${isActive ? "active" : ""}`}
            onClick={() => onSelect(t.key)}
            style={
              t.accent && isActive ? { color: t.accent } : undefined
            }
          >
            {t.icon} {t.label}
          </button>
        );
      })}
    </div>
  );
}
