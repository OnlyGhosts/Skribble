import type { CSSProperties } from 'react';

const PIECES = 36;
const COLORS = ['#f59e0b', '#ef4444', '#6c5ce7', '#16a34a', '#0ea5e9', '#ec4899'];

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
