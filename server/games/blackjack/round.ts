/** The round boundary: the next round's betting, the end of the game (with its final pause), the host's End game and the holds. */
import { RESUME_SETTLE_MS, holdEffects, resumeEffect } from '../waiting.js';
import { needsReshuffle } from '../../../shared/games/blackjack/cards.js';
import { gameById } from '../../../shared/platform/games.js';
import { MIN_PLAYERS, activePlayers, adjustChips, connectedActive, fail, rebuildShoe, snapshot, systemMessage, type Gx } from './state.js';

/** Seats a newcomer (or a player without a seat yet) with the starting stack. */
export function seatPlayer(gx: Gx, playerId: string): void {
  if (gx.data.seats[playerId]) return;
  gx.data.seats[playerId] = { chips: 0, bet: 0, hands: [], bustedOut: false };
  adjustChips(gx, playerId, gx.ctx.settings.startingChips);
}

const MAX_SEATS = gameById('blackjack').maxPlayers ?? Infinity;

/**
 * Whether the game is over at this boundary, with the line that says why: the host's End game,
 * the last round played, every stack gone, or (unlimited, two or more players) one stack left.
 * A newcomer waiting for a seat keeps the game going (they are dealt in next), so the last one
 * standing is always a seated player with chips.
 */
function gameIsOver(gx: Gx): boolean {
  const { data, ctx } = gx;
  const active = activePlayers(ctx, data);
  if (active.length === 0) {
    systemMessage(gx, 'Everyone is out of chips. The house wins.');
    return true;
  }
  if (data.endRequested) return true;
  const { rounds } = ctx.settings;
  if (rounds > 0) return data.round >= rounds;
  const seated = active.filter((p) => data.seats[p.id]);
  if (ctx.players.length >= 2 && seated.length === 1 && active.length === 1) {
    systemMessage(gx, `${seated[0].name} is the last one standing.`);
    return true;
  }
  return false;
}

/** Deals in newcomers while the table has a free seat (busted-out players free theirs); the rest wait and watch. */
function seatNewcomers(gx: Gx): void {
  const { data, ctx } = gx;
  const active = activePlayers(ctx, data);
  let taken = active.filter((p) => data.seats[p.id]).length;
  for (const p of active) {
    if (data.seats[p.id] || taken >= MAX_SEATS) continue;
    seatPlayer(gx, p.id);
    taken += 1;
  }
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
  const active = activePlayers(ctx, data);
  if (connectedActive(ctx, data).length < MIN_PLAYERS) return hold(gx);
  if (data.phase.kind === 'held') gx.effects.push(resumeEffect());

  // Only a round that really starts seats the newcomers (with the starting stack).
  seatNewcomers(gx);
  data.round += 1;
  data.reshuffled = false;
  data.order = active.filter((p) => data.seats[p.id]).map((p) => p.id);
  for (const seat of Object.values(data.seats)) {
    seat.bet = 0;
    seat.hands = [];
  }
  data.dealer = [];
  data.holeHidden = true;
  // The table is clear, so a rebuild here puts the last round's cards back in the shoe.
  if (needsReshuffle(data.shoe.length, ctx.settings.decks)) rebuildShoe(gx, 'Under a quarter of the shoe is left');
  data.phase = { kind: 'betting', endsAt: ctx.now + revealMs + ctx.settings.betSeconds * 1000 };
  const { rounds } = ctx.settings;
  systemMessage(gx, `Round ${data.round}${rounds > 0 ? ` of ${rounds}` : ''}: place your bets!`);
  snapshot(gx);
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
