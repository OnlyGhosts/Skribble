import type { BlackjackView } from '@shared/games/blackjack/protocol';
import { socket } from '../../platform/net/socket';
import { moveTarget, type PendingKind } from './lib/pending';
import { useBlackjackStore } from './store';

export type MoveKind = Extract<PendingKind, 'hit' | 'stand' | 'double' | 'split'>;

/** Sends `msg`, and holds the controls until the table answers. */
function sendHeld(kind: PendingKind, msg: Parameters<typeof socket.send>[0], view: BlackjackView, meId: string): boolean {
  if (!socket.send(msg)) return false;
  useBlackjackStore.getState().markPending(kind, view, meId);
  return true;
}

/** A bet on the round on the table; a second tap on it changes nothing. */
export function placeBet(amount: number, view: BlackjackView, meId: string): boolean {
  if (!sendHeld('bet', { t: 'bet', amount, round: view.round }, view, meId)) return false;
  useBlackjackStore.getState().betPlaced(amount);
  return true;
}

/** Hit, Stand, Double or Split, aimed at the hand in play as it is on my screen. */
export function playMove(kind: MoveKind, view: BlackjackView, meId: string): boolean {
  return sendHeld(kind, { t: kind, ...moveTarget(view, meId) }, view, meId);
}

/** No cards this hand; a bet before the deal brings me back in. */
export const sitOut = (view: BlackjackView, meId: string): boolean => sendHeld('sitOut', { t: 'sitOutHand', round: view.round }, view, meId);

/** Deal to everyone who has bet (the host's, or anyone's while the table waits on the host or on a seat that is away). */
export const dealNow = (view: BlackjackView, meId: string): boolean => sendHeld('dealNow', { t: 'dealNow', round: view.round }, view, meId);

/** Stand the hand named, the one in play: a tap that lands after the turn moved on stands nothing. */
export function skipTurn(target: { playerId: string; handIndex: number }, view: BlackjackView, meId: string): boolean {
  return sendHeld('skip', { t: 'skip', playerId: target.playerId, handIndex: target.handIndex }, view, meId);
}

/**
 * Bet tapped while the last round's outcomes are up and the next bets are about to open: it shows
 * as placed at once and goes out the moment the bets open (see sendQueuedBet).
 */
export function queueBet(amount: number, view: BlackjackView): void {
  useBlackjackStore.getState().queueBet(view.round + 1, amount);
}

/** A new snapshot: a queued bet goes out once its round's bets are open, and is dropped once that round has passed it by. */
export function sendQueuedBet(view: BlackjackView, meId: string): void {
  const store = useBlackjackStore.getState();
  const queued = store.queuedBet;
  if (!queued) return;
  const seat = view.players[meId];
  if (view.phase === 'betting' && view.round === queued.round && seat && view.order.includes(meId)) {
    store.clearQueuedBet();
    if (seat.bet === 0) placeBet(Math.min(queued.amount, seat.chips), view, meId);
    return;
  }
  if (view.phase !== 'results' || view.round >= queued.round) store.clearQueuedBet();
}

