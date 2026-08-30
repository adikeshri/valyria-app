import { useEffect } from "react";
import { useApp } from "./store";

/** Applies the "reduced motion" preference to the document root — CSS under
 *  `:root[data-reduced-motion="1"]` in global.css zeroes durations. Mirrors
 *  useThemeEffect. */
export function useReducedMotionEffect() {
  const reducedMotion = useApp((s) => s.reducedMotion);
  useEffect(() => {
    const root = document.documentElement;
    if (reducedMotion) root.setAttribute("data-reduced-motion", "1");
    else root.removeAttribute("data-reduced-motion");
  }, [reducedMotion]);
}
