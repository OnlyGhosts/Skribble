/** The acting player's moves on the hand in play: hit, stand, double, split, and the clock running out. */
import { handTotal } from '../../../shared/games/blackjack/cards.js';
import { nextHand } from './round.js';
import { actingHand, actionsFor, adjustChips, draw, fail, nameOf, settledStatus, snapshot, type Gx, type HandData } from './state.js';

const NOT_YOUR_TURN = 'It is not your turn.';

/** The hand is done with: on to the next one (or the dealer). A bust or a 21 is called out. */
function finishHand(gx: Gx, playerId: string, hand: HandData, status: 'stood' | 'bust'): void {
  hand.status = status;
  if (status === 'bust') gx.effects.push({ type: 'chat', to: 'all', kind: 'close', text: `${nameOf(gx.ctx, playerId)} busts with ${handTotal(hand.cards).total}.` });
  nextHand(gx);
}

/** A hand that settles by itself after a card (bust or 21) moves on; otherwise the player keeps acting with a fresh clock. */
function afterCard(gx: Gx, playerId: string, hand: HandData): void {
  const settled = settledStatus(hand);
  if (settled === 'bust' || settled === 'stood') return finishHand(gx, playerId, hand, settled);
  if (gx.data.phase.kind === 'acting') gx.data.phase.endsAt = gx.ctx.now + gx.ctx.settings.actSeconds * 1000;
  snapshot(gx);
}

export function hit(gx: Gx, playerId: string): void {
  const hand = actingHand(gx.data, playerId);
  if (!hand || !actionsFor(gx.data, gx.ctx.settings, playerId).canHit) return fail(gx, playerId, NOT_YOUR_TURN);
  hand.cards.push(draw(gx));
  afterCard(gx, playerId, hand);
}

export function stand(gx: Gx, playerId: string): void {
  const hand = actingHand(gx.data, playerId);
  if (!hand || !actionsFor(gx.data, gx.ctx.settings, playerId).canStand) return fail(gx, playerId, NOT_YOUR_TURN);
  finishHand(gx, playerId, hand, 'stood');
}

/** Twice the stake for exactly one more card. */
export function double(gx: Gx, playerId: string): void {
  const hand = actingHand(gx.data, playerId);
  if (!hand) return fail(gx, playerId, NOT_YOUR_TURN);
  if (!actionsFor(gx.data, gx.ctx.settings, playerId).canDouble) return fail(gx, playerId, 'You cannot double this hand.');
  adjustChips(gx, playerId, -hand.bet);
  hand.bet *= 2;
  hand.doubled = true;
  hand.cards.push(draw(gx));
  const settled = settledStatus(hand);
  finishHand(gx, playerId, hand, settled === 'bust' ? 'bust' : 'stood');
}

/**
 * A pair becomes two hands with the same stake, each dealt a second card. Split aces take their
 * one card and stand; any other split hand plays on from the first.
 */
export function split(gx: Gx, playerId: string): void {
  const { data, ctx } = gx;
  const hand = actingHand(data, playerId);
  const seat = data.seats[playerId];
  if (!hand || !seat) return fail(gx, playerId, NOT_YOUR_TURN);
  if (!actionsFor(data, ctx.settings, playerId).canSplit) return fail(gx, playerId, 'You cannot split this hand.');
  adjustChips(gx, playerId, -hand.bet);
  const aces = hand.cards[0].rank === 'A';
  const second: HandData = { cards: [hand.cards[1]], bet: hand.bet, status: 'waiting', doubled: false, fromSplit: true };
  hand.cards = [hand.cards[0]];
  hand.fromSplit = true;
  seat.hands.push(second);
  hand.cards.push(draw(gx));
  second.cards.push(draw(gx));
  gx.effects.push({ type: 'chat', to: 'all', kind: 'system', text: `${nameOf(ctx, playerId)} splits ${aces ? 'aces' : 'a pair'}.` });
  if (aces) {
    hand.status = 'stood';
    second.status = 'stood';
    return nextHand(gx);
  }
  afterCard(gx, playerId, hand);
}

/** The acting clock ran out: the hand stands. */
export function actTimedOut(gx: Gx): void {
  const { data } = gx;
  if (data.phase.kind !== 'acting') return;
  const hand = actingHand(data, data.phase.playerId);
  if (!hand) return nextHand(gx);
  gx.effects.push({ type: 'chat', to: 'all', kind: 'system', text: `${nameOf(gx.ctx, data.phase.playerId)} ran out of time — standing.` });
  finishHand(gx, data.phase.playerId, hand, 'stood');
}
