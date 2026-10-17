/** The acting player's moves on the hand in play (hit, stand, double, split) and the host's Skip. */
import { handTotal } from '../../../shared/games/blackjack/cards.js';
import { BLACKJACK_DEAL, dealGapMs } from '../../../shared/games/blackjack/deal.js';
import type { BlackjackMoveTarget } from '../../../shared/games/blackjack/protocol.js';
import { awayLine, nextHand } from './dealer.js';
import { actingHand, actionsFor, adjustChips, canSkip, cardsHeld, draw, fail, nameOf, noticeMessage, settledStatus, snapshot, type BlackjackData, type Gx, type HandData } from './state.js';

const NOT_YOUR_TURN = 'It is not your turn.';

/** A move as sent: aimed at a hand (the whole target, or any part of it, may be missing from an older client). */
export type MoveAim = Partial<BlackjackMoveTarget>;

/**
 * A move aimed at a hand that is no longer the one in play: a second tap sent before the first
 * one's answer arrived (the first hit drew, the stand passed the turn, the split made two hands),
 * or a tap from the last round. It is ignored without a word: the player meant the first one.
 */
function stale(data: BlackjackData, playerId: string, aim: MoveAim): boolean {
  if (aim.round === undefined && aim.handIndex === undefined && aim.cards === undefined) return false;
  if (data.phase.kind !== 'acting' || data.phase.playerId !== playerId) return true;
  if (aim.round !== undefined && aim.round !== data.round) return true;
  if (aim.handIndex !== undefined && aim.handIndex !== data.phase.handIndex) return true;
  return aim.cards !== undefined && aim.cards !== cardsHeld(data, playerId);
}

/** The hand is done with: on to the next one (or the dealer). A bust is called out. */
function finishHand(gx: Gx, playerId: string, hand: HandData, status: 'stood' | 'bust'): void {
  hand.status = status;
  if (status === 'bust') gx.effects.push({ type: 'chat', to: 'all', kind: 'close', text: `${nameOf(gx.ctx, playerId)} busts with ${handTotal(hand.cards).total}.` });
  nextHand(gx);
}

export function hit(gx: Gx, playerId: string, aim: MoveAim = {}): void {
  if (stale(gx.data, playerId, aim)) return;
  const hand = actingHand(gx.data, playerId);
  if (!hand) return fail(gx, playerId, NOT_YOUR_TURN);
  if (!actionsFor(gx.data, playerId).canHit) return fail(gx, playerId, 'Split aces take one card each.');
  hand.cards.push(draw(gx));
  gx.leadMs = BLACKJACK_DEAL.deal;
  // A bust or a 21 moves on by itself; otherwise the player keeps acting.
  const settled = settledStatus(hand);
  if (settled === 'bust' || settled === 'stood') return finishHand(gx, playerId, hand, settled);
  snapshot(gx);
}

export function stand(gx: Gx, playerId: string, aim: MoveAim = {}): void {
  if (stale(gx.data, playerId, aim)) return;
  const hand = actingHand(gx.data, playerId);
  if (!hand || !actionsFor(gx.data, playerId).canStand) return fail(gx, playerId, NOT_YOUR_TURN);
  finishHand(gx, playerId, hand, 'stood');
}

/** Twice the stake for exactly one more card; split hands too. */
export function double(gx: Gx, playerId: string, aim: MoveAim = {}): void {
  if (stale(gx.data, playerId, aim)) return;
  const hand = actingHand(gx.data, playerId);
  if (!hand) return fail(gx, playerId, NOT_YOUR_TURN);
  if (!actionsFor(gx.data, playerId).canDouble) return fail(gx, playerId, 'You cannot double this hand.');
  adjustChips(gx, playerId, -hand.bet);
  hand.bet *= 2;
  hand.doubled = true;
  hand.cards.push(draw(gx));
  gx.leadMs = BLACKJACK_DEAL.deal;
  finishHand(gx, playerId, hand, settledStatus(hand) === 'bust' ? 'bust' : 'stood');
}

/**
 * A pair becomes two hands side by side with the same stake, each dealt a second card, and the
 * play goes on from the left one. Split aces take that one card (a second ace may be split again);
 * other pairs play on and may be split again too. There is no cap: only the chips stop a split.
 */
export function split(gx: Gx, playerId: string, aim: MoveAim = {}): void {
  const { data, ctx } = gx;
  if (stale(data, playerId, aim)) return;
  const hand = actingHand(data, playerId);
  const seat = data.seats[playerId];
  if (!hand || !seat || data.phase.kind !== 'acting') return fail(gx, playerId, NOT_YOUR_TURN);
  if (!actionsFor(data, playerId).canSplit) return fail(gx, playerId, 'You cannot split this hand.');
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
  // The right card slides over, then a card is dealt to each hand.
  gx.leadMs = BLACKJACK_DEAL.move + dealGapMs(2) + BLACKJACK_DEAL.deal;
  gx.effects.push({ type: 'chat', to: 'all', kind: 'system', text: `${nameOf(ctx, playerId)} splits ${aces ? 'aces' : 'a pair'}.` });
  nextHand(gx);
}

/**
 * On another player's turn: the hand named stands (a split hand at a time), if it is still the
 * one in play; a stale target (a second tap after the turn moved on) is ignored without a word.
 * The host's Skip, or anyone's on the host's own turn or on the turn of a player who is away.
 */
export function skip(gx: Gx, playerId: string, target: { playerId: string; handIndex: number }): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'acting' || data.phase.playerId !== target.playerId || data.phase.handIndex !== target.handIndex) return;
  if (data.phase.playerId === playerId) return fail(gx, playerId, 'It is your own turn.');
  if (!canSkip(ctx, data, playerId)) return fail(gx, playerId, 'Only the host can skip a turn.');
  const actor = data.phase.playerId;
  const hand = actingHand(data, actor);
  if (!hand) return nextHand(gx);
  noticeMessage(gx, `${nameOf(ctx, playerId)} stood ${nameOf(ctx, actor)}’s hand.`);
  finishHand(gx, actor, hand, 'stood');
}

/** The player in play dropped: their hand stands at once and the play moves on (nextHand stands their later hands too). */
export function standAway(gx: Gx, playerId: string): void {
  const { data } = gx;
  if (data.phase.kind !== 'acting' || data.phase.playerId !== playerId) return;
  const hand = actingHand(data, playerId);
  if (!hand) return nextHand(gx);
  hand.status = 'stood';
  noticeMessage(gx, awayLine(gx, playerId));
  nextHand(gx, new Set([playerId]));
}
