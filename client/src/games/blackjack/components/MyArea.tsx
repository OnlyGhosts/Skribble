import type { ReactNode } from 'react';
import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { betCap, handDone, isActing, isInRound, nameOf, pendingBettors, playerOf, useConnected } from '../hooks';
import { useBlackjack, useBlackjackStore } from '../store';
import { Actions } from './Actions';
import { Betting } from './Betting';
import { Chips } from '../../../platform/components/Chips';
import { Hand } from './Hand';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  meId: string;
  playing: boolean;
}

/** A line for the player who has nothing to do right now. */
function Note({ children, state }: { children: string; state: string }) {
  return (
    <p className="bj-me__note" data-testid="my-note" data-state={state}>
      {children}
    </p>
  );
}

/**
 * The viewer's own seat: chips, then what the phase asks of them. Betting shows the panel until
 * the stake is down (and again on Change bet); acting shows the hands large with the moves under
 * the one in play; anyone not dealt in reads why.
 */
export function MyArea({ room, view, meId, playing }: Props) {
  const me = playerOf(room, meId);
  const seat = view.players[meId];
  const connected = useConnected();
  const changingBet = useBlackjack((s) => s.changingBet);
  const canSend = playing && connected;
  const settings = room.settings;

  if (!me || !seat) {
    return (
      <section className="bj-me card" aria-label="You" data-testid="my-area" data-role="spectator">
        <Note state="spectating">You are watching this game. Ready up for the next one!</Note>
      </section>
    );
  }
  const inRound = isInRound(view, meId);
  const myTurn = isActing(view, meId);
  const handIndex = myTurn && view.turn ? view.turn.handIndex : -1;

  let body: ReactNode;
  if (seat.bustedOut) {
    body = <Note state="out">You are out of chips. Watch the rest of the game from here.</Note>;
  } else if (!inRound) {
    body = <Note state="waiting">{view.phase === 'betting' ? 'You sit this round out and are dealt in next round.' : 'You are dealt in from the next round.'}</Note>;
  } else if (view.phase === 'betting') {
    const cap = betCap(view, settings.maxBet, meId);
    if (seat.bet === 0 || changingBet) {
      body = <Betting minBet={settings.minBet} cap={cap} current={seat.bet} canSend={canSend} />;
    } else {
      const pending = pendingBettors(view).filter((id) => id !== meId);
      body = (
        <div className="bj-me__placed" data-testid="bet-placed" data-bet={seat.bet}>
          <span className="bj-me__placed-line">
            Bet placed: <Chips value={seat.bet} size={16} />
          </span>
          <span className="bj-me__waiting" data-testid="bet-waiting">
            {pending.length === 0 ? 'Dealing…' : `Waiting for ${pending.map((id) => nameOf(room, id)).join(', ')}`}
          </span>
          <button type="button" className="btn btn--secondary" onClick={() => useBlackjackStore.getState().setChangingBet(true)} disabled={!canSend} data-testid="change-bet">
            Change bet
          </button>
        </div>
      );
    }
  } else if (seat.hands.length === 0) {
    body = <Note state="sat-out">You did not bet this round.</Note>;
  } else {
    body = (
      <>
        <div className="bj-me__hands" data-testid="my-hands">
          {seat.hands.map((hand, i) => (
            <Hand key={i} hand={hand} index={i} size="lg" active={i === handIndex} testId="my-hand" />
          ))}
        </div>
        {/* The moves stay on screen (greyed out) while a hand of mine is still to play, so the layout holds still when my turn comes. */}
        {view.phase === 'acting' && !seat.hands.every(handDone) && <Actions actions={view.actions} hand={seat.hands[handIndex]} chips={seat.chips} settings={settings} myTurn={myTurn} playing={playing} connected={connected} />}
      </>
    );
  }

  return (
    <section className={`bj-me card${myTurn ? ' bj-me--turn' : ''}`} aria-label="You" data-testid="my-area" data-role="player" data-chips={seat.chips} data-my-turn={myTurn}>
      <div className="bj-me__head">
        <Avatar avatar={me.avatar} size="sm" />
        <span className="bj-me__name">
          {me.name} <span className="bj-me__you">you</span>
        </span>
        <Chips value={seat.chips} className="bj-me__chips" size={18} testId="my-chips" />
      </div>
      {body}
    </section>
  );
}
