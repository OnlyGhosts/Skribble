/** Round lifecycle: betting -> dealing -> acting (see play.ts) -> the dealer -> results -> next round, the holds and the end. */
import { dealerShouldHit, handTotal, needsReshuffle, settleHand } from '../../../shared/games/blackjack/cards.js';
import type { HandResult, HandStatus } from '../../../shared/games/blackjack/protocol.js';
import { RESUME_SETTLE_MS, holdEffects, resumeEffect } from '../waiting.js';
import { MIN_PLAYERS, activePlayers, adjustChips, draw, fail, isHeld, nameOf, rebuildShoe, settledStatus, snapshot, systemMessage, type Gx } from './state.js';

/** Seats a newcomer (or a player without a seat yet) with the starting stack. */
export function seatPlayer(gx: Gx, playerId: string): void {
  if (gx.data.seats[playerId]) return;
  gx.data.seats[playerId] = { chips: 0, bet: 0, hands: [], bustedOut: false };
  adjustChips(gx, playerId, gx.ctx.settings.startingChips);
}

/**
 * The round boundary: the next round, or the end of the game after the last round or once
 * every stack is gone. With nobody still in the game connected it holds at the results instead
 * (a reconnect or a join calls it again), and it abandons the game only when no seat is left.
 */
export function beginRound(gx: Gx): void {
  const { data, ctx } = gx;
  if (ctx.players.length < MIN_PLAYERS) {
    gx.effects.push({ type: 'abort', reason: 'Not enough players — back to the lobby.' });
    return;
  }
  const active = activePlayers(ctx, data);
  if (active.length === 0) {
    systemMessage(gx, 'Everyone is out of chips — the house wins.');
    return finishGame(gx);
  }
  if (data.round >= ctx.settings.rounds) return finishGame(gx);
  if (active.filter((p) => p.connected).length < MIN_PLAYERS) return hold(gx);
  if (isHeld(data)) gx.effects.push(resumeEffect());

  // Only a round that really starts seats the newcomers (with the starting stack).
  for (const p of active) seatPlayer(gx, p.id);
  data.round += 1;
  data.reshuffled = false;
  data.order = active.map((p) => p.id);
  for (const seat of Object.values(data.seats)) {
    seat.bet = 0;
    seat.hands = [];
  }
  data.dealer = [];
  data.holeHidden = true;
  // The table is clear, so a rebuild here puts the last round's cards back in the shoe.
  if (needsReshuffle(data.shoe.length, ctx.settings.decks)) rebuildShoe(gx, 'Under a quarter of the shoe is left');
  data.phase = { kind: 'betting', endsAt: ctx.now + ctx.settings.betSeconds * 1000 };
  systemMessage(gx, `Round ${data.round} of ${ctx.settings.rounds} — place your bets!`);
  snapshot(gx);
}

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

/** Two cards each, the dealer's up card between the first and the second; naturals are called out. */
function deal(gx: Gx): void {
  const { data, ctx } = gx;
  data.order = data.order.filter((id) => data.seats[id].bet > 0);
  data.results = [];
  if (data.order.length === 0) {
    // Nobody is left to deal to (the seats emptied while the bets were open): the round is not spent.
    data.round -= 1;
    data.phase = { kind: 'results', endsAt: ctx.now, held: false, resumeAt: null };
    return beginRound(gx);
  }
  for (const id of data.order) data.seats[id].hands = [{ cards: [draw(gx)], bet: data.seats[id].bet, status: 'waiting', doubled: false, fromSplit: false }];
  data.dealer = [draw(gx)];
  for (const id of data.order) {
    const hand = data.seats[id].hands[0];
    hand.cards.push(draw(gx));
    if (settledStatus(hand) === 'blackjack') {
      hand.status = 'blackjack';
      systemMessage(gx, `${nameOf(ctx, id)} has blackjack!`);
    }
  }
  data.dealer.push(draw(gx));
  nextHand(gx);
}

/** Hands the play to the first hand still waiting (join order, then hand order); none left means the dealer's turn. */
export function nextHand(gx: Gx): void {
  const { data, ctx } = gx;
  for (const id of data.order) {
    const index = data.seats[id].hands.findIndex((h) => h.status === 'waiting');
    if (index === -1) continue;
    data.seats[id].hands[index].status = 'acting';
    data.phase = { kind: 'acting', playerId: id, handIndex: index, endsAt: ctx.now + ctx.settings.actSeconds * 1000 };
    return snapshot(gx);
  }
  dealerPlays(gx);
}

/** The hole card shows; the dealer draws only while a standing hand is waiting on the outcome, then every hand is settled. */
function dealerPlays(gx: Gx): void {
  const { data, ctx } = gx;
  data.holeHidden = false;
  const hands = data.order.flatMap((id) => data.seats[id].hands);
  if (hands.some((h) => h.status === 'stood')) {
    while (dealerShouldHit(data.dealer, ctx.settings.dealerHitsSoft17)) data.dealer.push(draw(gx));
  }
  const house = handTotal(data.dealer).total;
  systemMessage(gx, house > 21 ? `The dealer busts with ${house}.` : `The dealer ${hands.some((h) => h.status === 'stood') ? 'stands on' : 'shows'} ${house}.`);
  settle(gx);
  startResults(gx);
}

const STATUS_OF: Record<HandResult['outcome'], HandStatus> = { win: 'won', blackjack: 'blackjack', push: 'push', loss: 'lost' };

function settle(gx: Gx): void {
  const { data, ctx } = gx;
  const lines: string[] = [];
  const out: string[] = [];
  for (const id of data.order) {
    const seat = data.seats[id];
    seat.hands.forEach((hand, handIndex) => {
      const { outcome, payout } = settleHand(hand.cards, hand.bet, hand.fromSplit, data.dealer, ctx.settings.blackjackPayout);
      if (hand.status !== 'bust') hand.status = STATUS_OF[outcome];
      adjustChips(gx, id, payout);
      data.results.push({ playerId: id, handIndex, outcome, bet: hand.bet, payout });
    });
    const net = seat.hands.reduce((sum, h) => sum + h.bet, 0);
    const back = data.results.filter((r) => r.playerId === id).reduce((sum, r) => sum + r.payout, 0);
    lines.push(back > net ? `${nameOf(ctx, id)} wins ${back - net}` : back === net ? `${nameOf(ctx, id)} pushes` : `${nameOf(ctx, id)} loses ${net - back}`);
    if (seat.chips < ctx.settings.minBet) {
      seat.bustedOut = true;
      out.push(id);
    }
  }
  if (lines.length > 0) systemMessage(gx, `${lines.join(', ')}.`);
  for (const id of out) systemMessage(gx, `${nameOf(ctx, id)} is out of chips.`);
}

function startResults(gx: Gx): void {
  const { data, ctx } = gx;
  data.phase = { kind: 'results', endsAt: ctx.now + ctx.settings.resultsSeconds * 1000, held: false, resumeAt: null };
  snapshot(gx);
}

/** The host skips the results. */
export function next(gx: Gx, playerId: string): void {
  if (playerId !== gx.ctx.hostId) return fail(gx, playerId, 'Only the host can skip ahead.');
  if (gx.data.phase.kind !== 'results' || gx.data.phase.held) return fail(gx, playerId, 'There is no result to skip.');
  beginRound(gx);
}

function finishGame(gx: Gx): void {
  gx.data.phase = { kind: 'gameOver' };
  gx.effects.push({ type: 'gameOver' });
}

/** Holds at the results until somebody still in the game is connected; the chat line goes out once. */
function hold(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'results') return;
  const fresh = !data.phase.held;
  data.phase.held = true;
  data.phase.resumeAt = null;
  gx.effects.push(...holdEffects(activePlayers(ctx, data), fresh));
}

/**
 * Re-evaluates a held boundary after the player list changed: a refreshed hold while nobody is
 * connected, otherwise a settle before the next round, restarted by every further reconnect.
 */
export function resumeIfHeld(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'results' || !data.phase.held) return;
  if (ctx.players.length < MIN_PLAYERS || activePlayers(ctx, data).filter((p) => p.connected).length < MIN_PLAYERS) return beginRound(gx);
  data.phase.resumeAt = ctx.now + RESUME_SETTLE_MS;
  gx.effects.push(...holdEffects(activePlayers(ctx, data), false));
}

/** The settle ran out: the next round with everyone connected by now, or a fresh hold if they dropped again. */
export function settleDue(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'results' || !data.phase.held || data.phase.resumeAt === null || ctx.now < data.phase.resumeAt) return;
  beginRound(gx);
}
