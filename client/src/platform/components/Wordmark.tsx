import { useId } from 'react';
import {
  WORDMARK_ACCENT_PATH,
  WORDMARK_BASE_PATH,
  WORDMARK_GEAR_PATH,
  WORDMARK_ICON_BORED_TRANSFORM,
  WORDMARK_ICON_HAPPY_TRANSFORM,
  WORDMARK_ICON_TRANSFORM,
  WORDMARK_VIEWBOX,
} from '../brand/wordmark';
import { BoredArt, HappyArt } from './Mascots';

interface WordmarkProps {
  className?: string;
}

/**
 * The boredgames.io logo: the two phones as an icon, as tall as the text, then the outlined
 * Poppins wordmark whose "o" in ".io" is a settings gear (the site header lays its settings button
 * over it), inline so the theme recolours it. "bored" and ".io" take the text colour,
 * "games" the primary text colour (lime on dark, deep olive on light); the phones keep their own
 * colours. Height comes from CSS; the viewBox keeps the proportions.
 */
export function Wordmark({ className }: WordmarkProps) {
  const titleId = useId();
  return (
    <svg className={`wordmark${className ? ` ${className}` : ''}`} viewBox={WORDMARK_VIEWBOX} role="img" aria-labelledby={titleId} data-testid="wordmark">
      <title id={titleId}>boredgames.io</title>
      <g className="wordmark__icon" transform={WORDMARK_ICON_TRANSFORM}>
        <g transform={WORDMARK_ICON_BORED_TRANSFORM}>
          <BoredArt />
        </g>
        <g transform={WORDMARK_ICON_HAPPY_TRANSFORM}>
          <HappyArt />
        </g>
      </g>
      <path d={WORDMARK_BASE_PATH} fill="currentColor" />
      <path className="wordmark__accent" d={WORDMARK_ACCENT_PATH} fill="currentColor" />
      <path className="wordmark__gear" d={WORDMARK_GEAR_PATH} fill="currentColor" />
    </svg>
  );
}
