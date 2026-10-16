/** Hand and game lifecycle: the boundary between hands, seating, blind increases, holds, the host's controls and the end. */
import { RESUME_SETTLE_MS, holdEffects, resumeEffect } from '../waiting.js';
import { chooseDealer, dealHand } from './dealing.js';
import { IDLE_HANDS_LIMIT, MIN_PLAYERS, adjustChips, bigBlind, fail, findPlayer, isHeld, nameOf, noticeMessage, removeSeat, snapshot, stackedPlayers, systemMessage, type Gx } from './state.js';

/** Seats a player without a seat yet (one queued for a free seat) with the starting stack. */
export function seatPlayer(gx: Gx, playerId: string): void {
  if (gx.data.seats[playerId]) return;
  gx.data.seats[playerId] = { chips: 0, bet: 0, committed: 0, cards: [], status: 'out', lastAction: null, gone: false };
  adjustChips(gx, playerId, gx.ctx.settings.startingChips);
}

/**
 * The hand boundary: the next hand, or the end of the game once one player holds every chip,
 * after the last hand, or at the host's word. With fewer than two stacked players connected it
 * holds at the results instead (a reconnect calls it again), and it abandons the game
 * when too few seats are left at all, or too few stacks because a player left with chips.
 */
export function beginHand(gx: Gx): void {
  const { data, ctx } = gx;
  if (ctx.players.length < MIN_PLAYERS) {
    gx.effects.push({ type: 'abort', reason: 'Not enough players. Back to the lobby.' });
    return;
  }
  // Seats of players who left are cleared at the boundary (their chips in a hand went to its pots).
  for (const id of Object.keys(data.seats)) if (!findPlayer(ctx, id)) removeSeat(data, id);
  const stacked = stackedPlayers(ctx, data);
  if (stacked.length < MIN_PLAYERS) {
    // Too few stacks because a player walked off with theirs: nobody won the table.
    if (data.stackLeft) {
      gx.effects.push({ type: 'abort', reason: 'Not enough players with chips. Back to the lobby.' });
      return;
    }
    if (stacked.length === 1) systemMessage(gx, `${stacked[0].name} has all the chips!`);
    return finishGame(gx);
  }
  if (ctx.settings.hands > 0 && data.hand >= ctx.settings.hands) return finishGame(gx);
  if (data.idleHands >= IDLE_HANDS_LIMIT) {
    noticeMessage(gx, `Nobody played for ${IDLE_HANDS_LIMIT} hands. The game is over.`);
    return finishGame(gx);
  }
  if (stacked.filter((p) => p.connected).length < MIN_PLAYERS) return hold(gx);
  if (isHeld(data)) gx.effects.push(resumeEffect());

  // Only a hand that really starts seats the queued players (with the starting stack), while seats are free.
  for (const p of stacked) seatPlayer(gx, p.id);
  data.hand += 1;
  data.results = null;
  data.acted = false;
  data.stackLeft = false;
  const every = ctx.settings.blindsIncreaseEvery;
  if (every > 0 && data.hand > 1 && (data.hand - 1) % every === 0) {
    data.smallBlind *= 2;
    noticeMessage(gx, `Blinds up: ${data.smallBlind}/${bigBlind(data)}.`);
  }
  for (const seat of Object.values(data.seats)) {
    seat.bet = 0;
    seat.committed = 0;
    seat.cards = [];
    seat.lastAction = null;
    seat.gone = false;
    seat.status = seat.chips > 0 ? 'in' : 'out';
  }
  data.order = stacked.map((p) => p.id);
  const dealer = chooseDealer(gx, stacked);
  data.dealerId = dealer.id;
  data.dealerOrder = dealer.joinOrder;
  dealHand(gx);
}

/** The host skips the results. */
export function next(gx: Gx, playerId: string): void {
  if (playerId !== gx.ctx.hostId) return fail(gx, playerId, 'Only the host can skip ahead.');
  if (gx.data.phase.kind !== 'results' || gx.data.phase.held) return fail(gx, playerId, 'There is no result to skip.');
  beginHand(gx);
}

/** The host ends the game now; a hand in progress is void and every stake goes back to its owner. */
export function endGame(gx: Gx, playerId: string): void {
  const { data, ctx } = gx;
  if (playerId !== ctx.hostId) return fail(gx, playerId, 'Only the host can end the game.');
  if (data.phase.kind === 'gameOver') return fail(gx, playerId, 'The game is over already.');
  if (data.phase.kind === 'acting') {
    for (const id of data.order) {
      const seat = data.seats[id];
      adjustChips(gx, id, seat.bet + seat.committed);
      seat.bet = 0;
      seat.committed = 0;
    }
    data.toAct = [];
    noticeMessage(gx, `${nameOf(ctx, playerId)} ended the game. The hand is void and every stake goes back.`);
  } else if (data.phase.held) gx.effects.push(resumeEffect());
  finishGame(gx);
}

function finishGame(gx: Gx): void {
  gx.data.phase = { kind: 'gameOver' };
  gx.effects.push({ type: 'gameOver' });
}

/** Holds at the results until two stacked players are connected; the chat line goes out once. */
function hold(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'results') return;
  const fresh = !data.phase.held;
  data.phase.held = true;
  data.phase.resumeAt = null;
  gx.effects.push(...holdEffects(stackedPlayers(ctx, data), fresh));
}

/**
 * Re-evaluates a held boundary after the player list changed: a refreshed hold while too few
 * are connected, otherwise a settle before the next hand, restarted by every further reconnect.
 */
export function resumeIfHeld(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'results' || !data.phase.held) return;
  if (ctx.players.length < MIN_PLAYERS || stackedPlayers(ctx, data).filter((p) => p.connected).length < MIN_PLAYERS) return beginHand(gx);
  data.phase.resumeAt = ctx.now + RESUME_SETTLE_MS;
  gx.effects.push(...holdEffects(stackedPlayers(ctx, data), false));
}

/** The settle ran out: the next hand with everyone connected by now, or a fresh hold if they dropped again. */
export function settleDue(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'results' || !data.phase.held || data.phase.resumeAt === null || ctx.now < data.phase.resumeAt) return;
  beginHand(gx);
}

/** Between hands a seat change only matters to a hold; mid-hand the seat plays on by its clock. */
export function snapshotOrResume(gx: Gx): void {
  if (isHeld(gx.data)) return resumeIfHeld(gx);
  snapshot(gx);
}
