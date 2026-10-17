import type { SpygameClock } from '@shared/games/spygame/protocol';
import { Timer } from '../../../platform/components/Timer';
import { formatSeconds } from '../../../platform/lib/format';
import { useCountdownSeconds } from '../../../platform/lib/useCountdown';
import { PauseIcon } from './Icons';

/** What the ring counts while the round clock stands still: the vote, or the time to the next round. */
export interface ClockStandIn {
  endsAt: number;
  label: string;
}

/**
 * The round clock: the platform timer while it runs, a frozen face with the kept time while it is
 * paused. The screen's one countdown lives here: while a vote runs or the round is over, the ring
 * counts that instead (`standIn`), so the vote and the reveal carry no timer of their own.
 * `holding` (the platform waits for players at a round boundary) freezes it whatever it says.
 */
export function RoundClock({ clock, holding = false, standIn = null }: { clock: SpygameClock; holding?: boolean; standIn?: ClockStandIn | null }) {
  const counting = standIn !== null && !holding && clock.pausedReason !== null ? standIn : null;
  // Once the stand-in's time is up the server's next step is a beat away: a waiting face, not a red "0".
  const settling = useCountdownSeconds(counting?.endsAt ?? null) <= 0;
  if (clock.endsAt !== null && !holding) return <Timer endsAt={clock.endsAt} warnUnder={30} tickUnder={5} />;
  if (counting && clock.pausedReason !== null) {
    return <Timer endsAt={counting.endsAt} warnUnder={5} settling={settling} label={counting.label} data={{ 'data-paused': clock.pausedReason, 'data-counting': counting.label }} />;
  }
  const seconds = clock.endsAt === null ? Math.ceil(clock.pausedRemainingMs / 1000) : 0;
  const label = holding ? 'Paused' : clock.pausedReason === 'vote' ? 'Vote' : clock.pausedReason === 'spyAway' ? 'Waiting' : 'Round over';
  const reason = holding ? 'players' : clock.pausedReason;
  return (
    <div
      className={`timer timer--lg${seconds >= 100 ? ' timer--long' : ''} spy-clock--paused`}
      role="timer"
      aria-label={`Clock paused at ${seconds} seconds`}
      data-testid="timer"
      data-seconds={seconds}
      data-paused={reason}
    >
      <svg className="timer__ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="timer__track" cx="18" cy="18" r="15.5" />
        <circle className="timer__arc" cx="18" cy="18" r="15.5" />
      </svg>
      <span className="timer__value">{seconds >= 100 ? formatSeconds(seconds) : seconds}</span>
      <span className="spy-clock__label" aria-hidden="true">
        <PauseIcon size={10} /> {label}
      </span>
    </div>
  );
}
