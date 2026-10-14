import type { PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { Chips } from '../../../platform/components/Chips';
import { PayoutFloat } from '../../../platform/table/Outcome';
import { MiniSeat, SeatStrip, type SeatLine } from '../../../platform/table/SeatStrip';
import { TableCard } from '../../../platform/table/TableCard';
import { playerOf } from '../hooks';
import { holeOnScreen, sameCard, winningCards, wonOnScreen } from '../lib/screen';
import type { PokerTable } from '../lib/table';
import { betAnchor, betValue, chipsValue, outcomesShown, paidOut, valueAt, type Timeline } from '../lib/timeline';
import { categoryLabel, lastActionLabel, payoutText } from '../lib/text';
import { DealerButton } from './DealerButton';

interface Props {
  room: PokerRoomState;
  view: PokerView;
  ids: string[];
  meId: string;
  table: PokerTable | null;
  timeline: Timeline;
  /** The current timeline, for the numbers on show. */
  live: Timeline;
  now: number;
  leaving: boolean;
}

/** One short line under a seat: how its hand ended, what it is doing, or its last move. */
export function seatLine(view: PokerView, table: PokerTable | null, id: string, timeline: Timeline, now: number): SeatLine {
  const seat = view.players[id];
  if (seat.busted) return { state: 'out', text: 'Out', tone: 'bad' };
  if (!view.order.includes(id)) return { state: 'next', text: 'Next hand', tone: 'quiet' };
  const results = table?.results;
  if (results && outcomesShown(timeline, now)) {
    const shown = results.revealed[id];
    if (wonOnScreen(table, timeline, id, now) > 0) return { state: 'won', text: shown ? categoryLabel(shown.category) : 'Wins', tone: 'strong' };
    if (shown) return { state: 'shown', text: categoryLabel(shown.category), tone: 'quiet' };
  }
  if (seat.status === 'folded') return { state: 'folded', text: 'Folded', tone: 'quiet' };
  if (view.phase === 'acting' && view.turn === id) return { state: 'turn', text: 'Thinking', tone: 'turn' };
  if (seat.status === 'allIn') return { state: 'allin', text: 'All in', tone: 'strong' };
  const action = lastActionLabel(seat.lastAction);
  if (action) return { state: 'acted', text: action, tone: 'quiet' };
  // The move that closed the last street, until somebody moves again.
  const move = view.lastMove;
  if (move && move.playerId === id && move.street !== view.street) return { state: 'acted', text: lastActionLabel(move), tone: 'quiet' };
  return { state: 'waiting', text: '', tone: 'quiet' };
}

/**
 * The other players in the platform's seat strip: avatar, name, stack, the bet in front of them,
 * the dealer button, their last move and two small cards while they hold a hand. The seat whose
 * turn it is lights up; folded and busted seats are dimmed; a winner is outlined in lime.
 */
export function Seats({ room, view, ids, meId, table, timeline, live, now, leaving }: Props) {
  const turnId = view.phase === 'acting' ? (view.turn ?? undefined) : undefined;
  const best = winningCards(table, timeline, now);
  if (ids.length === 0) return null;
  return (
    <SeatStrip turnId={turnId} label="Other players" homeWhenAway>
      {ids.map((id) => {
        const player = playerOf(room, id);
        const seat = view.players[id];
        if (!player || !seat) return null;
        const won = wonOnScreen(table, timeline, id, now);
        const bet = valueAt(live, betValue(id), seat.bet, now);
        const status = seat.busted ? 'out' : seat.status;
        return (
          <MiniSeat
            key={id}
            playerId={id}
            name={player.name}
            avatar={player.avatar}
            connected={player.connected}
            chips={valueAt(live, chipsValue(id), seat.chips, now)}
            line={seatLine(view, table, id, timeline, now)}
            turn={turnId === id}
            dimmed={seat.busted || seat.status === 'folded' || !view.order.includes(id)}
            badge={seat.isDealer && <DealerButton testId="seat-dealer" />}
            className={won > 0 ? 'pk-seat--win' : undefined}
            data={{ 'data-chips': seat.chips, 'data-bet': seat.bet, 'data-status': status, 'data-dealer': seat.isDealer, 'data-outcome': won > 0 ? 'win' : undefined, 'data-payout': won > 0 ? won : undefined }}
          >
            {holeOnScreen(table, timeline, id, meId, now).map((c) => (
              <TableCard key={`${timeline.id}:${c.key}`} card={c.card} size="sm" motion={c.motion} leaving={leaving || c.leaving} flipping={c.flipping} highlight={c.card !== null && best.some((b) => c.card !== null && sameCard(b, c.card))} testId="seat-card" />
            ))}
            <span className="pk-bet" data-table-anchor={betAnchor(id)} data-testid="seat-bet" data-bet={bet}>
              {bet > 0 && <Chips value={bet} size={11} />}
            </span>
            {won > 0 && paidOut(timeline, now) && <PayoutFloat text={payoutText(won)} />}
          </MiniSeat>
        );
      })}
    </SeatStrip>
  );
}
