import type { PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { Chips } from '../../../platform/components/Chips';
import { PlayingCard } from '../../../platform/components/PlayingCard';
import { holdsCards, playerOf, seatRing } from '../hooks';
import { lastActionLabel, statusLabel } from '../lib/text';
import { DealerButton } from './DealerButton';

interface Props {
  room: PokerRoomState;
  view: PokerView;
  meId: string;
}

/**
 * The other seats round the table from the one after mine: stack, the bet in front of them,
 * the dealer button, the last move and two face-down cards while they hold a hand. The seat
 * whose move it is carries the turn highlight.
 */
export function Seats({ room, view, meId }: Props) {
  const ids = seatRing(room, view, meId).filter((id) => id !== meId);
  if (ids.length === 0) return null;
  return (
    <ul className="pk-seats" aria-label="Players at the table" data-testid="seats">
      {ids.map((id) => {
        const player = playerOf(room, id);
        const seat = view.players[id];
        if (!player || !seat) return null;
        const status = seat.busted ? 'out' : seat.status;
        const note = status === 'folded' || status === 'out' ? statusLabel(status) : lastActionLabel(seat.lastAction) || (status === 'allIn' ? statusLabel(status) : '');
        return (
          <li
            key={id}
            className={`pk-seat pk-seat--${status}${seat.isTurn ? ' pk-seat--turn' : ''}`}
            data-testid="seat"
            data-player-id={id}
            data-name={player.name}
            data-chips={seat.chips}
            data-bet={seat.bet}
            data-status={status}
            data-dealer={seat.isDealer}
            data-turn={seat.isTurn}
            aria-current={seat.isTurn ? 'true' : undefined}
          >
            <div className="pk-seat__who">
              <Avatar avatar={player.avatar} size="sm" dimmed={!player.connected} />
              <span className="pk-seat__name">{player.name}</span>
              {seat.isDealer && <DealerButton testId="seat-dealer" />}
            </div>
            <div className="pk-seat__row">
              <Chips value={seat.chips} size={12} className="pk-seat__chips" />
              {holdsCards(view, id) && view.phase === 'acting' && (
                <span className="pk-seat__cards" aria-label="Two cards, face down">
                  <PlayingCard card={null} size="sm" testId="seat-card" />
                  <PlayingCard card={null} size="sm" testId="seat-card" />
                </span>
              )}
            </div>
            <div className="pk-seat__row pk-seat__row--meta">
              <span className={`pk-seat__note${status === 'allIn' ? ' pk-seat__note--allin' : ''}`} data-testid="seat-note">
                {seat.isTurn ? 'Thinking…' : note}
              </span>
              {seat.bet > 0 && (
                <span className="pk-seat__bet" data-testid="seat-bet">
                  <Chips value={seat.bet} size={11} />
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
