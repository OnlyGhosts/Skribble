/** The acting player's moves on the hand in play (hit, stand, double, split) and the host's Skip. */
import { handTotal } from '../../../shared/games/blackjack/cards.js';
import { awayLine, nextHand } from './dealer.js';
import { actingHand, actionsFor, adjustChips, canSkip, draw, fail, nameOf, settledStatus, snapshot, systemMessage, type Gx, type HandData } from './state.js';

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
  // A bust or a 21 moves on by itself; otherwise the player keeps acting.
  const settled = settledStatus(hand);
  if (settled === 'bust' || settled === 'stood') return finishHand(gx, playerId, hand, settled);
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
 * play goes on from the left one. Split aces take that one card (a second ace may be split again);
 * other pairs play on and may be split again too. There is no cap: only the chips stop a split.
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

/**
 * On another player's turn: the hand named stands (a split hand at a time), if it is still the
 * one in play; a stale target (a second tap after the turn moved on) is refused. The host's Skip,
 * or anyone's on the host's own turn.
 */
export function skip(gx: Gx, playerId: string, target: { playerId: string; handIndex: number }): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'acting') return fail(gx, playerId, 'There is no turn to skip.');
  if (data.phase.playerId === playerId) return fail(gx, playerId, 'It is your own turn.');
  if (!canSkip(ctx, data, playerId)) return fail(gx, playerId, 'Only the host can skip a turn.');
  if (data.phase.playerId !== target.playerId || data.phase.handIndex !== target.handIndex) return fail(gx, playerId, 'That hand is already done.');
  const actor = data.phase.playerId;
  const hand = actingHand(data, actor);
  if (!hand) return nextHand(gx);
  systemMessage(gx, `${nameOf(ctx, playerId)} stood ${nameOf(ctx, actor)}'s hand.`);
  finishHand(gx, actor, hand, 'stood');
}

/** The player in play dropped: their hand stands at once and the play moves on (nextHand stands their later hands too). */
export function standAway(gx: Gx, playerId: string): void {
  const { data } = gx;
  if (data.phase.kind !== 'acting' || data.phase.playerId !== playerId) return;
  const hand = actingHand(data, playerId);
  if (!hand) return nextHand(gx);
  hand.status = 'stood';
  systemMessage(gx, awayLine(gx, playerId));
  nextHand(gx, new Set([playerId]));
}
