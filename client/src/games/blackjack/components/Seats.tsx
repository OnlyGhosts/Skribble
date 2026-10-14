import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { isActing, playerOf, tableOrder } from '../hooks';
import { Chips } from '../../../platform/components/Chips';
import { Hand } from './Hand';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  meId: string;
}

type SeatState = 'betting' | 'bet' | 'playing' | 'done' | 'watching' | 'out';

function seatState(view: BlackjackView, id: string): SeatState {
  const seat = view.players[id];
  if (!seat) return 'watching';
  if (seat.bustedOut) return 'out';
  if (!view.order.includes(id)) return 'watching';
  if (view.phase === 'betting') return seat.bet > 0 ? 'bet' : 'betting';
  if (seat.hands.length === 0) return 'watching';
  return isActing(view, id) ? 'playing' : 'done';
}

const SEAT_NOTES: Record<SeatState, string> = { betting: 'Betting…', bet: 'Bet placed', playing: 'Playing', done: '', watching: 'Watching', out: 'Out of chips' };

/** The other seats at the table in one compact strip: chips, stake and the hands in miniature. */
export function Seats({ room, view, meId }: Props) {
  const ids = tableOrder(room, view).filter((id) => id !== meId);
  if (ids.length === 0) return null;
  return (
    <ul className="bj-seats" aria-label="Other players" data-testid="seats">
      {ids.map((id) => {
        const player = playerOf(room, id);
        const seat = view.players[id];
        if (!player || !seat) return null;
        const state = seatState(view, id);
        const acting = state === 'playing';
        return (
          <li key={id} className={`bj-seat${acting ? ' bj-seat--acting' : ''}${state === 'out' ? ' bj-seat--out' : ''}`} data-testid="seat" data-player-id={id} data-name={player.name} data-chips={seat.chips} data-bet={seat.bet} data-state={state}>
            <div className="bj-seat__who">
              <Avatar avatar={player.avatar} size="sm" dimmed={!player.connected} />
              <span className="bj-seat__name">{player.name}</span>
              <Chips value={seat.chips} className="bj-seat__chips" size={12} />
            </div>
            {seat.hands.length > 0 && view.phase !== 'betting' ? (
              <div className="bj-seat__hands">
                {seat.hands.map((hand, i) => (
                  <Hand key={i} hand={hand} index={i} size="sm" active={acting && view.turn?.handIndex === i} testId="seat-hand" />
                ))}
              </div>
            ) : (
              <span className="bj-seat__note">
                {state === 'bet' ? (
                  <>
                    Bet <Chips value={seat.bet} size={12} />
                  </>
                ) : (
                  SEAT_NOTES[state]
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
