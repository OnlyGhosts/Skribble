import { useEffect, useRef } from 'react';
import { formatSeconds } from '../lib/format';
import { playCue } from '../lib/sound';
import { useCountdownSeconds } from '../lib/useCountdown';

interface Props {
  endsAt: number | null | undefined;
  /** Seconds under which the timer turns red. */
  warnUnder?: number;
  /** When set, a tick sound plays for each of the final seconds (used during drawing). */
  tickUnder?: number;
  size?: 'md' | 'lg';
}

export function Timer({ endsAt, warnUnder = 10, tickUnder, size = 'lg' }: Props) {
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
  return (
    <div
      className={`timer timer--${size}${urgent ? ' timer--urgent' : ''}`}
      role="timer"
      aria-label={`${seconds} seconds left`}
      data-testid="timer"
      data-seconds={seconds}
    >
      <svg className="timer__ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15.5" />
      </svg>
      <span className="timer__value">{endsAt == null ? '–' : formatSeconds(seconds)}</span>
    </div>
  );
}
