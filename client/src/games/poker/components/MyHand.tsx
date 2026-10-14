import type { ReactNode } from 'react';
import type { PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { Chips } from '../../../platform/components/Chips';
import { PlayingCard } from '../../../platform/components/PlayingCard';
import { isInHand, isMyTurn, playerOf } from '../hooks';
import { handHint, lastActionLabel } from '../lib/text';
import { DealerButton } from './DealerButton';

interface Props {
  room: PokerRoomState;
  view: PokerView;
  meId: string;
  size: 'lg' | 'xl';
}

function Note({ children, state }: { children: string; state: string }) {
  return (
    <p className="pk-me__note" data-testid="my-note" data-state={state}>
      {children}
    </p>
  );
}

/**
 * The viewer's own seat: the hole cards large with what they make right now, the stack, the bet
 * in front and the dealer button. Spectators, busted players and anyone seated from the next hand
 * read why there are no cards.
 */
export function MyHand({ room, view, meId, size }: Props) {
  const me = playerOf(room, meId);
  const seat = view.players[meId];
  if (!me || !seat) {
    return (
      <section className="pk-me card" aria-label="You" data-testid="my-area" data-role="spectator">
        <Note state="spectating">You are watching this game. Ready up for the next one!</Note>
      </section>
    );
  }
  const myTurn = isMyTurn(view, meId);
  const folded = seat.status === 'folded';
  let body: ReactNode;
  if (seat.busted) {
    body = <Note state="out">You are out of chips. Watch the rest of the game from here.</Note>;
  } else if (!isInHand(view, meId) || view.myCards.length === 0) {
    body = <Note state="waiting">You are dealt in from the next hand.</Note>;
  } else {
    const hint = handHint(view.myCards, view.community);
    body = (
      <div className="pk-me__hand">
        <div className={`pk-me__cards${folded ? ' pk-me__cards--folded' : ''}`} role="group" aria-label="Your cards" data-testid="my-cards">
          {view.myCards.map((card, i) => (
            <PlayingCard key={`${i}-${card.rank}${card.suit}`} card={card} size={size} testId="my-card" />
          ))}
        </div>
        <div className="pk-me__info">
          {hint && (
            <span className="pk-me__hint" data-testid="hand-hint">
              {hint}
            </span>
          )}
          <span className={`pk-me__state pk-me__state--${seat.status}`} data-testid="my-state">
            {folded ? 'You folded' : seat.status === 'allIn' ? 'You are all in' : myTurn ? 'Your move' : lastActionLabel(seat.lastAction) || 'In the hand'}
          </span>
          {seat.bet > 0 && (
            <span className="pk-me__bet" data-testid="my-bet" data-bet={seat.bet}>
              Bet <Chips value={seat.bet} size={13} />
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <section
      className={`pk-me card${myTurn ? ' pk-me--turn' : ''}`}
      aria-label="You"
      data-testid="my-area"
      data-role="player"
      data-chips={seat.chips}
      data-status={seat.busted ? 'out' : seat.status}
      data-my-turn={myTurn}
      data-dealer={seat.isDealer}
    >
      <div className="pk-me__head">
        <Avatar avatar={me.avatar} size="sm" />
        <span className="pk-me__name">
          {me.name} <span className="pk-me__you">you</span>
        </span>
        {seat.isDealer && <DealerButton testId="my-dealer" />}
        <Chips value={seat.chips} className="pk-me__chips" size={18} testId="my-chips" />
      </div>
      {body}
    </section>
  );
}
