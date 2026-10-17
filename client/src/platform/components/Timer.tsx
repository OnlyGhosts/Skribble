import { useEffect, useRef, type ReactNode } from 'react';
import { formatSeconds } from '../lib/format';
import { useMediaQuery } from '../lib/media';
import { playCue } from '../lib/sound';
import { arcFraction, useCountdown, useDeadlineTotal } from '../lib/useCountdown';
import { PauseIcon } from './Icons';

interface Props {
  endsAt: number | null | undefined;
  /** Seconds under which the timer turns red (never more than the last 5; 0 for a clock that is never urgent). */
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
  /** A small word under the ring saying what it counts (The Spy Game's "Vote" while a vote runs). */
  label?: ReactNode;
  /** Extra data attributes on the timer (what a game's tests read about it). */
  data?: Record<`data-${string}`, string>;
}

/** The last seconds turn the ring and the number to the danger colour. */
const URGENT_SECONDS = 5;

export function Timer({ endsAt: deadline, warnUnder = 10, tickUnder, size = 'lg', paused = false, settling = false, label, data }: Props) {
  const endsAt = paused || settling ? null : deadline;
  const remaining = useCountdown(endsAt);
  const seconds = Math.ceil(remaining / 1000);
  const total = useDeadlineTotal(endsAt);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const lastTicked = useRef<number | null>(null);

  useEffect(() => {
    if (tickUnder === undefined || endsAt == null) return;
    if (seconds > 0 && seconds <= tickUnder && lastTicked.current !== seconds) {
      lastTicked.current = seconds;
      playCue('tick');
    }
  }, [seconds, tickUnder, endsAt]);

  const urgent = endsAt != null && warnUnder > 0 && seconds <= Math.min(warnUnder, URGENT_SECONDS);
  // Without a running deadline (paused, settling, none) the ring stays whole, as it always was.
  // Reduced motion steps the arc once a second instead of sweeping it.
  const lit = endsAt == null ? 1 : arcFraction(reducedMotion ? seconds * 1000 : remaining, total);
  const face = paused ? 'paused' : settling ? 'settling' : 'running';
  // Plain seconds up to 99, as on the board; longer clocks (a Spy round) read m:ss in a smaller size.
  const long = seconds >= 100;
  return (
    <div
      className={`timer timer--${size}${long ? ' timer--long' : ''}${urgent ? ' timer--urgent' : ''}${paused ? ' timer--paused' : ''}${settling && !paused ? ' timer--settling' : ''}`}
      role="timer"
      aria-label={`${typeof label === 'string' ? `${label}: ` : ''}${paused ? 'Paused' : settling ? 'Starting soon' : `${seconds} seconds left`}`}
      data-testid="timer"
      data-seconds={seconds}
      data-paused={paused ? 'players' : undefined}
      data-face={face}
      {...data}
    >
      <svg className="timer__ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="timer__track" cx="18" cy="18" r="15.5" />
        <circle className="timer__arc" cx="18" cy="18" r="15.5" pathLength={100} strokeDasharray="100" strokeDashoffset={(100 * (1 - lit)).toFixed(2)} />
      </svg>
      <span className="timer__value">
        {paused ? <PauseIcon size={size === 'lg' ? 18 : 14} /> : settling ? <span className="spinner" aria-hidden="true" /> : endsAt == null ? '–' : long ? formatSeconds(seconds) : String(seconds)}
      </span>
      {label && (
        <span className="timer__label" aria-hidden="true">
          {label}
        </span>
      )}
    </div>
  );
}
