/** The streets of a hand: opening the betting, closing it (uncalled bets refunded), the board and the run-out. */
import { POKER_ACT_SECONDS, type PokerStreet } from '../../../shared/games/poker/protocol.js';
import { awardUncontested, showdown } from './results.js';
import { adjustChips, bigBlind, contenders, draw, seatsIn, snapshot, streetIdle, type Gx } from './state.js';

const CARDS_ON: Record<PokerStreet, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const NEXT: Record<PokerStreet, PokerStreet | null> = { preflop: 'flop', flop: 'turn', turn: 'river', river: null };

/** Deals the board up to the street's card count. */
function dealBoard(gx: Gx, street: PokerStreet): void {
  while (gx.data.community.length < CARDS_ON[street]) gx.data.community.push(draw(gx));
}

/**
 * Opens the betting on the current street: the first to act is left of the big blind preflop and
 * left of the dealer after, and only seats still able to act queue up. A street nobody can bet on
 * (everyone else all in, the one player left already matching the bet) closes at once.
 */
export function openStreet(gx: Gx): void {
  const { data, ctx } = gx;
  const dealerIndex = data.dealerId === null ? -1 : data.order.indexOf(data.dealerId);
  const n = data.order.length;
  // Heads-up the dealer is the small blind, so the big blind sits one seat on, not two.
  const bigBlindIndex = n === 2 ? (dealerIndex + 1) % n : (dealerIndex + 2) % n;
  const after = data.street === 'preflop' ? bigBlindIndex : dealerIndex;
  const ring = Array.from({ length: n }, (_, k) => data.order[(after + 1 + k) % n]);
  data.toAct = ring.filter((id) => data.seats[id].status === 'in');
  data.answered = {};
  if (streetIdle(data)) return endStreet(gx);
  data.phase = { kind: 'acting', endsAt: ctx.now + POKER_ACT_SECONDS * 1000 };
  snapshot(gx);
}

/** The part of the highest bet nobody matched goes back to its owner before the street closes. */
function refundUncalled(gx: Gx): void {
  const { data } = gx;
  const bets = data.order.map((id) => data.seats[id].bet).sort((a, b) => b - a);
  const [top, second = 0] = bets;
  if (top === undefined || top <= second) return;
  const id = data.order.find((pid) => data.seats[pid].bet === top);
  if (id === undefined) return;
  const seat = data.seats[id];
  seat.bet = second;
  adjustChips(gx, id, top - second);
  if (seat.status === 'allIn') seat.status = 'in';
}

/**
 * The betting is done: the next street, the showdown after the river, or, with at most one
 * player still able to act, the rest of the board at once and the showdown.
 */
export function endStreet(gx: Gx): void {
  const { data } = gx;
  refundUncalled(gx);
  if (contenders(data).length <= 1) return awardUncontested(gx);
  for (const id of data.order) {
    const seat = data.seats[id];
    seat.committed += seat.bet;
    seat.bet = 0;
  }
  data.highest = 0;
  data.minRaise = bigBlind(data);
  const next = data.street === null ? null : NEXT[data.street];
  if (next === null) return showdown(gx);
  if (seatsIn(data).length <= 1) {
    dealBoard(gx, 'river');
    data.street = 'river';
    return showdown(gx);
  }
  for (const id of data.order) data.seats[id].lastAction = null;
  data.street = next;
  dealBoard(gx, next);
  openStreet(gx);
}
