/** Keyboard focus helpers for modal surfaces (the phone bottom sheets). */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Where a Tab (or Shift+Tab) from `active` lands when focus must stay inside `focusable`: the next
 * element in order, wrapping at both ends. Focus outside the list (e.g. on the container itself)
 * moves to the first or last element. `null` when there is nothing to focus.
 */
export function nextInCycle<T>(focusable: readonly T[], active: T | null, backwards: boolean): T | null {
  if (focusable.length === 0) return null;
  const index = active === null ? -1 : focusable.indexOf(active);
  if (index < 0) return backwards ? focusable[focusable.length - 1] : focusable[0];
  const next = backwards ? index - 1 : index + 1;
  return focusable[(next + focusable.length) % focusable.length];
}
