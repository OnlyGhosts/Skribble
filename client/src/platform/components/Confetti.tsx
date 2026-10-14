import type { CSSProperties } from 'react';

const PIECES = 24;
// The brand palette only: lime, lilac, off-white and the soft success and warning accents.
const COLORS = ['#c7e976', '#a699d5', '#f1f0e8', '#86d9a3', '#beb2e8', '#f4d181'];

/** A deterministic spread (no Math.random: the pieces look the same on every render and in tests). */
function pieceStyle(i: number): CSSProperties {
  const left = (i * 37 + 11) % 100;
  // A short burst (Pocket Party motion: at most 24 pieces and 900ms in all).
  const delay = (((i * 53) % 100) / 100) * 0.15;
  const duration = 0.6 + (((i * 29) % 100) / 100) * 0.15;
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

/** A brief burst of paper for the podium, pure CSS; never blocks taps, and none at all under prefers-reduced-motion. */
export function Confetti() {
  return (
    <div className="confetti" aria-hidden="true" data-testid="confetti">
      {Array.from({ length: PIECES }, (_, i) => (
        <span key={i} className={`confetti__piece${i % 3 === 0 ? ' confetti__piece--round' : ''}`} style={pieceStyle(i)} />
      ))}
    </div>
  );
}
