/** Turn lifecycle: start -> choosing -> drawing (hints) -> turnEnd -> next turn / game over. */
import { CHOOSE_TIME_SECONDS, TURN_END_SECONDS } from '../../../shared/games/skribble/constants.js';
import { hintCountFor, hintRevealOrder, hintSchedule } from '../../../shared/games/skribble/hints.js';
import type { SkribbleServerMessage, TurnEndReason } from '../../../shared/games/skribble/protocol.js';
import { drawerPoints } from '../../../shared/games/skribble/scoring.js';
import { buildWordPool, pickWords } from '../../../shared/games/skribble/words/index.js';
import { gameById } from '../../../shared/platform/games.js';
import type { GameEffect, PlatformPlayer } from '../../platform/game.js';
import { holdEffects, resumeEffect } from '../waiting.js';
import { connectedCount, findPlayer, isHeld, type Ctx, type SkribbleData } from './state.js';

/** The module's working context: a private copy of the state plus the effects produced so far. */
export interface Gx {
  ctx: Ctx;
  data: SkribbleData;
  effects: GameEffect<SkribbleServerMessage>[];
}

const MIN_PLAYERS = gameById('skribble').minPlayers;

export function systemMessage(gx: Gx, text: string): void {
  gx.effects.push({ type: 'chat', to: 'all', kind: 'system', text });
}

export function snapshot(gx: Gx): void {
  gx.effects.push({ type: 'snapshot', to: 'all' });
}

export function fail(gx: Gx, playerId: string, message: string): void {
  gx.effects.push({ type: 'error', playerId, code: 'NOT_ALLOWED', message });
}

/** Drops the grace periods that belong to the current turn (the phase's own deadlines die with the phase). */
export function clearTurnGrace(gx: Gx): void {
  gx.data.grace.drawerGoneAt = null;
  gx.data.grace.allGuessedAt = null;
}

/** Empties the canvas for everyone; the next drawing must not inherit the last one. */
export function resetCanvas(gx: Gx): void {
  gx.data.canvasId = gx.ctx.newId();
  gx.effects.push({ type: 'side', name: 'reset', payload: { stamp: gx.data.canvasId } });
  gx.effects.push({ type: 'send', to: 'all', msg: { t: 'clear' } });
}

/**
 * The turn boundary: the next turn, the next round or the end of the game. With fewer than two
 * players connected it holds at the summary instead (a reconnect or a join calls it again), and
 * it abandons the game only when fewer than two hold a seat at all.
 */
export function beginNextTurn(gx: Gx): void {
  const { data, ctx } = gx;
  clearTurnGrace(gx);
  if (ctx.players.length < MIN_PLAYERS) {
    gx.effects.push({ type: 'abort', reason: 'Not enough players — back to the lobby.' });
    return;
  }
  // A game with no turn left is over whoever is connected: the podium neither waits for an absent
  // player nor is lost to their seat expiring during a hold.
  if (data.turnIndex + 1 >= data.turnQueue.length && data.round >= ctx.settings.rounds) return finishGame(gx);
  if (connectedCount(ctx) < MIN_PLAYERS) return holdTurnBoundary(gx);
  if (isHeld(data)) gx.effects.push(resumeEffect());
  for (;;) {
    data.turnIndex += 1;
    if (data.turnIndex >= data.turnQueue.length) {
      if (data.round >= ctx.settings.rounds) return finishGame(gx);
      data.round += 1;
      data.turnQueue = ctx.players.map((p) => p.id);
      data.turnIndex = -1;
      continue;
    }
    const drawer = findPlayer(ctx, data.turnQueue[data.turnIndex]);
    if (!drawer || !drawer.connected) {
      // Skipped drawers leave the schedule so turn/turnsInRound stay accurate (and get back in on return).
      if (drawer) systemMessage(gx, `${drawer.name} is away — skipping their turn.`);
      data.turnQueue.splice(data.turnIndex, 1);
      data.turnIndex -= 1;
      continue;
    }
    return startChoosing(gx, drawer);
  }
}

function startChoosing(gx: Gx, drawer: PlatformPlayer): void {
  const { data, ctx } = gx;
  resetCanvas(gx);
  const pool = buildWordPool(ctx.settings.language, ctx.settings.customWords, ctx.settings.customWordsOnly);
  const choices = pickWords(pool, ctx.settings.wordChoices, data.usedWords, ctx.rng);
  data.turn = {
    drawerId: drawer.id,
    choices,
    word: '',
    startedAt: 0,
    endsAt: 0,
    revealOrder: [],
    revealAt: [],
    revealed: [],
    correct: 0,
    guesserIds: [],
    guessed: [drawer.id],
    points: {},
    ratings: {},
  };
  if (choices.length === 0) {
    data.phase = { kind: 'choosing', endsAt: ctx.now };
    return endTurn(gx, 'noWordChosen');
  }
  data.phase = { kind: 'choosing', endsAt: ctx.now + CHOOSE_TIME_SECONDS * 1000 };
  snapshot(gx);
}

export function chooseWord(gx: Gx, playerId: string, index: number): void {
  const { data } = gx;
  if (data.phase.kind !== 'choosing' || data.turn?.drawerId !== playerId) {
    return fail(gx, playerId, 'You are not choosing a word right now.');
  }
  const word = data.turn.choices[index];
  if (word === undefined) return fail(gx, playerId, 'That is not one of your choices.');
  startDrawing(gx, word);
}

/**
 * The choose deadline passed: auto-pick the first choice. A drawer who is away keeps the turn
 * until their reconnect grace runs out (the deadline moves out to it, and picks for them on it
 * should they be back by then); only then are they skipped.
 */
export function chooseTimedOut(gx: Gx): void {
  const { data, ctx } = gx;
  const turn = data.turn;
  if (!turn || data.phase.kind !== 'choosing') return;
  const drawer = findPlayer(ctx, turn.drawerId);
  if (drawer?.connected) return startDrawing(gx, turn.choices[0]);
  const goneAt = data.grace.drawerGoneAt;
  if (goneAt !== null && goneAt > ctx.now) {
    data.phase.endsAt = goneAt;
    return snapshot(gx);
  }
  systemMessageForDrawerGone(gx);
  endTurn(gx, 'drawerLeft');
}

function startDrawing(gx: Gx, word: string): void {
  const { data, ctx } = gx;
  const turn = data.turn;
  if (!turn) return;
  const drawTimeMs = ctx.settings.drawTime * 1000;
  const lower = word.toLowerCase();
  if (!data.usedWords.includes(lower)) data.usedWords.push(lower);
  const hintCount = hintCountFor(word, ctx.settings.hints);
  turn.word = word;
  turn.startedAt = ctx.now;
  turn.endsAt = ctx.now + drawTimeMs;
  turn.revealOrder = hintRevealOrder(word, hintCount, ctx.rng);
  turn.revealAt = hintSchedule(drawTimeMs, hintCount).map((offset) => ctx.now + offset);
  turn.revealed = [];
  turn.correct = 0;
  turn.guesserIds = ctx.players.filter((p) => p.connected && p.id !== turn.drawerId).map((p) => p.id);
  data.phase = { kind: 'drawing' };
  snapshot(gx);
}

export function revealHint(gx: Gx): void {
  const turn = gx.data.turn;
  if (gx.data.phase.kind !== 'drawing' || !turn) return;
  const idx = turn.revealOrder[turn.revealed.length];
  if (idx === undefined) return;
  turn.revealed.push(idx);
  snapshot(gx);
}

export function endTurn(gx: Gx, reason: TurnEndReason): void {
  const { data, ctx } = gx;
  const turn = data.turn;
  if (!turn || (data.phase.kind !== 'choosing' && data.phase.kind !== 'drawing')) return;
  clearTurnGrace(gx);

  const drawer = findPlayer(ctx, turn.drawerId);
  if (drawer && reason !== 'drawerLeft' && reason !== 'noWordChosen') {
    // Per-turn tallies, not the current player list: a guesser who dropped or left after
    // solving still counts, and one who dropped without solving still dilutes the share.
    const pts = drawerPoints(turn.correct, turn.guesserIds.length);
    if (pts > 0) {
      gx.effects.push({ type: 'score', playerId: drawer.id, delta: pts });
      turn.points[drawer.id] = (turn.points[drawer.id] ?? 0) + pts;
    }
  }

  data.phase = { kind: 'turnEnd', reason, endsAt: ctx.now + TURN_END_SECONDS * 1000, points: { ...turn.points }, held: false };
  if (turn.word) gx.effects.push({ type: 'chat', to: 'all', kind: 'hint', text: `The word was: ${turn.word}` });
  snapshot(gx);
}

function finishGame(gx: Gx): void {
  clearTurnGrace(gx);
  gx.data.phase = { kind: 'gameOver' };
  gx.effects.push({ type: 'gameOver' });
}

/** Announces that the drawer's reconnect grace ran out (the caller ends the turn). */
export function systemMessageForDrawerGone(gx: Gx): void {
  const drawer = gx.data.turn ? findPlayer(gx.ctx, gx.data.turn.drawerId) : undefined;
  if (drawer) systemMessage(gx, `${drawer.name} lost connection — skipping their turn.`);
}

/**
 * Holds at the summary: the next turn starts once two players are connected again. Called again
 * while held whenever the player list changes, so the platform's missing list stays current; the
 * chat line goes out once.
 */
function holdTurnBoundary(gx: Gx): void {
  const { data, ctx } = gx;
  const fresh = !isHeld(data);
  // Every turn boundary passes through a summary (start seeds one), so there is always one to hold at.
  if (data.phase.kind === 'turnEnd') data.phase.held = true;
  gx.effects.push(...holdEffects(ctx.players, fresh));
}

/** Re-evaluates a held turn boundary after the player list changed: resume, or refresh the hold. */
export function resumeHeldTurn(gx: Gx): void {
  if (isHeld(gx.data)) beginNextTurn(gx);
}

export function rate(gx: Gx, playerId: string, value: 'like' | 'dislike'): void {
  const { data } = gx;
  if (data.phase.kind !== 'drawing' || !data.turn) return fail(gx, playerId, 'There is nothing to rate right now.');
  if (data.turn.drawerId === playerId) return fail(gx, playerId, "You can't rate your own drawing.");
  if (data.turn.ratings[playerId] === value) delete data.turn.ratings[playerId];
  else data.turn.ratings[playerId] = value;
  snapshot(gx);
}
