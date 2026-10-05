import { useRef } from 'react';
import { locationById } from '@shared/games/spygame/locations';
import type { SpygameRevealView, SpygameRoomState, SpygameView } from '@shared/games/spygame/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { Timer } from '../../../platform/components/Timer';
import { formatPoints } from '../../../platform/lib/format';
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
}

/** The end of a round: who the spy was, where everyone was, how it ended and what it paid. */
export function RevealOverlay({ room, view, reveal, isHost }: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(cardRef, true);
  const seconds = useCountdownSeconds(reveal.endsAt);
  const spy = playerOf(room, reveal.spyId);
  // The name travels with the reveal: a spy who left for good has no seat to look up any more.
  const spyName = reveal.spyName;
  const location = locationById(reveal.locationId);
  const isLast = view.round >= view.totalRounds;
  const nextLabel = isLast ? 'Show results' : 'Next round';
  const earners = room.players
    .map((p) => ({ player: p, points: reveal.points[p.id] ?? 0 }))
    .filter((e) => e.points > 0)
    .sort((a, b) => b.points - a.points || a.player.joinOrder - b.player.joinOrder);

  return (
    <div className="spy-reveal" data-testid="spygame-reveal" data-outcome={reveal.outcome}>
      <div ref={cardRef} className="overlay__card overlay__card--wide spy-reveal__card" role="dialog" aria-modal="true" aria-label="Round over" tabIndex={-1}>
        <p className="overlay__kicker">{winnerKicker(reveal.outcome)}</p>
        <h2 className="overlay__title" data-testid="reveal-headline">
          {outcomeHeadline(reveal.outcome)}
        </h2>
        <div className="spy-reveal__facts">
          <div className="spy-reveal__spy" data-testid="reveal-spy" data-player-id={reveal.spyId}>
            {spy && <Avatar avatar={spy.avatar} size="xl" />}
            <span className="spy-reveal__label">The spy was</span>
            <strong className="spy-reveal__name">{spyName}</strong>
          </div>
          {location && (
            <div className="spy-reveal__place" data-testid="reveal-location" data-location-id={location.id}>
              <LocationTile location={location} size="lg" />
            </div>
          )}
        </div>
        <p className="overlay__hint">{outcomeDetail(reveal.outcome, spyName, location?.name ?? reveal.locationId)}</p>
        {earners.length > 0 ? (
          <ul className="spy-points spy-reveal__points" aria-label="Points earned this round">
            {earners.map(({ player, points }) => (
              <li key={player.id} className="spy-points__row" data-testid="reveal-points-row" data-player-id={player.id} data-name={player.name} data-points={points}>
                <Avatar avatar={player.avatar} size="sm" />
                <span className="spy-points__name">
                  {player.name}
                  {player.id === reveal.spyId && <span className="spy-points__tag">spy</span>}
                </span>
                <span className="spy-points__pts">{formatPoints(points)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="overlay__hint">Nobody scored this round.</p>
        )}
        <div className="overlay__footer spy-reveal__footer">
          {isHost ? (
            <>
              <button type="button" className="btn btn--primary" onClick={skipReveal} data-testid="spygame-next-round">
                {nextLabel} ({seconds})
              </button>
              <button type="button" className="btn btn--ghost" onClick={endGame} data-testid="spygame-end-game">
                Back to lobby
              </button>
            </>
          ) : (
            <>
              <span data-testid="reveal-countdown">{isLast ? 'Results in' : 'Next round in'}</span>
              <Timer endsAt={reveal.endsAt} size="md" warnUnder={0} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
