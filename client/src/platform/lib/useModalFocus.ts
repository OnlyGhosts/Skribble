import { useEffect, useRef, type RefObject } from 'react';
import { focusableIn, nextInCycle } from './focus';

/**
 * Makes the element behind `ref` behave as a modal dialog while `active`: it takes the focus,
 * Tab and Shift+Tab cycle inside it, Escape calls `onEscape`, and the focus returns to the
 * control that had it once the modal goes away. Pair it with role="dialog" aria-modal="true".
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void): void {
  // Keep the latest callback without re-running the hand-over on every parent render.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const panel = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscapeRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = nextInCycle(focusableIn(panel), active && panel.contains(active) ? active : null, e.shiftKey);
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [ref, active]);
}
