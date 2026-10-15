/**
 * Betting and the deal: stakes, sitting a hand out, the deal once nobody is left to wait for (or
 * when the host deals), the cards in table order and the dealer's peek. Betting has no clock.
 */
import { dealerPeeks, isNatural } from '../../../shared/games/blackjack/cards.js';
import { settleRound, nextHand } from './dealer.js';
import { beginRound, fillRound, holdBetting } from './round.js';
import { MIN_PLAYERS, adjustChips, anyBetDown, canDealNow, canSitOut, connectedActive, draw, fail, nameOf, settledStatus, snapshot, systemMessage, waitingFor, type Gx, type HandData } from './state.js';

export function bet(gx: Gx, playerId: string, amount: number): void {
  const { data } = gx;
  const seat = data.seats[playerId];
  if (data.phase.kind !== 'betting' || !seat || !data.order.includes(playerId)) return fail(gx, playerId, 'You cannot bet right now.');
  // Any whole number of chips from 1 up to the whole stack (a stake already down included).
  const available = seat.chips + seat.bet;
  if (amount < 1 || amount > available) return fail(gx, playerId, `Bet between 1 and ${available} chips.`);
  // A bet may be changed until the cards are dealt: the earlier stake comes back first.
  adjustChips(gx, playerId, seat.bet - amount);
  seat.bet = amount;
  // A bet brings a seat that sat out back in.
  seat.sittingOut = false;
  if (dealIfReady(gx)) return;
  snapshot(gx);
}

/** No cards for this seat this hand; it can still bet before the deal to come back in. */
export function sitOut(gx: Gx, playerId: string): void {
  if (!canSitOut(gx.data, playerId)) return fail(gx, playerId, 'You cannot sit out right now.');
  gx.data.seats[playerId].sittingOut = true;
  if (dealIfReady(gx)) return;
  snapshot(gx);
}

/** Deals to the seats that bet; everyone else sits the hand out. The host's, or anyone's while the table waits on the host. */
export function dealNow(gx: Gx, playerId: string): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'betting') return fail(gx, playerId, 'The cards are already out.');
  if (!anyBetDown(data)) return fail(gx, playerId, 'Nobody has bet yet.');
  if (!canDealNow(ctx, data, playerId)) return fail(gx, playerId, 'Only the host can deal.');
  deal(gx);
}

/**
 * Deals once nobody is left to wait for and a stake is down. Seats that sat out or are away sit
 * the hand out. With no stake down at all nothing is dealt: everyone still in the game takes a
 * seat in the round (a newcomer who came in behind a stake that has since left the table too) and
 * the table waits, or holds once nobody still in the game is connected to bet.
 */
export function dealIfReady(gx: Gx): boolean {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'betting' || data.order.length === 0) return false;
  if (!anyBetDown(data)) {
    fillRound(gx);
    if (connectedActive(ctx, data).length >= MIN_PLAYERS) return false;
    holdBetting(gx);
    return true;
  }
  if (waitingFor(ctx, data).length > 0) return false;
  deal(gx);
  return true;
}

function freshHand(gx: Gx, bet: number): HandData {
  return { cards: [draw(gx)], bet, status: 'waiting', doubled: false, fromSplit: false, splitAces: false };
}

/**
 * Deals like a table: a card to every seat with a stake in order, the dealer's up card, a second
 * card to every seat, the hole card. Whoever has no stake down sits the hand out (no cards, chips
 * untouched) and is dealt in again once they bet in a later round. The last round's table goes to
 * the discards. With an ace or a ten-value card up the dealer peeks, and a dealer blackjack
 * settles the round at once.
 */
function deal(gx: Gx): void {
  const { data, ctx } = gx;
  const sittingOut = data.order.filter((id) => data.seats[id].bet === 0);
  data.order = data.order.filter((id) => data.seats[id].bet > 0);
  if (data.order.length === 0) {
    // Nobody is left to deal to (the seats emptied while the bets were open): the round is not spent.
    data.round -= 1;
    return beginRound(gx);
  }
  if (sittingOut.length > 0) systemMessage(gx, `${sittingOut.map((id) => nameOf(ctx, id)).join(', ')} sit${sittingOut.length === 1 ? 's' : ''} this hand out.`);
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
