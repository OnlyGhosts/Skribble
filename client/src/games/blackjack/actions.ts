import { socket } from '../../platform/net/socket';
import { useBlackjackStore } from './store';

export function placeBet(amount: number): boolean {
  if (!socket.send({ t: 'bet', amount })) return false;
  useBlackjackStore.getState().betPlaced(amount);
  return true;
}

export const hit = (): boolean => socket.send({ t: 'hit' });
export const stand = (): boolean => socket.send({ t: 'stand' });
export const double = (): boolean => socket.send({ t: 'double' });
export const split = (): boolean => socket.send({ t: 'split' });

/** Host only: ends the game once the hand in play settles (at once while bets are open). */
export function endGame(): void {
  if (socket.send({ t: 'endGame' })) useBlackjackStore.getState().setConfirmEnd(false);
}
