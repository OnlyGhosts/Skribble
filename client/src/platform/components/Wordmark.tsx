import { useId } from 'react';
import { MONOGRAM_PATH, MONOGRAM_TILE, MONOGRAM_VIEWBOX, WORDMARK_IO_PATH, WORDMARK_VIEWBOX, WORDMARK_WORD_PATH } from '../brand/wordmark';

interface WordmarkProps {
  className?: string;
  /** Headline emphasis: the ".io" in lilac. Off by default; the header keeps it quiet. */
  lilacIo?: boolean;
}

/**
 * The boredgames.io wordmark: outlined vector paths (every letter a path, no font dependency),
 * inline so it takes `currentColor`, with "boredgames.io" as its accessible name. Width comes
 * from CSS (`--wordmark-width`); the viewBox keeps the proportions, so it is never stretched.
 * Never rendered as live text, never with a controller icon beside it.
 */
export function Wordmark({ className, lilacIo = false }: WordmarkProps) {
  const titleId = useId();
  const classes = ['wordmark', lilacIo ? 'wordmark--lilac-io' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <svg className={classes} viewBox={WORDMARK_VIEWBOX} role="img" aria-labelledby={titleId} preserveAspectRatio="xMinYMid meet" data-testid="wordmark">
      <title id={titleId}>boredgames.io</title>
      <path d={WORDMARK_WORD_PATH} fill="currentColor" />
      <path className="wordmark__io" d={WORDMARK_IO_PATH} fill="currentColor" />
    </svg>
  );
}

/** The "bg." tile for tight spaces (avatars, compact headers). The tile is graphite, the letters take `currentColor`. */
export function Monogram({ className }: { className?: string }) {
  const titleId = useId();
  return (
    <svg className={`monogram${className ? ` ${className}` : ''}`} viewBox={MONOGRAM_VIEWBOX} role="img" aria-labelledby={titleId} data-testid="monogram">
      <title id={titleId}>boredgames.io</title>
      <rect x={MONOGRAM_TILE.x} y={MONOGRAM_TILE.y} width={MONOGRAM_TILE.width} height={MONOGRAM_TILE.height} rx={MONOGRAM_TILE.rx} fill="var(--color-surface-3)" />
      <path d={MONOGRAM_PATH} fill="currentColor" />
    </svg>
  );
}
