import { useRef } from 'react';
import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { Timer } from '../../../platform/components/Timer';
import { useCountdownSeconds } from '../../../platform/lib/useCountdown';
import { useModalFocus } from '../../../platform/lib/useModalFocus';
import { nextRound } from '../actions';
import { playerOf } from '../hooks';
import { dealerTotalLabel, netLabel, outcomeLabel, roundLabel, totalLabel } from '../lib/text';
import { PlayingCard } from './Card';
import { Chips } from './Chips';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  isHost: boolean;
  /** The platform holds here for missing players: nothing counts down and the host cannot skip. */
  holding: boolean;
}

function headline(view: BlackjackView): string {
  if (view.results.length === 0) return 'Nobody bet this round';
  const { dealer } = view;
  if (dealer.blackjack) return 'The dealer has blackjack';
  if (dealer.total > 21) return `The dealer busts with ${dealer.total}`;
  return `The dealer stands on ${dealer.total}`;
}

/** The round's settlement over the table: every hand with its outcome and what it paid, then on to the next round. */
export function ResultsOverlay({ room, view, isHost, holding }: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(cardRef, true);
  const paused = holding || view.paused;
  const seconds = useCountdownSeconds(paused ? null : view.endsAt);
  const settling = !paused && seconds <= 0;
  const last = view.round >= view.totalRounds;
  const label = last ? 'Final standings' : 'Next round';
  const state = paused ? 'paused' : settling ? 'settling' : 'running';
  return (
    <div className="bj-overlay" data-testid="overlay-results" data-round={view.round}>
      <div ref={cardRef} className="overlay__card overlay__card--wide bj-results" role="dialog" aria-modal="true" aria-label="Round results" tabIndex={-1} data-testid="results-dialog">
        <p className="overlay__kicker">{roundLabel(view, true)}</p>
        <h2 className="overlay__title" data-testid="results-headline">
          {headline(view)}
        </h2>
        {view.results.length > 0 && <p className="overlay__hint">Dealer: {dealerTotalLabel(view.dealer)}</p>}
        <ul className="bj-results__list" aria-label="Hands this round">
          {view.results.map((r) => {
            const player = playerOf(room, r.playerId);
            const seat = view.players[r.playerId];
            const hand = seat?.hands[r.handIndex];
            const net = r.payout - r.bet;
            const several = (seat?.hands.length ?? 0) > 1;
            return (
              <li
                key={`${r.playerId}-${r.handIndex}`}
                className={`bj-results__row bj-results__row--${r.outcome}`}
                data-testid="result-hand"
                data-player-id={r.playerId}
                data-name={player?.name}
                data-hand={r.handIndex}
                data-outcome={r.outcome}
                data-bet={r.bet}
                data-payout={r.payout}
                data-chips={seat?.chips}
              >
                {player && <Avatar avatar={player.avatar} size="sm" dimmed={!player.connected} />}
                <span className="bj-results__body">
                  <span className="bj-results__head">
                    <span className="bj-results__name">{player?.name ?? 'Someone'}</span>
                    {several && <span className="bj-tag">hand {r.handIndex + 1}</span>}
                    <span className="bj-results__outcome">
                      <span className={`bj-status bj-status--${r.outcome}`}>{outcomeLabel(r.outcome)}</span>
                      <span className={`bj-results__net${net > 0 ? ' bj-results__net--won' : net < 0 ? ' bj-results__net--lost' : ''}`} data-testid="result-net" data-net={net}>
                        {netLabel(net)}
                      </span>
                    </span>
                  </span>
                  <span className="bj-results__detail">
                    {hand && (
                      <span className="bj-results__cards" aria-label={totalLabel(hand, r.outcome === 'blackjack')}>
                        {hand.cards.map((card, i) => (
                          <PlayingCard key={`${i}-${card.rank}${card.suit}`} card={card} size="sm" />
                        ))}
                        <span className="bj-results__total">{totalLabel(hand, r.outcome === 'blackjack')}</span>
                      </span>
                    )}
                    {seat && (
                      <span className="bj-results__chips">
                        now <Chips value={seat.chips} size={12} />
                      </span>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="overlay__footer bj-results__footer">
          {isHost && !paused ? (
            <button type="button" className="btn btn--primary btn--lg" onClick={nextRound} data-testid="bj-next" data-countdown={state}>
              {settling ? `${label}…` : `${label} (${seconds})`}
            </button>
          ) : (
            <>
              <span data-testid="results-countdown" data-countdown={state}>
                {paused ? `${label} is paused` : settling ? `${label} starting…` : `${label} in`}
              </span>
              {!paused && !settling && <Timer endsAt={view.endsAt} size="md" warnUnder={0} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
