import { useEffect, useState } from 'react';

/**
 * The "phone" layout: narrow portrait screens, or short landscape ones (a phone turned sideways
 * is wider than the breakpoint but has no room for the desktop columns). Landscape is detected by
 * aspect ratio rather than `orientation`, which flips when the keyboard shrinks a portrait
 * viewport below its width. Mirrors the breakpoints in styles/game.css.
 */
export const PHONE_QUERY = '(max-width: 760px), (min-aspect-ratio: 3/2) and (max-height: 520px)';

/** Fine pointer and hover: a desktop-class device where focusing an input never pops up a keyboard. */
export const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

export function matchesMedia(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesMedia(query));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
