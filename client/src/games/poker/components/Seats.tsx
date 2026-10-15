import type { PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { Chips } from '../../../platform/components/Chips';
import { PayoutFloat } from '../../../platform/table/Outcome';
import { PlayerTile, PlayersGrid, SeatSheet, type SeatLine, type SeatMark } from '../../../platform/table/PlayersGrid';
import { TableCard } from '../../../platform/table/TableCard';
import { playerOf } from '../hooks';
import { holeOnScreen, sameCard, winningCards, wonOnScreen } from '../lib/screen';
import type { PokerTable } from '../lib/table';
import { betAnchor, betValue, chipsValue, outcomesShown, paidOut, valueAt, type Timeline } from '../lib/timeline';
import { categoryLabel, formatChips, lastActionLabel, payoutText } from '../lib/text';
import { usePoker, usePokerStore } from '../store';
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
  /** Desktop: the tiles along an arc. */
  wide: boolean;
}

/** One short line under a seat: how its hand ended, what it is doing, or its last move. */
export function seatLine(view: PokerView, table: PokerTable | null, id: string, timeline: Timeline, now: number): SeatLine {
  const seat = view.players[id];
  if (seat.busted) return { state: 'out', text: 'Out', tone: 'bad' };
  if (seat.waitingForSeat) return { state: 'no-seat', text: 'No seat yet', tone: 'quiet' };
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

/** The tile's status mark, from its line. */
export function seatMark(line: SeatLine): SeatMark {
  switch (line.state) {
    case 'turn':
      return 'turn';
    case 'won':
      return 'win';
    case 'shown':
      return 'loss';
    case 'folded':
      return 'folded';
    case 'allin':
      return 'allin';
    case 'out':
      return 'out';
    case 'acted':
      return 'done';
    case 'waiting':
      return 'waiting';
    default:
      return 'idle';
  }
}

/** A seat's sheet: its stack, its bet, what it did and its cards (backs until a showdown). */
function SeatDetail({ view, id, meId, table, timeline, now, leaving }: { view: PokerView; id: string; meId: string; table: PokerTable | null; timeline: Timeline; now: number; leaving: boolean }) {
  const seat = view.players[id];
  const line = seatLine(view, table, id, timeline, now);
  const cards = holeOnScreen(table, timeline, id, meId, now);
  return (
    <div className="pk-seat-detail" data-testid="seat-detail" data-player-id={id}>
      <p className="pk-seat-detail__line">
        <Chips value={seat?.chips ?? 0} size={14} />
        {(seat?.bet ?? 0) > 0 && <span>{`Bet ${formatChips(seat?.bet ?? 0)}`}</span>}
        {line.text && <span>{line.text}</span>}
      </p>
      {cards.length > 0 && (
        <div className="pk-seat-detail__cards">
          {cards.map((c) => (
            <TableCard key={`${timeline.id}:${c.key}`} card={c.card} size="md" motion={null} leaving={leaving} testId="detail-card" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The other players as tiles round the table from my left, never scrolling: stack, the bet in
 * front of them, the dealer button and their last move; folded and busted seats dimmed, all in
 * tagged, the seat to act lit with the lime ring, a winner outlined in lime.
 */
export function Seats({ room, view, ids, meId, table, timeline, live, now, leaving, wide }: Props) {
  const turnId = view.phase === 'acting' ? (view.turn ?? undefined) : undefined;
  const best = winningCards(table, timeline, now);
  const open = usePoker((s) => s.seat);
  const openSeat = usePokerStore.getState().openSeat;
  const openPlayer = open !== null && ids.includes(open) ? playerOf(room, open) : undefined;
  if (ids.length === 0) return null;
  return (
    <>
      <PlayersGrid count={ids.length} label="Other players" wide={wide}>
        {ids.map((id) => {
          const player = playerOf(room, id);
          const seat = view.players[id];
          if (!player || !seat) return null;
          const won = wonOnScreen(table, timeline, id, now);
          const bet = valueAt(live, betValue(id), seat.bet, now);
          const stack = valueAt(live, chipsValue(id), seat.chips, now);
          const status = seat.busted ? 'out' : seat.status;
          const line = seatLine(view, table, id, timeline, now);
          return (
            <PlayerTile
              key={id}
              playerId={id}
              name={player.name}
              avatar={player.avatar}
              connected={player.connected}
              count={ids.length}
              turn={turnId === id}
              line={line}
              mark={seatMark(line)}
              outcome={won > 0 ? 'win' : null}
              chips={stack}
              bet={
                <span className="pk-bet" data-table-anchor={betAnchor(id)} data-testid="seat-bet" data-bet={bet}>
                  {bet > 0 && <Chips value={bet} size={11} />}
                </span>
              }
              total={{ text: formatChips(stack), tone: won > 0 ? 'win' : 'neutral' }}
              dimmed={seat.busted || seat.status === 'folded' || !view.order.includes(id)}
              badge={seat.isDealer && <DealerButton testId="seat-dealer" />}
              tag={seat.status === 'allIn' && !seat.busted ? 'All in' : null}
              onOpen={() => openSeat(id)}
              data={{ 'data-chips': seat.chips, 'data-bet': seat.bet, 'data-status': status, 'data-dealer': seat.isDealer, 'data-outcome': won > 0 ? 'win' : undefined, 'data-payout': won > 0 ? won : undefined }}
              cards={holeOnScreen(table, timeline, id, meId, now).map((c) => (
                <TableCard key={`${timeline.id}:${c.key}`} card={c.card} size="sm" motion={c.motion} leaving={leaving || c.leaving} flipping={c.flipping} highlight={c.card !== null && best.some((b) => c.card !== null && sameCard(b, c.card))} testId="seat-card" />
              ))}
              extra={won > 0 && paidOut(timeline, now) ? <PayoutFloat text={payoutText(won)} /> : undefined}
            />
          );
        })}
      </PlayersGrid>
      <SeatSheet title={openPlayer ? openPlayer.name : null} onClose={() => openSeat(null)}>
        {openPlayer && <SeatDetail view={view} id={openPlayer.id} meId={meId} table={table} timeline={timeline} now={now} leaving={leaving} />}
      </SeatSheet>
    </>
  );
}
