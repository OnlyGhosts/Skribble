import { useRef } from 'react';
import type { Card, PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { Chips } from '../../../platform/components/Chips';
import { PlayingCard } from '../../../platform/components/PlayingCard';
import { Timer } from '../../../platform/components/Timer';
import { formatChips } from '../../../platform/lib/format';
import { useCountdownSeconds } from '../../../platform/lib/useCountdown';
import { useModalFocus } from '../../../platform/lib/useModalFocus';
import { nextHand } from '../actions';
import { nameOf, playerOf } from '../hooks';
import { handLabel, netLabel } from '../lib/text';

interface Props {
  room: PokerRoomState;
  view: PokerView;
  isHost: boolean;
  /** The platform holds here for missing players: nothing counts down and the host cannot skip. */
  holding: boolean;
}

const sameCard = (a: Card, b: Card): boolean => a.rank === b.rank && a.suit === b.suit;

function headline(room: PokerRoomState, view: PokerView): string {
  const results = view.results;
  const main = results?.pots[0];
  if (!results || !main || main.winners.length === 0) return 'The hand is over';
  const names = main.winners.map((w) => nameOf(room, w.playerId));
  if (results.uncontested) return `${names[0]} takes the pot`;
  const hand = main.handName ? ` with ${main.handName.charAt(0).toLowerCase()}${main.handName.slice(1)}` : '';
  return names.length > 1 ? `Split pot${hand}` : `${names[0]} wins${hand}`;
}

/** Whether the game ends after this hand: the hands cap is reached or fewer than two stacks remain. */
function lastHand(view: PokerView): boolean {
  if (view.totalHands > 0 && view.hand >= view.totalHands) return true;
  return Object.values(view.players).filter((p) => p.chips > 0).length < 2;
}

/**
 * The hand's settlement over the table: who won each pot and with what, every contender's
 * revealed cards (the five that play lifted) and every player's net. Folded hands stay hidden;
 * a pot nobody contested shows no cards at all.
 */
export function ResultsOverlay({ room, view, isHost, holding }: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(cardRef, true);
  const paused = holding || view.paused;
  const seconds = useCountdownSeconds(paused ? null : view.endsAt);
  const results = view.results;
  if (!results) return null;
  const settling = !paused && seconds <= 0;
  const label = lastHand(view) ? 'Final standings' : 'Next hand';
  const state = paused ? 'paused' : settling ? 'settling' : 'running';
  const winners = new Set(results.pots.flatMap((p) => p.winners.map((w) => w.playerId)));
  const mainWinner = results.pots[0]?.winners[0]?.playerId;
  const winningFive = mainWinner ? (results.revealed[mainWinner]?.best ?? []) : [];
  const ids = view.order.filter((id) => results.net[id] !== undefined || results.revealed[id] !== undefined).sort((a, b) => (results.net[b] ?? 0) - (results.net[a] ?? 0));

  return (
    <div className="pk-overlay" data-testid="overlay-results" data-hand={view.hand} data-uncontested={results.uncontested}>
      <div ref={cardRef} className="overlay__card overlay__card--wide pk-results" role="dialog" aria-modal="true" aria-label="Hand results" tabIndex={-1} data-testid="results-dialog">
        <p className="overlay__kicker">{handLabel(view, true)}</p>
        <h2 className="overlay__title" data-testid="results-headline">
          {headline(room, view)}
        </h2>
        {view.community.length > 0 && (
          <div className="pk-results__board" role="group" aria-label="The board" data-testid="results-board">
            {view.community.map((card, i) => (
              <PlayingCard key={`${i}-${card.rank}${card.suit}`} card={card} size="sm" testId="results-board-card" highlight={winningFive.some((b) => sameCard(b, card))} />
            ))}
          </div>
        )}
        <ul className="pk-results__pots" aria-label="Pots">
          {results.pots.map((pot, i) => (
            <li key={i} className="pk-results__pot" data-testid="result-pot" data-amount={pot.amount} data-winners={pot.winners.map((w) => w.playerId).join(',')}>
              <span className="pk-results__pot-name">{results.pots.length > 1 ? (i === 0 ? 'Main pot' : `Side pot ${i}`) : 'Pot'}</span>
              <Chips value={pot.amount} size={12} />
              <span className="pk-results__pot-to">→ {pot.winners.map((w) => `${nameOf(room, w.playerId)} ${formatChips(w.amount)}`).join(', ')}</span>
            </li>
          ))}
        </ul>
        <ul className="pk-results__list" aria-label="Players this hand">
          {ids.map((id) => {
            const player = playerOf(room, id);
            const revealed = results.revealed[id];
            const net = results.net[id] ?? 0;
            const seat = view.players[id];
            const won = winners.has(id);
            return (
              <li key={id} className={`pk-results__row${won ? ' pk-results__row--won' : ''}`} data-testid="result-player" data-player-id={id} data-name={player?.name} data-net={net} data-revealed={Boolean(revealed)} data-won={won} data-chips={seat?.chips}>
                {player && <Avatar avatar={player.avatar} size="sm" dimmed={!player.connected} />}
                <span className="pk-results__body">
                  <span className="pk-results__head">
                    <span className="pk-results__name">{player?.name ?? 'Someone'}</span>
                    <span className={`pk-results__net${net > 0 ? ' pk-results__net--won' : net < 0 ? ' pk-results__net--lost' : ''}`} data-testid="result-net">
                      {netLabel(net)}
                    </span>
                  </span>
                  <span className="pk-results__detail">
                    {revealed ? (
                      <>
                        <span className="pk-results__cards" aria-label={`${player?.name ?? 'Their'} cards`}>
                          {revealed.cards.map((card, i) => (
                            <PlayingCard key={`${i}-${card.rank}${card.suit}`} card={card} size="sm" testId="revealed-card" highlight={revealed.best.some((b) => sameCard(b, card))} />
                          ))}
                        </span>
                        <span className="pk-results__hand" data-testid="revealed-hand">
                          {revealed.name}
                        </span>
                      </>
                    ) : (
                      <span className="pk-results__hand pk-results__hand--hidden">{won ? 'Cards not shown' : 'Folded'}</span>
                    )}
                    {seat && (
                      <span className="pk-results__chips" data-testid="result-chips">
                        now <Chips value={seat.chips} size={12} />
                      </span>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="overlay__footer pk-results__footer">
          {isHost && !paused ? (
            <button type="button" className="btn btn--primary btn--lg" onClick={nextHand} data-testid="poker-next" data-countdown={state}>
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
