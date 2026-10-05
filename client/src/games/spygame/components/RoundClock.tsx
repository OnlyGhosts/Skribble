import type { SpygameClock } from '@shared/games/spygame/protocol';
import { Timer } from '../../../platform/components/Timer';
import { formatSeconds } from '../../../platform/lib/format';
import { PauseIcon } from './Icons';

/** The round clock: the platform timer while it runs, a frozen face with the kept time while it is paused. */
export function RoundClock({ clock }: { clock: SpygameClock }) {
  if (clock.endsAt !== null) return <Timer endsAt={clock.endsAt} warnUnder={30} tickUnder={5} />;
  const seconds = Math.ceil(clock.pausedRemainingMs / 1000);
  const label = clock.pausedReason === 'vote' ? 'Vote' : clock.pausedReason === 'spyAway' ? 'Waiting' : 'Round over';
  return (
    <div className="timer timer--lg spy-clock--paused" role="timer" aria-label={`Clock paused at ${seconds} seconds`} data-testid="timer" data-seconds={seconds} data-paused={clock.pausedReason}>
      <svg className="timer__ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15.5" />
      </svg>
      <span className="timer__value">{formatSeconds(seconds)}</span>
      <span className="spy-clock__label" aria-hidden="true">
        <PauseIcon size={10} /> {label}
      </span>
    </div>
  );
}
