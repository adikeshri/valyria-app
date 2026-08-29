import { useEffect } from "react";
import { useApp } from "./store";

/** Applies the resolved theme to the document root. "system" removes the
 * attribute entirely so the tokens.css `prefers-color-scheme` block decides —
 * see docs/PLAN.md D10/§47. */
export function useThemeEffect() {
  const theme = useApp((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
}
