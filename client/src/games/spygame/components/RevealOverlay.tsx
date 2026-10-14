import { useRef } from 'react';
import { locationById } from '@shared/games/spygame/locations';
import type { SpygameRevealView, SpygameRoomState, SpygameView } from '@shared/games/spygame/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { ResultNext, ResultPoints, earnersOf } from '../../../platform/components/RoundResult';
import { useCountdownSeconds } from '../../../platform/lib/useCountdown';
import { useModalFocus } from '../../../platform/lib/useModalFocus';
import { endGame, skipReveal } from '../actions';
import { playerOf } from '../hooks';
import { outcomeDetail, outcomeHeadline, winnerKicker } from '../lib/text';
import { LocationTile } from './LocationTile';

interface Props {
  room: SpygameRoomState;
  view: SpygameView;
  reveal: SpygameRevealView;
  isHost: boolean;
  /** The platform holds at this round boundary for players whose phones went dark: nothing counts down. */
  holding?: boolean;
}

/**
 * The end of a round: who the spy was, where everyone was, how it ended and what it paid. The
 * countdown to the next round freezes while the game holds for missing players, and once it has
 * run out (the server settles for a moment after a hold, or its tick is a beat away) it shows the
 * round as starting rather than a red "0".
 */
export function RevealOverlay({ room, view, reveal, isHost, holding = false }: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(cardRef, true);
  const seconds = useCountdownSeconds(holding ? null : reveal.endsAt);
  const settling = !holding && seconds <= 0;
  const spy = playerOf(room, reveal.spyId);
  // The name travels with the reveal: a spy who left for good has no seat to look up any more.
  const spyName = reveal.spyName;
  const location = locationById(reveal.locationId);
  const isLast = view.round >= view.totalRounds;
  const nextLabel = isLast ? 'Show results' : 'Next round';
  const nextNoun = isLast ? 'Results' : 'Next round';
  const countdownState = holding ? 'paused' : settling ? 'settling' : 'running';
  const rows = earnersOf(room.players, reveal.points).map(({ player, points }) => ({
    id: player.id,
    player,
    name: player.name,
    points,
    tag: player.id === reveal.spyId ? 'spy' : undefined,
    data: { 'data-player-id': player.id, 'data-name': player.name, 'data-points': points },
  }));

  return (
    <div className="spy-reveal" data-testid="spygame-reveal" data-outcome={reveal.outcome}>
      <div ref={cardRef} className="overlay__card result-card spy-reveal__card" role="dialog" aria-modal="true" aria-label="Round over" tabIndex={-1}>
        <p className="result-kicker">{winnerKicker(reveal.outcome)}</p>
        <h2 className="overlay__title" data-testid="reveal-headline">
          {outcomeHeadline(reveal.outcome)}
        </h2>
        <div className="spy-reveal__facts">
          <div className="spy-reveal__spy" data-testid="reveal-spy" data-player-id={reveal.spyId}>
            {spy && <Avatar avatar={spy.avatar} size="lg" />}
            <span>
              <span className="spy-reveal__label">The spy was</span>
              <strong className="spy-reveal__name">{spyName}</strong>
            </span>
          </div>
          {location && (
            <div className="spy-reveal__place" data-testid="reveal-location" data-location-id={location.id}>
              <LocationTile location={location} size="lg" label="The location was" />
            </div>
          )}
        </div>
        <p className="overlay__hint">{outcomeDetail(reveal.outcome, spyName, location?.name ?? reveal.locationId)}</p>
        <ResultPoints rows={rows} label="Points earned this round" rowTestId="reveal-points-row" empty="Nobody scored this round." />
        <div className="overlay__footer spy-reveal__footer">
          {isHost ? (
            <>
              <button type="button" className="btn btn--primary" onClick={skipReveal} disabled={holding} data-testid="spygame-next-round" data-countdown={countdownState}>
                {holding ? `${nextLabel} (paused)` : settling ? `${nextLabel}…` : `${nextLabel} (${seconds})`}
              </button>
              <button type="button" className="btn btn--ghost" onClick={endGame} data-testid="spygame-end-game">
                Back to lobby
              </button>
            </>
          ) : (
            <ResultNext noun={nextNoun} endsAt={reveal.endsAt} paused={holding} settling={settling} testId="reveal-countdown" />
          )}
        </div>
      </div>
    </div>
  );
}
