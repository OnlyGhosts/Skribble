import type { PokerView } from '@shared/games/poker/protocol';
import { Chips } from '../../../platform/components/Chips';
import { PlayingCard, type PlayingCardSize } from '../../../platform/components/PlayingCard';
import { PayoutFloat, TotalPill, outlineClass, type Tone } from '../../../platform/table/Outcome';
import { TableCard } from '../../../platform/table/TableCard';
import { boardOnScreen, holeOnScreen, sameCard, winningCards, wonOnScreen } from '../lib/screen';
import type { PokerTable } from '../lib/table';
import { betAnchor, betValue, outcomesShown, paidOut, seatAnchor, valueAt, type Timeline } from '../lib/timeline';
import { handHint, lastActionLabel, payoutText } from '../lib/text';
import { DealerButton } from './DealerButton';

interface Props {
  view: PokerView;
  meId: string;
  table: PokerTable | null;
  timeline: Timeline;
  /** The current timeline, for the numbers on show. */
  live: Timeline;
  now: number;
  leaving: boolean;
  size: PlayingCardSize;
}

/** The line under my cards: what I did last, or where I stand in the hand. */
function myState(view: PokerView, meId: string, myTurn: boolean): string {
  const seat = view.players[meId];
  if (!seat) return '';
  if (seat.busted) return 'Out of chips';
  if (!view.order.includes(meId)) return 'Next hand';
  if (seat.status === 'folded') return 'Folded';
  if (seat.status === 'allIn') return 'All in';
  if (myTurn) return 'Your turn';
  return lastActionLabel(seat.lastAction);
}

/**
 * My seat, bottom centre: my two hole cards large with the best hand they make right now in a
 * pill over them, the bet in front of me, the dealer button and my last move. Lit on my turn,
 * outlined in lime when I win, the payout rising out of it.
 */
export function MyHand({ view, meId, table, timeline, live, now, leaving, size }: Props) {
  const seat = view.players[meId];
  const cards = holeOnScreen(table, timeline, meId, meId, now);
  const myTurn = view.phase === 'acting' && view.turn === meId;
  const folded = seat?.status === 'folded';
  const up = cards.flatMap((c) => (c.card ? [c.card] : []));
  const board = boardOnScreen(table, timeline, now).flatMap((c) => (c?.card ? [c.card] : []));
  const hint = up.length === 2 && !leaving ? handHint(up, board) : null;
  const won = wonOnScreen(table, timeline, meId, now);
  const lost = Boolean(table?.results) && outcomesShown(timeline, now) && won === 0 && !folded && cards.length > 0 && !leaving;
  const tone: Tone = won > 0 ? 'win' : lost ? 'loss' : myTurn ? 'active' : 'neutral';
  const best = winningCards(table, timeline, now);
  const bet = valueAt(live, betValue(meId), seat?.bet ?? 0, now);
  const state = myState(view, meId, myTurn);
  return (
    <section
      className={`pk-mine ${outlineClass(tone)}${folded ? ' pk-mine--folded' : ''}`}
      aria-label="Your hand"
      data-testid="my-area"
      data-table-anchor={seatAnchor(meId)}
      data-player-id={meId}
      data-role={seat ? 'player' : 'spectator'}
      data-status={seat ? (seat.busted ? 'out' : seat.status) : 'spectator'}
      data-my-turn={myTurn}
      data-dealer={seat?.isDealer ?? false}
      data-outcome={won > 0 ? 'win' : lost ? 'loss' : undefined}
      data-payout={won > 0 ? won : undefined}
    >
      <div className="pk-mine__top">
        {hint && (
          <TotalPill tone={won > 0 ? 'win' : folded ? 'push' : 'neutral'} testId="hand-hint">
            {hint}
          </TotalPill>
        )}
        {won > 0 && paidOut(timeline, now) && <PayoutFloat text={payoutText(won)} />}
      </div>
      <div className={`pk-mine__cards${folded ? ' pk-mine__cards--folded' : ''}`} role="group" aria-label="Your cards" data-testid="my-cards">
        {cards.length > 0
          ? cards.map((c) => <TableCard key={`${timeline.id}:${c.key}`} card={c.card} size={size} motion={c.motion} leaving={leaving} flipping={c.flipping} highlight={c.card !== null && best.some((b) => c.card !== null && sameCard(b, c.card))} testId="my-card" />)
          : [0, 1].map((i) => <PlayingCard key={i} card={null} size={size} slot testId="my-slot" />)}
      </div>
      <div className="pk-mine__foot">
        {seat?.isDealer && <DealerButton testId="my-dealer" />}
        <span className="pk-bet pk-bet--mine" data-table-anchor={betAnchor(meId)} data-testid="my-bet" data-bet={bet}>
          {bet > 0 && <Chips value={bet} size={13} />}
        </span>
        {state && (
          <span className={`pk-mine__state${seat?.status === 'allIn' ? ' pk-mine__state--allin' : ''}`} data-testid="my-state">
            {state}
          </span>
        )}
      </div>
    </section>
  );
}
