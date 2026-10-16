import type { PokerActions, PokerMoveTarget, PokerView } from '@shared/games/poker/protocol';
import { socket } from '../../platform/net/socket';
import { usePokerStore } from './store';

/** What a move answers, as my screen has it: the hand and the latest move on the table. A tap that lands after the turn moved on does nothing. */
export function moveTarget(view: PokerView): PokerMoveTarget {
  return { hand: view.hand, move: view.lastMove?.seq ?? 0 };
}

/** Sends a move aimed at the turn on my screen, and holds the moves until the table answers. */
function send(view: PokerView, msg: { t: 'fold' | 'check' | 'call' | 'allIn' } | { t: 'bet'; amount: number } | { t: 'raise'; to: number }): boolean {
  const sent = socket.send({ ...msg, ...moveTarget(view) });
  if (!sent) return false;
  const store = usePokerStore.getState();
  store.newTurn();
  store.markPending(msg.t, view);
  return true;
}

export const fold = (view: PokerView): boolean => send(view, { t: 'fold' });
export const check = (view: PokerView): boolean => send(view, { t: 'check' });
export const call = (view: PokerView): boolean => send(view, { t: 'call' });
export const allIn = (view: PokerView): boolean => send(view, { t: 'allIn' });

/**
 * The Bet / Raise button: a bet of `amount` when nobody has bet, a raise to `amount` otherwise;
 * the whole stack goes as an all in so a short stack never trips the minimum.
 */
export function wager(view: PokerView, actions: PokerActions, amount: number): boolean {
  if (actions.canBet) return amount >= actions.maxBet ? allIn(view) : send(view, { t: 'bet', amount });
  if (actions.canRaise) return amount >= actions.maxRaiseTo ? allIn(view) : send(view, { t: 'raise', to: amount });
  return false;
}

