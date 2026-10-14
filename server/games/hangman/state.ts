/** Hangman's JSON-safe game state (the module's `D`), its working context and the queries over it. */
import type { HangmanOutcome, HangmanServerMessage, HangmanSettings } from '../../../shared/games/hangman/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import type { GameCtx, GameEffect, PlatformPlayer } from '../../platform/game.js';

/** A phase clock: counting down to `endsAt`, or holding `remainingMs` while someone it needs is away. */
export type Clock = { kind: 'running'; endsAt: number } | { kind: 'paused'; remainingMs: number };

export type PhaseData =
  | { kind: 'choosing'; clock: Clock }
  /** `clock` is paused (and turn.guesserId null) while no guesser is connected. */
  | { kind: 'guessing'; clock: Clock }
  | { kind: 'drawing'; section: number; clock: Clock }
  | {
      kind: 'turnEnd';
      endsAt: number;
      /** True while the next turn waits for disconnected players (endsAt no longer fires). */
      held: boolean;
      /** While held with enough players back: when the next turn starts (the settle). */
      resumeAt: number | null;
    }
  | { kind: 'gameOver' };

export interface TurnData {
  hangmanId: string;
  choices: string[];
  /** Upper case; '' until the hangman picked or typed one. */
  word: string;
  /** Every letter guessed so far, right and wrong, in order. */
  usedLetters: string[];
  wrongLetters: string[];
  /** Wrong guesses, wrong words included; also the number of figure sections drawn or being drawn. */
  wrong: number;
  guesserId: string | null;
  /**
   * Where the rotation continues from: the join order of the last player who had a guess (kept as
   * a number so the rotation goes on in order even once that player has left the room).
   */
  lastGuesserOrder: number | null;
  /** Guess clocks that ran out since the last guess: a whole lap of them costs a life (see guessTimedOut). */
  idleTimeouts: number;
  /** Guessers who named a wrong word: out until the next word. */
  out: string[];
  /** Points earned this turn by player id. */
  points: Record<string, number>;
  outcome: HangmanOutcome | null;
}

export interface HangmanData {
  phase: PhaseData;
  turn: TurnData | null;
  /** Identifies the current canvas (the side store's stamp): fresh on every turn. */
  canvasId: string;
  /** 1-based current round. */
  round: number;
  /** Participants seated when the round began, in join order; later joiners watch until the next round. */
  roundPlayerIds: string[];
  /** Who is the hangman this round, in order. Skipped hangmen are removed so turn counts stay accurate. */
  turnQueue: string[];
  turnIndex: number;
  /** Words already played this game (upper case). */
  usedWords: string[];
}

export type Ctx = GameCtx<HangmanSettings>;
export type Effect = GameEffect<HangmanServerMessage>;

/** The module's working context: a private copy of the state plus the effects produced so far. */
export interface Gx {
  ctx: Ctx;
  data: HangmanData;
  effects: Effect[];
}

export const MIN_PLAYERS = gameById('hangman').minPlayers;

export function findPlayer(ctx: Ctx, id: string): PlatformPlayer | undefined {
  return ctx.players.find((p) => p.id === id);
}

export function nameOf(ctx: Ctx, id: string): string {
  return findPlayer(ctx, id)?.name ?? 'Someone';
}

/** How many of the players with the given ids have a socket up. */
export function connectedAmong(ctx: Ctx, ids: readonly string[]): number {
  return ctx.players.filter((p) => p.connected && ids.includes(p.id)).length;
}

export function isHangman(data: HangmanData, playerId: string): boolean {
  return data.turn !== null && data.turn.hangmanId === playerId;
}

export function isHeld(data: HangmanData): boolean {
  return data.phase.kind === 'turnEnd' && data.phase.held;
}

/** The turn is live: a word is being chosen, guessed or drawn for. */
export function inTurn(data: HangmanData): boolean {
  return data.phase.kind === 'choosing' || data.phase.kind === 'guessing' || data.phase.kind === 'drawing';
}

/** Guessers still in for this word (connected or not), in join order: the round's players except the hangman and those out. */
export function guessersIn(ctx: Ctx, data: HangmanData): PlatformPlayer[] {
  const turn = data.turn;
  if (!turn) return [];
  return ctx.players.filter((p) => data.roundPlayerIds.includes(p.id) && p.id !== turn.hangmanId && !turn.out.includes(p.id));
}

export function systemMessage(gx: Gx, text: string): void {
  gx.effects.push({ type: 'chat', to: 'all', kind: 'system', text });
}

export function snapshot(gx: Gx): void {
  gx.effects.push({ type: 'snapshot', to: 'all' });
}

export function fail(gx: Gx, playerId: string, message: string): void {
  gx.effects.push({ type: 'error', playerId, code: 'NOT_ALLOWED', message });
}

export function award(gx: Gx, playerId: string, delta: number): void {
  if (delta <= 0 || !gx.data.turn) return;
  gx.effects.push({ type: 'score', playerId, delta });
  gx.data.turn.points[playerId] = (gx.data.turn.points[playerId] ?? 0) + delta;
}

export const NOT_HANGMAN_MESSAGE = 'Only the hangman can draw right now.';

/** The hangman may draw during the drawing step, until its deadline (even if no tick has ended it yet). */
export function canDraw(data: HangmanData, playerId: string, now: number): boolean {
  return data.phase.kind === 'drawing' && data.phase.clock.kind === 'running' && isHangman(data, playerId) && now < data.phase.clock.endsAt;
}

/**
 * Whether a canvas op from `playerId` is accepted. Ops the hangman had in flight when the step
 * ended are expected ('silent'); only somebody else drawing gets an error ('forbidden').
 */
export function drawCheck(data: HangmanData, playerId: string, now: number): 'ok' | 'silent' | 'forbidden' {
  if (canDraw(data, playerId, now)) return 'ok';
  return isHangman(data, playerId) ? 'silent' : 'forbidden';
}
