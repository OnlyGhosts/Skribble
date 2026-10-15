import { useId } from 'react';
import { WORDMARK_ACCENT_PATH, WORDMARK_BASE_PATH, WORDMARK_VIEWBOX } from '../brand/wordmark';

interface WordmarkProps {
  className?: string;
}

/**
 * The boredgames.io wordmark: outlined Poppins paths, inline so the theme recolours it.
 * "bored" and ".io" take the text colour, "games" the primary text colour (lime on dark, deep
 * olive on light). Height comes from CSS; the viewBox keeps the proportions.
 */
export function Wordmark({ className }: WordmarkProps) {
  const titleId = useId();
  return (
    <svg className={`wordmark${className ? ` ${className}` : ''}`} viewBox={WORDMARK_VIEWBOX} role="img" aria-labelledby={titleId} data-testid="wordmark">
      <title id={titleId}>boredgames.io</title>
      <path d={WORDMARK_BASE_PATH} fill="currentColor" />
      <path className="wordmark__accent" d={WORDMARK_ACCENT_PATH} fill="currentColor" />
    </svg>
  );
}
