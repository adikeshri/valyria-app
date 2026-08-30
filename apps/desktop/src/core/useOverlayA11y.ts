import { useEffect, useRef, type RefObject } from "react";

/**
 * Keyboard behaviour every full-screen overlay owes a keyboard user
 * (docs/PLAN.md D10 / §46, enforced by `xtask check-a11y`):
 *
 *  - on open, move focus into the overlay (first focusable, or the container);
 *  - trap `Tab` / `Shift+Tab` so focus can't escape behind it;
 *  - `Escape` calls `onClose`;
 *  - on close, restore focus to whatever was focused before it opened.
 *
 * `active` lets an always-mounted overlay (the command palette renders `null`
 * when closed rather than unmounting) turn the behaviour on and off.
 */
export function useOverlayA11y(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    // Only remember focus that was outside the overlay — under StrictMode's
    // double-invoke the second run would otherwise capture a control inside it.
    const prev = document.activeElement as HTMLElement | null;
    const previouslyFocused = prev && !node.contains(prev) ? prev : null;

    const focusables = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const focusIn = () => {
      if (node.contains(document.activeElement)) return;
      (focusables()[0] ?? node).focus();
    };
    focusIn(); // synchronously — the overlay's DOM is already committed
    const raf = requestAnimationFrame(focusIn); // fallback if layout wasn't ready

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || !node.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [ref, active]);
}
