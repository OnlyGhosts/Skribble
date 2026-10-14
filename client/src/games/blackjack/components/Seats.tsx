import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { MiniSeat, SeatStrip, type SeatLine } from '../../../platform/table/SeatStrip';
import { playerOf } from '../hooks';
import type { TableHand, TableModel } from '../lib/table';
import { outcomesShown, type Timeline } from '../lib/timeline';
import { formatChips, outcomeLabel, payoutText } from '../lib/text';
import { Hand, handOnScreen } from './Hand';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  ids: string[];
  table: TableModel | null;
  timeline: Timeline;
  now: number;
  leaving: boolean;
  /** Shown chips while a payout is still on its way (see Table). */
  chipsOf(id: string): number;
}

/**
 * One short line under a seat: what it is doing, or how its round went. While the dealer's reveal
 * still plays (`dealerPlaying`) a seat with cards waits for it, so nothing runs ahead of the table.
 */
export function seatLine(view: BlackjackView, id: string, hands: TableHand[], settledShown: boolean, dealerPlaying = false): SeatLine {
  const seat = view.players[id];
  if (dealerPlaying && hands.length > 0) return { state: 'waiting', text: 'Waiting', tone: 'quiet' };
  if (seat.bustedOut) return { state: 'out', text: 'Out', tone: 'bad' };
  const betting = view.phase === 'betting' && view.order.includes(id);
  if (betting && seat.bet > 0) return { state: 'bet', text: `Bet ${formatChips(seat.bet)}`, tone: 'quiet' };
  if (view.phase === 'acting' && view.turn?.playerId === id) return { state: 'playing', text: 'Playing', tone: 'turn' };
  if (settledShown && hands.length > 0) {
    const back = hands.reduce((sum, h) => sum + (h.payout ?? 0), 0);
    const staked = hands.reduce((sum, h) => sum + h.bet, 0);
    const outcome = hands.length === 1 && hands[0].outcome ? outcomeLabel(hands[0].outcome) : back > staked ? 'Win' : back === staked ? 'Push' : 'Lost';
    // A push only hands the stake back: no "+N", which would read as a win.
    return { state: 'settled', text: back > 0 && outcome !== 'Push' ? `${outcome} ${payoutText(back)}` : outcome, tone: 'strong' };
  }
  if (view.phase === 'acting' && hands.length > 0) {
    const order = view.order.indexOf(id);
    const turn = view.turn ? view.order.indexOf(view.turn.playerId) : -1;
    if (order > turn) return { state: 'waiting', text: 'Waiting', tone: 'quiet' };
    return { state: 'done', text: hands.every((h) => h.status === 'bust') ? 'Bust' : hands[0].status === 'blackjack' ? 'Blackjack' : 'Stands', tone: 'quiet' };
  }
  if (betting) return { state: 'betting', text: 'Betting', tone: 'quiet' };
  if (view.phase === 'ending' || view.phase === 'gameOver') return { state: 'next', text: '', tone: 'quiet' };
  return { state: 'next', text: 'Next round', tone: 'quiet' };
}

/**
 * The other players in the platform's seat strip: avatar, name, chips, the hands in miniature with
 * their totals and a line on what they are doing. The seat whose turn it is lights up.
 */
export function Seats({ room, view, ids, table, timeline, now, leaving, chipsOf }: Props) {
  const turnId = view.phase === 'acting' ? view.turn?.playerId : undefined;
  if (ids.length === 0) return null;
  return (
    <SeatStrip turnId={turnId} label="Other players">
      {ids.map((id) => {
        const player = playerOf(room, id);
        const seat = view.players[id];
        if (!player || !seat) return null;
        const hands = table?.hands[id] ?? [];
        const settledShown = Boolean(table?.settled) && hands.some((h, i) => handOnScreen(id, i, h, timeline, now).outcome !== null);
        const dealerPlaying = Boolean(table?.settled) && !outcomesShown(timeline, now);
        const turn = turnId === id;
        return (
          <MiniSeat
            key={id}
            playerId={id}
            name={player.name}
            avatar={player.avatar}
            connected={player.connected}
            chips={chipsOf(id)}
            line={seatLine(view, id, hands, settledShown, dealerPlaying)}
            turn={turn}
            dimmed={seat.bustedOut}
            data={{ 'data-chips': seat.chips, 'data-bet': seat.bet }}
          >
            {hands.map((hand, i) => (
              <Hand key={i} playerId={id} index={i} hand={hand} timeline={timeline} now={now} leaving={leaving} size="sm" active={turn && view.turn?.handIndex === i} mini testId="seat-hand" />
            ))}
          </MiniSeat>
        );
      })}
    </SeatStrip>
  );
}
