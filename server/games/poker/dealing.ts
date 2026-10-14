/** A hand's start: the button, the blinds (heads-up included), the hole cards and the first street. */
import { freshDeck, shuffle } from '../../../shared/platform/cards.js';
import type { PlatformPlayer } from '../../platform/game.js';
import { adjustChips, bigBlind, draw, findPlayer, nameOf, type Gx } from './state.js';
import { openStreet } from './streets.js';

/**
 * The button moves to the next seated player after the last dealer (by join order, wrapping),
 * so a busted or departed dealer never stalls it; the first hand picks a seat at random.
 */
export function chooseDealer(gx: Gx, stacked: PlatformPlayer[]): PlatformPlayer {
  const { data, ctx } = gx;
  if (data.dealerOrder === null) return stacked[Math.min(stacked.length - 1, Math.floor(ctx.rng() * stacked.length))];
  const last = data.dealerOrder;
  return stacked.find((p) => p.joinOrder > last) ?? stacked[0];
}

/** Posts up to `amount` (all in when short) and notes it as the seat's last action. */
function postBlind(gx: Gx, playerId: string, amount: number, kind: 'smallBlind' | 'bigBlind'): number {
  const seat = gx.data.seats[playerId];
  const paid = Math.min(amount, seat.chips);
  adjustChips(gx, playerId, -paid);
  seat.bet = paid;
  if (seat.chips === 0) seat.status = 'allIn';
  seat.lastAction = { kind, amount: paid };
  return paid;
}

/** Shuffles, posts the blinds, deals two cards each and opens the preflop betting. `order` and the dealer are set. */
export function dealHand(gx: Gx): void {
  const { data, ctx } = gx;
  const n = data.order.length;
  const dealerIndex = data.dealerId === null ? 0 : data.order.indexOf(data.dealerId);
  // Heads-up the dealer posts the small blind and acts first preflop.
  const sbId = data.order[n === 2 ? dealerIndex : (dealerIndex + 1) % n];
  const bbId = data.order[n === 2 ? (dealerIndex + 1) % n : (dealerIndex + 2) % n];
  data.deck = shuffle(freshDeck(), ctx.rng);
  data.community = [];
  data.street = 'preflop';
  const sb = postBlind(gx, sbId, data.smallBlind, 'smallBlind');
  const bb = postBlind(gx, bbId, bigBlind(data), 'bigBlind');
  data.highest = Math.max(sb, bb);
  data.minRaise = bigBlind(data);
  for (let round = 0; round < 2; round++) for (const id of data.order) data.seats[id].cards.push(draw(gx));
  const dealer = findPlayer(ctx, data.dealerId ?? '');
  gx.effects.push({
    type: 'chat',
    to: 'all',
    kind: 'system',
    text: `Hand ${data.hand} (blinds ${data.smallBlind}/${bigBlind(data)}): ${dealer?.name ?? 'Someone'} has the button, ${nameOf(ctx, sbId)} posts ${sb}, ${nameOf(ctx, bbId)} posts ${bb}.`,
  });
  openStreet(gx);
}
