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
/** No cards this hand; a bet before the deal brings me back in. */
export const sitOut = (): boolean => socket.send({ t: 'sitOutHand' });
/** Deal to everyone who has bet (the host's, or anyone's while the table waits on the host). */
export const dealNow = (): boolean => socket.send({ t: 'dealNow' });
/** Stand the hand named, the one in play: a tap that lands after the turn moved on stands nothing. */
export const skipTurn = (target: { playerId: string; handIndex: number }): boolean => socket.send({ t: 'skip', playerId: target.playerId, handIndex: target.handIndex });

/** Host only: ends the game once the hand in play settles (at once while bets are open). */
export function endGame(): void {
  if (socket.send({ t: 'endGame' })) useBlackjackStore.getState().setConfirmEnd(false);
}
