import { useEffect, useRef } from 'react';
import { formatSeconds } from '../lib/format';
import { playCue } from '../lib/sound';
import { useCountdownSeconds } from '../lib/useCountdown';
import { PauseIcon } from './Icons';

interface Props {
  endsAt: number | null | undefined;
  /** Seconds under which the timer turns red. */
  warnUnder?: number;
  /** When set, a tick sound plays for each of the final seconds (used during drawing). */
  tickUnder?: number;
  size?: 'md' | 'lg';
  /** The game is holding (waiting for players): a frozen face instead of a countdown that runs out. */
  paused?: boolean;
  /**
   * The deadline has passed and the next step is the server's (it settles for a moment after a
   * hold, or its tick is a beat away): a waiting glyph instead of a red "0" that sits there.
   */
  settling?: boolean;
}

export function Timer({ endsAt: deadline, warnUnder = 10, tickUnder, size = 'lg', paused = false, settling = false }: Props) {
  const endsAt = paused || settling ? null : deadline;
  const seconds = useCountdownSeconds(endsAt);
  const lastTicked = useRef<number | null>(null);

  useEffect(() => {
    if (tickUnder === undefined || endsAt == null) return;
    if (seconds > 0 && seconds <= tickUnder && lastTicked.current !== seconds) {
      lastTicked.current = seconds;
      playCue('tick');
    }
  }, [seconds, tickUnder, endsAt]);

  const urgent = endsAt != null && seconds <= warnUnder;
  const face = paused ? 'paused' : settling ? 'settling' : 'running';
  return (
    <div
      className={`timer timer--${size}${urgent ? ' timer--urgent' : ''}${paused ? ' timer--paused' : ''}${settling && !paused ? ' timer--settling' : ''}`}
      role="timer"
      aria-label={paused ? 'Paused' : settling ? 'Starting soon' : `${seconds} seconds left`}
      data-testid="timer"
      data-seconds={seconds}
      data-paused={paused ? 'players' : undefined}
      data-face={face}
    >
      <svg className="timer__ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15.5" />
      </svg>
      <span className="timer__value">
        {paused ? <PauseIcon size={size === 'lg' ? 18 : 14} /> : settling ? <span className="spinner" aria-hidden="true" /> : endsAt == null ? '–' : formatSeconds(seconds)}
      </span>
    </div>
  );
}
