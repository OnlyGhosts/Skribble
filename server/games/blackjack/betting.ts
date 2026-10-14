/** Betting and the deal: stakes, the betting clock, the cards in table order and the dealer's peek. */
import { dealerPeeks, isNatural } from '../../../shared/games/blackjack/cards.js';
import { settleRound, nextHand } from './dealer.js';
import { beginRound } from './round.js';
import { adjustChips, draw, fail, nameOf, settledStatus, snapshot, systemMessage, type Gx, type HandData } from './state.js';

export function bet(gx: Gx, playerId: string, amount: number): void {
  const { data, ctx } = gx;
  const seat = data.seats[playerId];
  if (data.phase.kind !== 'betting' || !seat || !data.order.includes(playerId)) return fail(gx, playerId, 'You cannot bet right now.');
  const available = seat.chips + seat.bet;
  const cap = Math.min(ctx.settings.maxBet, available);
  if (amount < ctx.settings.minBet || amount > cap) return fail(gx, playerId, `Bet between ${ctx.settings.minBet} and ${cap} chips.`);
  // A bet may be changed until the cards are dealt: the earlier stake comes back first.
  adjustChips(gx, playerId, seat.bet - amount);
  seat.bet = amount;
  if (!dealIfAllBet(gx)) snapshot(gx);
}

/** Deals as soon as every seat in the round has a stake down. */
export function dealIfAllBet(gx: Gx): boolean {
  const { data } = gx;
  if (data.phase.kind !== 'betting' || data.order.length === 0 || !data.order.every((id) => data.seats[id].bet > 0)) return false;
  deal(gx);
  return true;
}

/**
 * The betting clock ran out: every seat still to bet plays the minimum, connected or not (a
 * player who dropped mid-round keeps their place; their moves stand when the clock runs out).
 */
export function betTimedOut(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'betting') return;
  const sittingOut: string[] = [];
  for (const id of data.order) {
    const seat = data.seats[id];
    if (seat.bet > 0) continue;
    if (seat.chips >= ctx.settings.minBet) {
      adjustChips(gx, id, -ctx.settings.minBet);
      seat.bet = ctx.settings.minBet;
      systemMessage(gx, `${nameOf(ctx, id)} bets the minimum (${ctx.settings.minBet}).`);
    } else sittingOut.push(id);
  }
  if (sittingOut.length > 0) systemMessage(gx, `${sittingOut.map((id) => nameOf(ctx, id)).join(', ')} sit${sittingOut.length === 1 ? 's' : ''} this round out.`);
  deal(gx);
}

function freshHand(gx: Gx, bet: number): HandData {
  return { cards: [draw(gx)], bet, status: 'waiting', doubled: false, fromSplit: false, splitAces: false };
}

/**
 * Deals like a table: a card to every seat in order, the dealer's up card, a second card to every
 * seat, the hole card. The last round's table goes to the discards. With an ace or a ten-value card
 * up the dealer peeks, and a dealer blackjack settles the round at once.
 */
function deal(gx: Gx): void {
  const { data, ctx } = gx;
  data.order = data.order.filter((id) => data.seats[id].bet > 0);
  if (data.order.length === 0) {
    // Nobody is left to deal to (the seats emptied while the bets were open): the round is not spent.
    data.round -= 1;
    return beginRound(gx);
  }
  data.lastRound = null;
  for (const id of data.order) data.seats[id].hands = [freshHand(gx, data.seats[id].bet)];
  data.dealer = [draw(gx)];
  for (const id of data.order) data.seats[id].hands[0].cards.push(draw(gx));
  data.dealer.push(draw(gx));
  for (const id of data.order) {
    const hand = data.seats[id].hands[0];
    if (settledStatus(hand) !== 'blackjack') continue;
    hand.status = 'blackjack';
    systemMessage(gx, `${nameOf(ctx, id)} has blackjack!`);
  }
  if (dealerPeeks(data.dealer[0]) && isNatural(data.dealer)) {
    data.holeHidden = false;
    systemMessage(gx, 'The dealer has blackjack.');
    return settleRound(gx, true);
  }
  nextHand(gx);
}
