import { useEffect, useRef } from 'react';
import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { Chips } from '../../../platform/components/Chips';
import { playerOf } from '../hooks';
import type { TableHand, TableModel } from '../lib/table';
import type { Timeline } from '../lib/timeline';
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

type SeatState = 'betting' | 'bet' | 'playing' | 'waiting' | 'done' | 'settled' | 'next' | 'out';

/** One short line under a seat: what it is doing, or how its round went. */
function seatLine(view: BlackjackView, id: string, hands: TableHand[], settledShown: boolean): { state: SeatState; text: string } {
  const seat = view.players[id];
  if (seat.bustedOut) return { state: 'out', text: 'Out' };
  const betting = view.phase === 'betting' && view.order.includes(id);
  if (betting && seat.bet > 0) return { state: 'bet', text: `Bet ${formatChips(seat.bet)}` };
  if (view.phase === 'acting' && view.turn?.playerId === id) return { state: 'playing', text: 'Playing' };
  if (settledShown && hands.length > 0) {
    const back = hands.reduce((sum, h) => sum + (h.payout ?? 0), 0);
    const staked = hands.reduce((sum, h) => sum + h.bet, 0);
    const outcome = hands.length === 1 && hands[0].outcome ? outcomeLabel(hands[0].outcome) : back > staked ? 'Win' : back === staked ? 'Push' : 'Lost';
    return { state: 'settled', text: back > 0 ? `${outcome} ${payoutText(back)}` : outcome };
  }
  if (view.phase === 'acting' && hands.length > 0) {
    const order = view.order.indexOf(id);
    const turn = view.turn ? view.order.indexOf(view.turn.playerId) : -1;
    return order > turn ? { state: 'waiting', text: 'Waiting' } : { state: 'done', text: hands.every((h) => h.status === 'bust') ? 'Bust' : hands[0].status === 'blackjack' ? 'Blackjack' : 'Stands' };
  }
  if (betting) return { state: 'betting', text: 'Betting' };
  return { state: 'next', text: 'Next round' };
}

/**
 * The other players in one horizontal strip: avatar, name, chips, the hands in miniature with
 * their totals and a line on what they are doing. The seat whose turn it is lights up and is
 * scrolled into view; the strip scrolls sideways rather than squeezing.
 */
export function Seats({ room, view, ids, table, timeline, now, leaving, chipsOf }: Props) {
  const strip = useRef<HTMLUListElement>(null);
  const turnId = view.phase === 'acting' ? view.turn?.playerId : undefined;

  useEffect(() => {
    const list = strip.current;
    if (!turnId || !list) return;
    const el = list.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(turnId)}"]`);
    if (!el) return;
    const left = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
    list.scrollTo?.({ left: Math.max(0, left), behavior: 'smooth' });
  }, [turnId]);

  if (ids.length === 0) return null;
  return (
    <ul ref={strip} className="bj-seats" aria-label="Other players" data-testid="seats">
      {ids.map((id) => {
        const player = playerOf(room, id);
        const seat = view.players[id];
        if (!player || !seat) return null;
        const hands = table?.hands[id] ?? [];
        const settledShown = Boolean(table?.settled) && hands.some((h, i) => handOnScreen(id, i, h, timeline, now).outcome !== null);
        const line = seatLine(view, id, hands, settledShown);
        const turn = turnId === id;
        return (
          <li
            key={id}
            className={`bj-seat${turn ? ' bj-seat--turn' : ''}${seat.bustedOut ? ' bj-seat--out' : ''}`}
            data-testid="seat"
            data-player-id={id}
            data-name={player.name}
            data-chips={seat.chips}
            data-bet={seat.bet}
            data-state={line.state}
            data-turn={turn}
            aria-current={turn ? 'true' : undefined}
          >
            <div className="bj-seat__who">
              <Avatar avatar={player.avatar} size="sm" dimmed={!player.connected} />
              <span className="bj-seat__id">
                <span className="bj-seat__name">{player.name}</span>
                <Chips value={chipsOf(id)} size={12} className="bj-seat__chips" />
              </span>
            </div>
            <div className="bj-seat__hands">
              {hands.map((hand, i) => (
                <Hand key={i} playerId={id} index={i} hand={hand} timeline={timeline} now={now} leaving={leaving} size="sm" active={turn && view.turn?.handIndex === i} mini testId="seat-hand" />
              ))}
            </div>
            <span className={`bj-seat__line bj-seat__line--${line.state}`} data-testid="seat-line">
              {line.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
