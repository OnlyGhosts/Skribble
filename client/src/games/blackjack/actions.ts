import { socket } from '../../platform/net/socket';
import { useBlackjackStore } from './store';

export function placeBet(amount: number): boolean {
  if (!socket.send({ t: 'bet', amount })) return false;
  useBlackjackStore.getState().betPlaced(amount);
  return true;
}

export function hit(): void {
  socket.send({ t: 'hit' });
}

export function stand(): void {
  socket.send({ t: 'stand' });
}

export function double(): void {
  socket.send({ t: 'double' });
}

export function split(): void {
  socket.send({ t: 'split' });
}

/** Host only: on to the next round without waiting for the results clock. */
export function nextRound(): void {
  socket.send({ t: 'next' });
}
