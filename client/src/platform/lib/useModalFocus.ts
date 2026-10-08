import { useEffect, useRef, type RefObject } from 'react';
import { focusableIn, nextInCycle } from './focus';

/**
 * The open modals, oldest first. Two can be up at once (a bottom sheet under the platform's
 * waiting or podium overlay): only the one on top owns the keyboard, so Tab cycles inside the
 * dialog the user sees and Escape does not close the sheet hidden underneath it.
 */
const openModals: object[] = [];

/** Whether `token` is the modal on top of the stack. */
function isTopModal(token: object): boolean {
  return openModals[openModals.length - 1] === token;
}

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
    const token = {};
    openModals.push(token);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal(token)) return;
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
      const wasTop = isTopModal(token);
      openModals.splice(openModals.indexOf(token), 1);
      // The one that was on top hands the focus back; one closed underneath leaves it with the top modal.
      if (wasTop && opener && opener.isConnected) opener.focus();
    };
  }, [ref, active]);
}
