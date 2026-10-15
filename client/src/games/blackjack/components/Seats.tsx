import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { Chips } from '../../../platform/components/Chips';
import { tileTier } from '../../../platform/table/grid';
import type { Tone } from '../../../platform/table/Outcome';
import { PlayerTile, PlayersGrid, SeatSheet, type SeatLine, type SeatMark } from '../../../platform/table/PlayersGrid';
import { playerOf } from '../hooks';
import { seatOutcome } from '../lib/spotlight';
import { totalText, type TableHand, type TableModel } from '../lib/table';
import { outcomesShown, type Timeline } from '../lib/timeline';
import { formatChips, outcomeLabel, payoutText } from '../lib/text';
import { useBlackjack, useBlackjackStore } from '../store';
import { Hand, handOnScreen } from './Hand';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  ids: string[];
  table: TableModel | null;
  timeline: Timeline;
  now: number;
  leaving: boolean;
  /** Desktop: the tiles along an arc. */
  wide: boolean;
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
  // Not dealt in with chips to play: no bet went down in time, so this hand goes by without them.
  if (view.phase === 'acting' && !view.order.includes(id) && seat.chips > 0) return { state: 'sitting-out', text: 'Sitting out', tone: 'quiet' };
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

/** The tile's status mark: on turn, to act, done (a bust or a natural shows as such), a bet down, the outcome once settled, out, sitting out. */
export function seatMark(line: SeatLine, hands: readonly TableHand[], settledShown: boolean): SeatMark {
  switch (line.state) {
    case 'playing':
      return 'turn';
    case 'settled':
      return (settledShown && seatOutcome(hands)) || 'done';
    case 'out':
      return 'out';
    case 'bet':
      return 'bet';
    case 'waiting':
    case 'betting':
      return 'waiting';
    case 'done':
      if (hands.length > 0 && hands.every((h) => h.status === 'bust')) return 'loss';
      return hands[0]?.status === 'blackjack' ? 'blackjack' : 'done';
    default:
      return 'idle';
  }
}

/**
 * The total a tile shows and its colour: every hand's, split hands joined ("21/15"); a small or
 * dense tile has room for one, the hand in play (or the best one standing).
 */
export function tileTotal(id: string, hands: TableHand[], timeline: Timeline, now: number, turn: boolean, handIndex: number, one = false): { text: string; tone: Tone } | null {
  const all = hands.map((h, i) => ({ hand: h, i, ...handOnScreen(id, i, h, timeline, now) })).filter((s) => s.total !== null);
  if (all.length === 0) return null;
  const standing = all.filter((s) => (s.total?.total ?? 0) <= 21).sort((a, b) => (b.total?.total ?? 0) - (a.total?.total ?? 0));
  const pick = all.find((s) => turn && s.i === handIndex) ?? standing[0] ?? all[0];
  const shown = one && all.length > 1 ? [pick] : all;
  // The best total only, never "4/14".
  const text = shown.map((s) => totalText(s.total ?? { total: 0, soft: false }, false)).join('/');
  const outcome = all.every((s) => s.outcome !== null) ? seatOutcome(hands) : null;
  if (outcome) return { text, tone: outcome };
  if (shown.every((s) => (s.total?.total ?? 0) > 21)) return { text, tone: 'bust' };
  if (shown.length === 1 && shown[0].hand.status === 'blackjack' && shown[0].cards.length === 2) return { text, tone: 'blackjack' };
  return { text, tone: turn && shown.some((s) => s.i === handIndex) ? 'active' : 'neutral' };
}

/** A seat's sheet: its hands full size, its chips and what it is doing. */
function SeatDetail({ room, view, id, table, timeline, now, leaving, chips }: { room: BlackjackRoomState; view: BlackjackView; id: string; table: TableModel | null; timeline: Timeline; now: number; leaving: boolean; chips: number }) {
  const hands = table?.hands[id] ?? [];
  const settledShown = Boolean(table?.settled) && outcomesShown(timeline, now);
  const line = seatLine(view, id, hands, settledShown);
  const turnHand = view.phase === 'acting' && view.turn?.playerId === id ? view.turn.handIndex : -1;
  return (
    <div className="bj-seat-detail" data-testid="seat-detail" data-player-id={id}>
      <p className="bj-seat-detail__line">
        <Chips value={chips} size={14} /> {line.text && <span>{line.text}</span>}
      </p>
      {hands.length > 0 ? (
        <div className="bj-seat-detail__hands">
          {hands.map((hand, i) => (
            <Hand key={i} playerId={id} index={i} hand={hand} timeline={timeline} now={now} leaving={leaving} size="md" active={i === turnHand} testId="detail-hand" />
          ))}
        </div>
      ) : (
        <p className="bj-seat-detail__none">{`No cards for ${playerOf(room, id)?.name ?? 'them'} this round`}</p>
      )}
    </div>
  );
}

/**
 * The other players as tiles in seat order, never scrolling: the cards in miniature while the
 * table is small, a total and a status mark as it grows. The seat whose turn it is gets the lime
 * ring and the Playing tag; a settled seat its outcome's colour. Tapping a tile opens its hands.
 */
export function Seats({ room, view, ids, table, timeline, now, leaving, wide, chipsOf }: Props) {
  const turnId = view.phase === 'acting' ? view.turn?.playerId : undefined;
  const tier = tileTier(ids.length);
  const oneTotal = tier === 'small' || tier === 'dense';
  const open = useBlackjack((s) => s.seat);
  const openSeat = useBlackjackStore.getState().openSeat;
  const dealerPlaying = Boolean(table?.settled) && !outcomesShown(timeline, now);
  const openPlayer = open !== null && ids.includes(open) ? playerOf(room, open) : undefined;
  if (ids.length === 0) return null;
  return (
    <>
      <PlayersGrid count={ids.length} label="Other players" wide={wide}>
        {ids.map((id) => {
          const player = playerOf(room, id);
          const seat = view.players[id];
          if (!player || !seat) return null;
          const hands = table?.hands[id] ?? [];
          const settledShown = Boolean(table?.settled) && hands.some((h, i) => handOnScreen(id, i, h, timeline, now).outcome !== null);
          const turn = turnId === id;
          const line = seatLine(view, id, hands, settledShown, dealerPlaying);
          const stake = view.phase === 'betting' ? seat.bet : hands.reduce((sum, h) => sum + h.bet, 0);
          return (
            <PlayerTile
              key={id}
              playerId={id}
              name={player.name}
              avatar={player.avatar}
              connected={player.connected}
              count={ids.length}
              turn={turn}
              line={line}
              mark={seatMark(line, hands, settledShown)}
              outcome={settledShown ? seatOutcome(hands) : null}
              chips={chipsOf(id)}
              bet={stake > 0 ? <Chips value={stake} size={11} /> : undefined}
              total={tileTotal(id, hands, timeline, now, turn, view.turn?.handIndex ?? 0, oneTotal)}
              dimmed={seat.bustedOut}
              onOpen={() => openSeat(id)}
              data={{ 'data-chips': seat.chips, 'data-bet': seat.bet }}
              cards={
                hands.length > 0
                  ? hands.map((hand, i) => <Hand key={i} playerId={id} index={i} hand={hand} timeline={timeline} now={now} leaving={leaving} size="sm" active={turn && view.turn?.handIndex === i} mini testId="seat-hand" />)
                  : undefined
              }
            />
          );
        })}
      </PlayersGrid>
      <SeatSheet title={openPlayer ? openPlayer.name : null} onClose={() => openSeat(null)}>
        {openPlayer && <SeatDetail room={room} view={view} id={openPlayer.id} table={table} timeline={timeline} now={now} leaving={leaving} chips={chipsOf(openPlayer.id)} />}
      </SeatSheet>
    </>
  );
}
