/** The round boundary: the next round's betting, the end of the game (with its final pause), the host's End game and the holds. */
import { RESUME_SETTLE_MS, holdEffects, resumeEffect } from '../waiting.js';
import { needsReshuffle } from '../../../shared/games/blackjack/cards.js';
import { MIN_PLAYERS, activePlayers, adjustChips, connectedActive, fail, rebuildShoe, shoeSizeOf, snapshot, systemMessage, type Gx } from './state.js';

/** Seats a newcomer (or a player without a seat yet) with the starting stack. */
export function seatPlayer(gx: Gx, playerId: string): void {
  if (gx.data.seats[playerId]) return;
  gx.data.seats[playerId] = { chips: 0, bet: 0, hands: [], bustedOut: false };
  adjustChips(gx, playerId, gx.ctx.settings.startingChips);
}

/**
 * Whether the game is over at this boundary, with the line that says why: the host's End game,
 * every stack gone, or (two or more players) one stack left. The rounds never run out. A newcomer
 * waiting for a seat keeps the game going (they are dealt in next), so the last one standing is
 * always a seated player with chips.
 */
function gameIsOver(gx: Gx): boolean {
  const { data, ctx } = gx;
  const active = activePlayers(ctx, data);
  if (active.length === 0) {
    systemMessage(gx, 'Everyone is out of chips. The house wins.');
    return true;
  }
  if (data.endRequested) return true;
  const seated = active.filter((p) => data.seats[p.id]);
  if (ctx.players.length >= 2 && seated.length === 1 && active.length === 1) {
    systemMessage(gx, `${seated[0].name} is the last one standing.`);
    return true;
  }
  return false;
}

/** Seats every newcomer: the table has no seat limit, so a big party all plays. */
function seatNewcomers(gx: Gx): void {
  const { data, ctx } = gx;
  for (const p of activePlayers(ctx, data)) if (!data.seats[p.id]) seatPlayer(gx, p.id);
}

/**
 * Seats the newcomers and puts every seat still in the game into the round about to be bet on,
 * with a shoe that holds a round for all of them. The table is clear, so a rebuild puts the last
 * round's cards back in the shoe.
 */
function fillRound(gx: Gx): void {
  const { data, ctx } = gx;
  seatNewcomers(gx);
  data.order = activePlayers(ctx, data)
    .filter((p) => data.seats[p.id])
    .map((p) => p.id);
  if (needsReshuffle(data.shoe.length, shoeSizeOf(data, ctx.settings), data.order.length)) rebuildShoe(gx, 'The shoe is running low');
}

/**
 * Straight after a settle: the next round's betting, its clock lengthened by `revealMs` so the
 * dealer's reveal can play first, or the final pause with the settled table on show.
 */
export function afterSettle(gx: Gx, revealMs: number): void {
  const { data, ctx } = gx;
  if (ctx.players.length >= MIN_PLAYERS && gameIsOver(gx)) {
    data.phase = { kind: 'ending', endsAt: ctx.now + revealMs + ctx.settings.resultsSeconds * 1000 };
    return snapshot(gx);
  }
  beginRound(gx, revealMs);
}

/**
 * The next round, or the end of the game (at once: no table is waiting to be seen). With nobody
 * still in the game connected it holds instead (a reconnect or a join calls it again), and it
 * abandons the game only when no seat is left.
 */
export function beginRound(gx: Gx, revealMs = 0): void {
  const { data, ctx } = gx;
  if (ctx.players.length < MIN_PLAYERS) {
    gx.effects.push({ type: 'abort', reason: 'Not enough players. Back to the lobby.' });
    return;
  }
  if (gameIsOver(gx)) return finishGame(gx);
  if (connectedActive(ctx, data).length < MIN_PLAYERS) return hold(gx);
  if (data.phase.kind === 'held') gx.effects.push(resumeEffect());

  data.round += 1;
  data.reshuffled = false;
  for (const seat of Object.values(data.seats)) {
    seat.bet = 0;
    seat.hands = [];
  }
  data.dealer = [];
  data.holeHidden = true;
  // Only a round that really starts seats the newcomers (with the starting stack).
  fillRound(gx);
  data.phase = { kind: 'betting', endsAt: ctx.now + revealMs + ctx.settings.betSeconds * 1000 };
  systemMessage(gx, `Round ${data.round}: place your bets!`);
  snapshot(gx);
}

/** Betting with its clock run out and no bet down: the table waits, unclocked, for the first one. */
export function waitingForFirstBet(gx: Gx): boolean {
  const { phase } = gx.data;
  return phase.kind === 'betting' && phase.endsAt === null;
}

/**
 * The betting clock ran out and nobody bet: no cards go out. The table waits for the first bet
 * (newcomers are seated straight into it), or holds when nobody still in the game is connected;
 * the round is not spent either way.
 */
export function awaitFirstBet(gx: Gx): void {
  const { data, ctx } = gx;
  if (connectedActive(ctx, data).length < MIN_PLAYERS) {
    data.round -= 1;
    return hold(gx);
  }
  data.phase = { kind: 'betting', endsAt: null };
  fillRound(gx);
  systemMessage(gx, 'Nobody bet. The dealer waits for the first bet.');
  snapshot(gx);
}

/** A newcomer joining a table that waits for its first bet is seated at once; false otherwise. */
export function seatWhileWaiting(gx: Gx): boolean {
  if (!waitingForFirstBet(gx)) return false;
  fillRound(gx);
  snapshot(gx);
  return true;
}

/**
 * A player dropped, came back or left: a hold is re-evaluated, and a table waiting for a first bet
 * holds once nobody connected is left to place it. `seatsChanged` sends the table out regardless.
 */
export function onConnectionChange(gx: Gx, seatsChanged = false): void {
  const { data, ctx } = gx;
  if (waitingForFirstBet(gx) && connectedActive(ctx, data).length < MIN_PLAYERS) {
    data.round -= 1;
    return hold(gx);
  }
  if (seatsChanged) return snapshotOrResume(gx);
  resumeIfHeld(gx);
}

/** The host ends the game: at once between hands (stakes on the table go back), otherwise once the hand in play settles. */
export function endGame(gx: Gx, playerId: string): void {
  const { data, ctx } = gx;
  if (playerId !== ctx.hostId) return fail(gx, playerId, 'Only the host can end the game.');
  switch (data.phase.kind) {
    case 'ending':
    case 'gameOver':
      return fail(gx, playerId, 'The game is ending already.');
    case 'acting':
      if (data.endRequested) return fail(gx, playerId, 'The game ends after this hand.');
      data.endRequested = true;
      systemMessage(gx, 'The host ends the game after this hand.');
      return snapshot(gx);
    case 'betting':
      for (const id of data.order) {
        const seat = data.seats[id];
        adjustChips(gx, id, seat.bet);
        seat.bet = 0;
      }
      break;
    case 'held':
      gx.effects.push(resumeEffect());
      break;
  }
  data.endRequested = true;
  systemMessage(gx, 'The host ended the game.');
  finishGame(gx);
}

export function finishGame(gx: Gx): void {
  gx.data.phase = { kind: 'gameOver' };
  gx.effects.push({ type: 'gameOver' });
}

/** Holds before the next round until somebody still in the game is connected; the chat line goes out once. */
function hold(gx: Gx): void {
  const { data, ctx } = gx;
  const fresh = data.phase.kind !== 'held';
  data.phase = { kind: 'held', resumeAt: null };
  gx.effects.push(...holdEffects(activePlayers(ctx, data), fresh));
}

/**
 * Re-evaluates a hold after the player list changed: a refreshed hold while nobody is connected,
 * otherwise a settle before the next round, restarted by every further reconnect.
 */
export function resumeIfHeld(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'held') return;
  if (ctx.players.length < MIN_PLAYERS || connectedActive(ctx, data).length < MIN_PLAYERS) return beginRound(gx);
  data.phase.resumeAt = ctx.now + RESUME_SETTLE_MS;
  gx.effects.push(...holdEffects(activePlayers(ctx, data), false));
}

/** The settle ran out: the next round with everyone connected by now, or a fresh hold if they dropped again. */
export function settleDue(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'held' || data.phase.resumeAt === null || ctx.now < data.phase.resumeAt) return;
  beginRound(gx);
}

/** A seat change between hands only matters to a hold. */
export function snapshotOrResume(gx: Gx): void {
  if (gx.data.phase.kind === 'held') return resumeIfHeld(gx);
  snapshot(gx);
}
