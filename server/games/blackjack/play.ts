/** The acting player's moves on the hand in play: hit, stand, double, split, and the clock running out. */
import { handTotal } from '../../../shared/games/blackjack/cards.js';
import { nextHand } from './dealer.js';
import { actingHand, actionsFor, adjustChips, draw, fail, nameOf, settledStatus, snapshot, type Gx, type HandData } from './state.js';

const NOT_YOUR_TURN = 'It is not your turn.';

/** The hand is done with: on to the next one (or the dealer). A bust is called out. */
function finishHand(gx: Gx, playerId: string, hand: HandData, status: 'stood' | 'bust'): void {
  hand.status = status;
  if (status === 'bust') gx.effects.push({ type: 'chat', to: 'all', kind: 'close', text: `${nameOf(gx.ctx, playerId)} busts with ${handTotal(hand.cards).total}.` });
  nextHand(gx);
}

export function hit(gx: Gx, playerId: string): void {
  const hand = actingHand(gx.data, playerId);
  if (!hand) return fail(gx, playerId, NOT_YOUR_TURN);
  if (!actionsFor(gx.data, gx.ctx.settings, playerId).canHit) return fail(gx, playerId, 'Split aces take one card each.');
  hand.cards.push(draw(gx));
  // A bust or a 21 moves on by itself; otherwise the player keeps acting with a fresh clock.
  const settled = settledStatus(hand);
  if (settled === 'bust' || settled === 'stood') return finishHand(gx, playerId, hand, settled);
  if (gx.data.phase.kind === 'acting') gx.data.phase.endsAt = gx.ctx.now + gx.ctx.settings.actSeconds * 1000;
  snapshot(gx);
}

export function stand(gx: Gx, playerId: string): void {
  const hand = actingHand(gx.data, playerId);
  if (!hand || !actionsFor(gx.data, gx.ctx.settings, playerId).canStand) return fail(gx, playerId, NOT_YOUR_TURN);
  finishHand(gx, playerId, hand, 'stood');
}

/** Twice the stake for exactly one more card; split hands too. */
export function double(gx: Gx, playerId: string): void {
  const hand = actingHand(gx.data, playerId);
  if (!hand) return fail(gx, playerId, NOT_YOUR_TURN);
  if (!actionsFor(gx.data, gx.ctx.settings, playerId).canDouble) return fail(gx, playerId, 'You cannot double this hand.');
  adjustChips(gx, playerId, -hand.bet);
  hand.bet *= 2;
  hand.doubled = true;
  hand.cards.push(draw(gx));
  finishHand(gx, playerId, hand, settledStatus(hand) === 'bust' ? 'bust' : 'stood');
}

/**
 * A pair becomes two hands side by side with the same stake, each dealt a second card, and the
 * play goes on from the left one. Split aces take that one card (a second ace may be split again,
 * up to four hands); other pairs play on and may be split again too.
 */
export function split(gx: Gx, playerId: string): void {
  const { data, ctx } = gx;
  const hand = actingHand(data, playerId);
  const seat = data.seats[playerId];
  if (!hand || !seat || data.phase.kind !== 'acting') return fail(gx, playerId, NOT_YOUR_TURN);
  if (!actionsFor(data, ctx.settings, playerId).canSplit) return fail(gx, playerId, 'You cannot split this hand.');
  adjustChips(gx, playerId, -hand.bet);
  const aces = hand.cards[0].rank === 'A';
  const right: HandData = { cards: [hand.cards[1]], bet: hand.bet, status: 'waiting', doubled: false, fromSplit: true, splitAces: aces };
  hand.cards = [hand.cards[0]];
  hand.fromSplit = true;
  hand.splitAces = aces;
  hand.status = 'waiting';
  seat.hands.splice(data.phase.handIndex + 1, 0, right);
  hand.cards.push(draw(gx));
  right.cards.push(draw(gx));
  gx.effects.push({ type: 'chat', to: 'all', kind: 'system', text: `${nameOf(ctx, playerId)} splits ${aces ? 'aces' : 'a pair'}.` });
  nextHand(gx);
}

/** The acting clock ran out: the hand stands. */
export function actTimedOut(gx: Gx): void {
  const { data } = gx;
  if (data.phase.kind !== 'acting') return;
  const hand = actingHand(data, data.phase.playerId);
  if (!hand) return nextHand(gx);
  gx.effects.push({ type: 'chat', to: 'all', kind: 'system', text: `${nameOf(gx.ctx, data.phase.playerId)} ran out of time and stands.` });
  finishHand(gx, data.phase.playerId, hand, 'stood');
}
