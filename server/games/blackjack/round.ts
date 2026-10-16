/** The round boundary: the results pause, the next round's betting, the end of the game, the host's End game and the holds. */
import { RESUME_SETTLE_MS, holdEffects, resumeEffect } from '../waiting.js';
import { BLACKJACK_RESULTS_MS } from '../../../shared/games/blackjack/protocol.js';
import { MIN_PLAYERS, activePlayers, adjustChips, connectedActive, dropLegacyShoe, noticeMessage, snapshot, systemMessage, type Gx } from './state.js';

/** Seats a player with the starting stack (at the start: nobody joins the game later). */
export function seatPlayer(gx: Gx, playerId: string): void {
  if (gx.data.seats[playerId]) return;
  gx.data.seats[playerId] = { chips: 0, bet: 0, hands: [], bustedOut: false, sittingOut: false };
  adjustChips(gx, playerId, gx.ctx.settings.startingChips);
}

/**
 * Whether the game is over at this boundary, with the line that says why: the host's End game,
 * every stack gone, or (two or more players) one stack left. The rounds never run out.
 */
function gameIsOver(gx: Gx): boolean {
  const { data, ctx } = gx;
  const active = activePlayers(ctx, data);
  if (active.length === 0) {
    systemMessage(gx, 'Everyone is out of chips. The house wins.');
    return true;
  }
  if (data.endRequested) return true;
  if (ctx.players.length >= 2 && active.length === 1) {
    systemMessage(gx, `${active[0].name} is the last one standing.`);
    return true;
  }
  return false;
}

/** Puts every seat still in the game into the round about to be bet on. */
export function fillRound(gx: Gx): void {
  const { data, ctx } = gx;
  data.order = activePlayers(ctx, data).map((p) => p.id);
}

/**
 * Straight after a settle the table stays on show for the dealer's reveal (`revealMs`). Then the
 * next round's bets open at once, the settled hands still on show until the deal; or, when the
 * game is over, the final table stays BLACKJACK_RESULTS_MS more before the results.
 */
export function afterSettle(gx: Gx, revealMs: number): void {
  const { data, ctx } = gx;
  // Nobody left to see it: back to the lobby at once.
  if (ctx.players.length < MIN_PLAYERS) return beginRound(gx);
  data.phase = gameIsOver(gx) ? { kind: 'ending', endsAt: ctx.now + revealMs + BLACKJACK_RESULTS_MS } : { kind: 'results', endsAt: ctx.now + revealMs };
  snapshot(gx);
}

/**
 * The next round, or the end of the game (at once: no table is waiting to be seen). With nobody
 * still in the game connected it holds instead (a reconnect calls it again), and it
 * abandons the game only when no seat is left.
 */
export function beginRound(gx: Gx): void {
  const { data, ctx } = gx;
  if (ctx.players.length < MIN_PLAYERS) {
    gx.effects.push({ type: 'abort', reason: 'Not enough players to go on.' });
    return;
  }
  if (gameIsOver(gx)) return finishGame(gx);
  if (connectedActive(ctx, data).length < MIN_PLAYERS) return hold(gx);
  if (data.phase.kind === 'held') gx.effects.push(resumeEffect());

  data.round += 1;
  dropLegacyShoe(data);
  for (const seat of Object.values(data.seats)) {
    seat.bet = 0;
    seat.hands = [];
    seat.sittingOut = false;
  }
  data.dealer = [];
  data.holeHidden = true;
  fillRound(gx);
  data.phase = { kind: 'betting' };
  systemMessage(gx, `Round ${data.round}: place your bets!`);
  snapshot(gx);
}

/**
 * The bets are open with none down and nobody still in the game is connected to place one: the
 * table holds, and the round is not spent (it opens again once someone is back).
 */
export function holdBetting(gx: Gx): void {
  gx.data.round -= 1;
  hold(gx);
}

/**
 * The host's End game (the platform's, through the module's `end`): at once between hands (stakes
 * on the table go back), otherwise once the hand in play settles. A final table already on show
 * gives way to the results at once.
 */
export function endGame(gx: Gx): void {
  const { data } = gx;
  switch (data.phase.kind) {
    case 'gameOver':
      return;
    case 'ending':
      return finishGame(gx);
    case 'acting':
      if (data.endRequested) return;
      data.endRequested = true;
      noticeMessage(gx, 'The game ends after this hand.');
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
    case 'results':
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
