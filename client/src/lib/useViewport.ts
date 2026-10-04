import { useEffect } from 'react';

export const APP_HEIGHT_VAR = '--app-height';
/** Set on <html> while a screen wants the page itself to never scroll (the phone game layout). */
export const APP_MODE_CLASS = 'is-app';

function visibleHeight(): number {
  const vv = window.visualViewport;
  const h = vv?.height ?? window.innerHeight;
  return Math.max(0, Math.round(h));
}

/**
 * Publishes the visible viewport height as `--app-height` on <html>. `100dvh` ignores the
 * on-screen keyboard on iOS, so the game's fixed layout sizes itself from the visual viewport
 * instead; when the keyboard resizes it, the page is re-anchored at the top so the layout does
 * not drift under the keyboard.
 */
export function useViewport(): void {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let lastHeight = -1;

    const apply = () => {
      const height = visibleHeight();
      root.style.setProperty(APP_HEIGHT_VAR, `${height}px`);
      const changed = lastHeight !== -1 && height !== lastHeight;
      lastHeight = height;
      if (!root.classList.contains(APP_MODE_CLASS)) return;
      // iOS scrolls the page to keep the focused input visible when the keyboard opens; with a
      // layout that already fits the visual viewport that only pushes the header out of view.
      if (changed || window.scrollY !== 0 || (vv?.offsetTop ?? 0) !== 0) window.scrollTo(0, 0);
    };

    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      root.style.removeProperty(APP_HEIGHT_VAR);
    };
  }, []);
}

/** Toggles the non-scrolling app mode on <html> while `active`. */
export function useAppMode(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.classList.add(APP_MODE_CLASS);
    window.scrollTo(0, 0);
    return () => root.classList.remove(APP_MODE_CLASS);
  }, [active]);
}
