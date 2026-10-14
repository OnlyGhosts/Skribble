import { useEffect, useRef } from 'react';

/** Typing in a field (an amount, the chat) keeps the letters for itself. */
export function typingIn(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object' || !('tagName' in target)) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  return el.isContentEditable === true || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** The parts of a key event a table shortcut reads. */
export interface HotkeyEvent {
  key: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
}

/**
 * The shortcut a key press names ("Space", "H"...), or null when it is not one: a repeat, a
 * modified key, typing in a field, or Space on a focused button (which keeps Space for itself).
 */
export function hotkeyOf(e: HotkeyEvent): string | null {
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || typingIn(e.target)) return null;
  if (e.key === ' ') {
    const t = e.target as { closest?: (selector: string) => unknown } | null;
    if (t && typeof t.closest === 'function' && t.closest('button, a, [role="button"]')) return null;
    return 'Space';
  }
  return e.key.length === 1 ? e.key.toUpperCase() : null;
}

/** Shortcut to its action, or null while that action is not on offer. */
export type HotkeyMap = Record<string, (() => void) | null>;

/**
 * Desktop shortcuts for a table's controls, read fresh on every key press (so they always see the
 * current state) and off while a modal dialog is open.
 */
export function useHotkeys(enabled: boolean, keys: HotkeyMap): void {
  const latest = useRef(keys);
  latest.current = keys;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const key = hotkeyOf(e);
      if (key === null || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const action = latest.current[key];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
