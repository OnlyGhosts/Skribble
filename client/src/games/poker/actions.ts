import type { PokerActions } from '@shared/games/poker/protocol';
import { socket } from '../../platform/net/socket';
import { usePokerStore } from './store';

function send(msg: Parameters<typeof socket.send>[0]): boolean {
  const sent = socket.send(msg);
  if (sent) usePokerStore.getState().newTurn();
  return sent;
}

export const fold = (): boolean => send({ t: 'fold' });
export const check = (): boolean => send({ t: 'check' });
export const call = (): boolean => send({ t: 'call' });
export const allIn = (): boolean => send({ t: 'allIn' });

/**
 * The Bet / Raise button: a bet of `amount` when nobody has bet, a raise to `amount` otherwise;
 * the whole stack goes as an all in so a short stack never trips the minimum.
 */
export function wager(actions: PokerActions, amount: number): boolean {
  if (actions.canBet) return amount >= actions.maxBet ? allIn() : send({ t: 'bet', amount });
  if (actions.canRaise) return amount >= actions.maxRaiseTo ? allIn() : send({ t: 'raise', to: amount });
  return false;
}

/** Host only: ends the game now (a hand in progress is void, every stake goes back). */
export function endGame(): void {
  if (socket.send({ t: 'endGame' })) usePokerStore.getState().setConfirmEnd(false);
}
