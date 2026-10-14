import type { CSSProperties } from 'react';

const PIECES = 36;
// The brand palette only: lime, lilac, off-white and their quieter cuts.
const COLORS = ['#c7e976', '#a699d5', '#f1f0e8', '#8fcf7c', '#b9aee0', '#e2b75f'];

/** A deterministic spread (no Math.random: the pieces look the same on every render and in tests). */
function pieceStyle(i: number): CSSProperties {
  const left = (i * 37 + 11) % 100;
  const delay = ((i * 53) % 100) / 100;
  const duration = 2.6 + ((i * 29) % 100) / 100;
  const drift = ((i * 17) % 60) - 30;
  const style: Record<string, string> = {
    '--confetti-left': `${left}%`,
    '--confetti-delay': `${delay}s`,
    '--confetti-duration': `${duration}s`,
    '--confetti-drift': `${drift}px`,
    '--confetti-color': COLORS[i % COLORS.length],
  };
  return style as CSSProperties;
}

/** Falling paper for the podium, pure CSS; the stylesheet stops it under prefers-reduced-motion. */
export function Confetti() {
  return (
    <div className="confetti" aria-hidden="true" data-testid="confetti">
      {Array.from({ length: PIECES }, (_, i) => (
        <span key={i} className={`confetti__piece${i % 3 === 0 ? ' confetti__piece--round' : ''}`} style={pieceStyle(i)} />
      ))}
    </div>
  );
}
