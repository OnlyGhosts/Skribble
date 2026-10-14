/** Turn lifecycle: start -> choosing -> guessing (drawing after wrong guesses) -> turnEnd -> next hangman / game over. */
import {
  HANGMAN_CHOOSE_SECONDS,
  HANGMAN_MAX_WRONG,
  HANGMAN_POINTS,
  HANGMAN_TURN_END_SECONDS,
  HANGMAN_WORD_CHOICES,
  type HangmanOutcome,
} from '../../../shared/games/hangman/protocol.js';
import { hangmanWordPool, isValidHangmanWord, lettersOf, normalizeHangmanWord, pickHangmanWords } from '../../../shared/games/hangman/words.js';
import type { PlatformPlayer } from '../../platform/game.js';
import { RESUME_SETTLE_MS, holdEffects, resumeEffect } from '../waiting.js';
import { MIN_PLAYERS, award, connectedAmong, fail, findPlayer, guessersIn, isHeld, nameOf, snapshot, systemMessage, type Clock, type Gx, type TurnData } from './state.js';

/** Empties the canvas for everyone; the next word must not inherit the last figure. */
function resetCanvas(gx: Gx): void {
  gx.data.canvasId = gx.ctx.newId();
  gx.effects.push({ type: 'side', name: 'reset', payload: { stamp: gx.data.canvasId } });
  gx.effects.push({ type: 'send', to: 'all', msg: { t: 'clear' } });
}

export function running(gx: Gx, seconds: number): Clock {
  return { kind: 'running', endsAt: gx.ctx.now + seconds * 1000 };
}

/**
 * The players the next turn is for: the round's participants while the round has turns left,
 * everyone seated (late joiners included) once it moves to the next round. Watchers never count
 * towards a turn that cannot seat them.
 */
function nextTurnPlayerIds(gx: Gx): string[] {
  const { data, ctx } = gx;
  return data.turnIndex + 1 >= data.turnQueue.length ? ctx.players.map((p) => p.id) : data.roundPlayerIds;
}

/** True while too few of the next turn's players are connected for it to start. */
export function tooFewForNextTurn(gx: Gx): boolean {
  return connectedAmong(gx.ctx, nextTurnPlayerIds(gx)) < MIN_PLAYERS;
}

/**
 * The turn boundary: the next hangman, the next round or the end of the game. With fewer than
 * two of the next turn's players connected it holds at the summary instead (a reconnect or a
 * join calls it again), and it abandons the game only when fewer than two hold a seat at all.
 */
export function beginNextTurn(gx: Gx): void {
  const { data, ctx } = gx;
  if (ctx.players.length < MIN_PLAYERS) {
    gx.effects.push({ type: 'abort', reason: 'Not enough players. Back to the lobby.' });
    return;
  }
  // A game with no turn left is over whoever is connected.
  if (data.turnIndex + 1 >= data.turnQueue.length && data.round >= ctx.settings.rounds) return finishGame(gx);
  if (tooFewForNextTurn(gx)) return holdTurnBoundary(gx);
  if (isHeld(data)) gx.effects.push(resumeEffect());
  for (;;) {
    data.turnIndex += 1;
    if (data.turnIndex >= data.turnQueue.length) {
      if (data.round >= ctx.settings.rounds) return finishGame(gx);
      data.round += 1;
      // Everyone seated by now plays the new round, late joiners included.
      data.roundPlayerIds = ctx.players.map((p) => p.id);
      data.turnQueue = [...data.roundPlayerIds];
      data.turnIndex = -1;
      continue;
    }
    const hangman = findPlayer(ctx, data.turnQueue[data.turnIndex]);
    if (!hangman || !hangman.connected) {
      if (hangman) systemMessage(gx, `${hangman.name} is away. Skipping their turn.`);
      data.turnQueue.splice(data.turnIndex, 1);
      data.turnIndex -= 1;
      continue;
    }
    return startChoosing(gx, hangman);
  }
}

function startChoosing(gx: Gx, hangman: PlatformPlayer): void {
  const { data, ctx } = gx;
  resetCanvas(gx);
  const pool = hangmanWordPool(ctx.settings.contentMode, ctx.settings.customWords, ctx.settings.customWordsOnly);
  data.turn = {
    hangmanId: hangman.id,
    choices: pickHangmanWords(pool, HANGMAN_WORD_CHOICES, data.usedWords, ctx.rng),
    word: '',
    usedLetters: [],
    wrongLetters: [],
    wrong: 0,
    guesserId: null,
    lastGuesserOrder: null,
    idleTimeouts: 0,
    out: [],
    points: {},
    outcome: null,
  };
  data.phase = { kind: 'choosing', clock: running(gx, HANGMAN_CHOOSE_SECONDS) };
  systemMessage(gx, `${hangman.name} is the hangman. Choosing a word…`);
  snapshot(gx);
}

export function chooseWord(gx: Gx, playerId: string, index: number): void {
  const { data } = gx;
  if (data.phase.kind !== 'choosing' || data.turn?.hangmanId !== playerId) return fail(gx, playerId, 'You are not choosing a word right now.');
  const word = data.turn.choices[index];
  if (word === undefined) return fail(gx, playerId, 'That is not one of your choices.');
  startGuessing(gx, word);
}

export function customWord(gx: Gx, playerId: string, text: string): void {
  const { data } = gx;
  if (data.phase.kind !== 'choosing' || data.turn?.hangmanId !== playerId) return fail(gx, playerId, 'You are not choosing a word right now.');
  const word = normalizeHangmanWord(text);
  if (!isValidHangmanWord(word)) {
    gx.effects.push({ type: 'error', playerId, code: 'INVALID_MESSAGE', message: 'A word or phrase has 3 to 24 letters: letters, spaces, hyphens and apostrophes only.' });
    return;
  }
  startGuessing(gx, word);
}

/** The choose clock ran out: the first choice it is. */
export function chooseTimedOut(gx: Gx): void {
  const turn = gx.data.turn;
  if (!turn || gx.data.phase.kind !== 'choosing') return;
  startGuessing(gx, turn.choices[0]);
}

function startGuessing(gx: Gx, word: string): void {
  const { data } = gx;
  const turn = data.turn;
  if (!turn) return;
  turn.word = word;
  if (!data.usedWords.includes(word)) data.usedWords.push(word);
  // A placeholder clock: nextGuesser starts the real one (or pauses it when no guesser is connected).
  data.phase = { kind: 'guessing', clock: running(gx, 0) };
  const letters = lettersOf(word).length;
  systemMessage(gx, `The word has ${letters} letters. Guess a letter or risk the whole word!`);
  nextGuesser(gx);
}

/** Guessers still in and connected, in join order. */
function eligibleGuessers(gx: Gx): PlatformPlayer[] {
  return guessersIn(gx.ctx, gx.data).filter((p) => p.connected);
}

/** The word was contested: a letter was guessed, or a life was lost (a wrong word, an idle lap). */
function contested(turn: TurnData): boolean {
  return turn.usedLetters.length > 0 || turn.wrong > 0;
}

/**
 * Hands the guess to the next connected guesser after the last one (join order, wrapping). With
 * guessers still in but none connected the clock pauses until one is back; with none left in
 * the hangman wins the word, unless nobody ever got to guess at it (then nobody scores it).
 */
export function nextGuesser(gx: Gx): void {
  const { data, ctx } = gx;
  const turn = data.turn;
  if (!turn || data.phase.kind !== 'guessing') return;
  const stillIn = guessersIn(ctx, data);
  if (stillIn.length === 0) return endTurn(gx, contested(turn) ? { kind: 'hangmanWins' } : { kind: 'noGuessers' });
  const eligible = eligibleGuessers(gx);
  if (eligible.length === 0) return pauseGuessing(gx, stillIn);
  const after = turn.lastGuesserOrder;
  const next = (after === null ? undefined : eligible.find((p) => p.joinOrder > after)) ?? eligible[0];
  if (data.phase.clock.kind === 'paused') gx.effects.push(resumeEffect());
  turn.guesserId = next.id;
  turn.lastGuesserOrder = next.joinOrder;
  data.phase.clock = running(gx, ctx.settings.guessSeconds);
  snapshot(gx);
}

function pauseGuessing(gx: Gx, missing: PlatformPlayer[]): void {
  const { data, ctx } = gx;
  const turn = data.turn;
  if (!turn || data.phase.kind !== 'guessing') return;
  const fresh = data.phase.clock.kind === 'running';
  turn.guesserId = null;
  data.phase.clock = { kind: 'paused', remainingMs: ctx.settings.guessSeconds * 1000 };
  gx.effects.push({ type: 'waiting', missing: missing.map((p) => p.id) });
  if (fresh) systemMessage(gx, `Waiting for ${missing.map((p) => p.name).join(', ')} to reconnect…`);
  snapshot(gx);
}

/**
 * The guess clock ran out: the turn passes, no penalty. Once every guesser in turn has let their
 * clock run out since the last guess (a whole idle lap), the lap counts as one wrong guess: the
 * hangman scores and draws a section, so a room that stops guessing still ends the word, and
 * with the figure, the hangman wins it rather than the word quietly going to waste.
 */
export function guessTimedOut(gx: Gx): void {
  const turn = gx.data.turn;
  if (!turn || gx.data.phase.kind !== 'guessing' || turn.guesserId === null) return;
  systemMessage(gx, `${nameOf(gx.ctx, turn.guesserId)} ran out of time.`);
  turn.idleTimeouts += 1;
  if (turn.idleTimeouts >= eligibleGuessers(gx).length) {
    turn.idleTimeouts = 0;
    gx.effects.push({ type: 'chat', to: 'all', kind: 'close', text: `Nobody guessed for a whole lap. That costs a life (${turn.wrong + 1} of ${HANGMAN_MAX_WRONG}).` });
    return startDrawing(gx);
  }
  nextGuesser(gx);
}

/**
 * A guesser left while the word was being chosen: with nobody of the round left to guess it, the
 * turn ends now rather than making the hangman choose a word for no one.
 */
export function guesserLeftWhileChoosing(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'choosing' || guessersIn(ctx, data).length > 0) return;
  endTurn(gx, { kind: 'noGuessers' });
}

/** A wrong guess: the hangman scores and draws the next section of the figure. */
export function startDrawing(gx: Gx): void {
  const { data, ctx } = gx;
  const turn = data.turn;
  if (!turn) return;
  turn.wrong += 1;
  turn.guesserId = null;
  award(gx, turn.hangmanId, HANGMAN_POINTS.wrongGuess);
  data.phase = { kind: 'drawing', section: turn.wrong, clock: running(gx, ctx.settings.drawSeconds) };
  const hangman = findPlayer(ctx, turn.hangmanId);
  if (hangman && !hangman.connected) pauseForHangman(gx, hangman);
  else snapshot(gx);
}

export function drawDone(gx: Gx, playerId: string): void {
  const { data } = gx;
  if (data.phase.kind !== 'drawing' || data.turn?.hangmanId !== playerId) return fail(gx, playerId, 'You are not drawing right now.');
  endDrawing(gx);
}

/** The section is done: a complete figure wins the word for the hangman, otherwise the next guesser is up. */
export function endDrawing(gx: Gx): void {
  const { data } = gx;
  const turn = data.turn;
  if (!turn || data.phase.kind !== 'drawing') return;
  if (turn.wrong >= HANGMAN_MAX_WRONG) return endTurn(gx, { kind: 'hangmanWins' });
  data.phase = { kind: 'guessing', clock: running(gx, 0) };
  nextGuesser(gx);
}

/** The hangman's socket dropped while the turn needs them: the clock holds until they are back. */
export function pauseForHangman(gx: Gx, hangman: PlatformPlayer): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'choosing' && data.phase.kind !== 'drawing') return;
  const { clock } = data.phase;
  if (clock.kind === 'running') data.phase.clock = { kind: 'paused', remainingMs: Math.max(0, clock.endsAt - ctx.now) };
  gx.effects.push({ type: 'waiting', missing: [hangman.id] });
  systemMessage(gx, `Waiting for ${hangman.name} to reconnect…`);
  snapshot(gx);
}

/** The hangman is back: their clock runs again from where it stopped. */
export function resumeForHangman(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'choosing' && data.phase.kind !== 'drawing') return;
  const { clock } = data.phase;
  if (clock.kind !== 'paused') return;
  data.phase.clock = { kind: 'running', endsAt: ctx.now + clock.remainingMs };
  gx.effects.push(resumeEffect());
  snapshot(gx);
}

export function endTurn(gx: Gx, outcome: HangmanOutcome): void {
  const { data, ctx } = gx;
  const turn = data.turn;
  if (!turn || data.phase.kind === 'turnEnd' || data.phase.kind === 'gameOver') return;
  const wasPaused = data.phase.clock.kind === 'paused';
  turn.outcome = outcome;
  turn.guesserId = null;
  const word = turn.word;
  switch (outcome.kind) {
    case 'solved':
      gx.effects.push({ type: 'chat', to: 'all', kind: 'correct', text: `${nameOf(ctx, outcome.solverId)} solved it! The word was ${word}.` });
      break;
    case 'hangmanWins':
      award(gx, turn.hangmanId, HANGMAN_POINTS.hangmanWins);
      systemMessage(gx, turn.wrong >= HANGMAN_MAX_WRONG ? `The figure is complete. ${nameOf(ctx, turn.hangmanId)} wins! The word was ${word}.` : `Nobody is left to guess. ${nameOf(ctx, turn.hangmanId)} wins! The word was ${word}.`);
      break;
    case 'hangmanLeft':
      // Points already scored this turn stay with the guessers; the word itself earns nobody anything.
      systemMessage(gx, word ? `The hangman left. The word was ${word}.` : 'The hangman left before choosing a word.');
      break;
    case 'noGuessers':
      systemMessage(gx, word ? `Nobody was left to guess. The word was ${word}.` : 'Nobody was left to guess.');
      break;
  }
  if (wasPaused) gx.effects.push(resumeEffect());
  data.phase = { kind: 'turnEnd', endsAt: ctx.now + HANGMAN_TURN_END_SECONDS * 1000, held: false, resumeAt: null };
  snapshot(gx);
}

function finishGame(gx: Gx): void {
  gx.data.phase = { kind: 'gameOver' };
  gx.effects.push({ type: 'gameOver' });
}

/**
 * Holds at the summary: the next turn starts once two players are connected again. Called again
 * while held whenever the player list changes, so the platform's missing list stays current; the
 * chat line goes out once.
 */
function holdTurnBoundary(gx: Gx): void {
  const { data, ctx } = gx;
  const fresh = !isHeld(data);
  if (data.phase.kind === 'turnEnd') {
    data.phase.held = true;
    data.phase.resumeAt = null;
  }
  gx.effects.push(...holdEffects(ctx.players, fresh));
}

/**
 * Re-evaluates a held boundary after the player list changed: the lobby or a refreshed hold while
 * too few are connected; otherwise a settle before the next turn, restarted by every further
 * reconnect, so a group whose sockets were all cut at once is seated together.
 */
export function resumeIfHeld(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'turnEnd' || !data.phase.held) return;
  if (ctx.players.length < MIN_PLAYERS || tooFewForNextTurn(gx)) return beginNextTurn(gx);
  data.phase.resumeAt = ctx.now + RESUME_SETTLE_MS;
  gx.effects.push(...holdEffects(ctx.players, false));
}

/** The settle ran out: the next turn with everyone connected by now, or a fresh hold if someone dropped again. */
export function settleDue(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase.kind !== 'turnEnd' || !data.phase.held || data.phase.resumeAt === null || ctx.now < data.phase.resumeAt) return;
  beginNextTurn(gx);
}
