/** Quip Game's JSON-safe state (the module's `D`), its working context and the small queries over it. */
import { QUIPGAME_REGULAR_ROUNDS, type QuipgameChoice, type QuipgameOutcome, type QuipgamePhase, type QuipgameServerMessage, type QuipgameSettings } from '../../../shared/games/quipgame/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import type { GameCtx, GameEffect, PlatformPlayer } from '../../platform/game.js';

export interface PromptData {
  id: string;
  text: string;
  /** The players who answer this prompt: two in a regular round, everyone in the final. Secret until the result. */
  authorIds: string[];
}

export interface AnswerData {
  id: string;
  promptId: string;
  authorId: string;
  /** Kept from the round so the result can name an author who has since left. */
  authorName: string;
  text: string;
  /** Filled in at the deadline from FALLBACK_ANSWERS. */
  fallback: boolean;
}

export interface MatchupResultData {
  votes: { a: number; b: number };
  points: { a: number; b: number };
  flawless: QuipgameChoice | null;
  outcome: QuipgameOutcome;
}

export interface MatchupData {
  promptId: string;
  /** The two answers in display order: [A, B], shuffled once so every recipient sees the same labels. */
  answerIds: [string, string];
  /** Votes by voter id; who may still vote is computed from the seated players at check time. */
  votes: Record<string, QuipgameChoice>;
  announcerId: string | null;
  result: MatchupResultData | null;
}

export interface FinalResultData {
  answerId: string;
  points: number;
  rank: number;
}

export interface FinalData {
  /** Answer ids in the shared shuffled order everyone ranks from. */
  order: string[];
  /** Picks by voter id, favourite first. */
  rankings: Record<string, string[]>;
  announcerId: string | null;
  result: FinalResultData[] | null;
}

export interface QuipgameData {
  /**
   * 'waiting': holding between rounds because fewer than three players are connected while
   * enough still hold seats (the last result stays up under RoomState.waiting). 'over' once the
   * last result ended and the platform took over with the podium.
   */
  phase: QuipgamePhase | 'waiting' | 'over';
  /** While 'waiting' with enough players connected again: when the next round starts (the settle); null otherwise. */
  resumeAt: number | null;
  /** 1-based current round (0 before the first starts); the final is round QUIPGAME_REGULAR_ROUNDS + 1 when enabled. */
  round: number;
  totalRounds: number;
  /** Players seated and connected when the round started, in join order; everyone else spectates until the next round. */
  roundPlayers: string[];
  prompts: PromptData[];
  answers: AnswerData[];
  matchups: MatchupData[];
  matchupIndex: number;
  /** Epoch ms when the current phase ends on its own. */
  endsAt: number;
  /** Lower-cased prompt texts already used this game. */
  usedPrompts: string[];
  /** Position in join order the next announcer search starts from. */
  announcerCursor: number;
  final: FinalData | null;
}

export type Ctx = GameCtx<QuipgameSettings>;
export type Effect = GameEffect<QuipgameServerMessage>;

/** The module's working context: a private copy of the state plus the effects produced so far. */
export interface Gx {
  ctx: Ctx;
  data: QuipgameData;
  effects: Effect[];
}

export const MIN_PLAYERS = gameById('quipgame').minPlayers;

export function findPlayer(players: PlatformPlayer[], id: string): PlatformPlayer | undefined {
  return players.find((p) => p.id === id);
}

export function nameOf(ctx: Ctx, id: string): string {
  return findPlayer(ctx.players, id)?.name ?? 'Someone';
}

export function connectedCount(ctx: Ctx): number {
  return ctx.players.filter((p) => p.connected).length;
}

export function isFinalRound(data: QuipgameData): boolean {
  return data.round > QUIPGAME_REGULAR_ROUNDS;
}

/** Points multiplier of a regular round: 1 in round one, 2 in round two. */
export function multiplierFor(data: QuipgameData): number {
  return Math.min(data.round, QUIPGAME_REGULAR_ROUNDS);
}

export function currentMatchup(data: QuipgameData): MatchupData | undefined {
  return data.matchups[data.matchupIndex];
}

export function answerById(data: QuipgameData, id: string): AnswerData | undefined {
  return data.answers.find((a) => a.id === id);
}

export function answerFor(data: QuipgameData, promptId: string, authorId: string): AnswerData | undefined {
  return data.answers.find((a) => a.promptId === promptId && a.authorId === authorId);
}

export function promptById(data: QuipgameData, id: string): PromptData | undefined {
  return data.prompts.find((p) => p.id === id);
}

/** The two authors of a matchup, in A/B order. */
export function matchupAuthors(data: QuipgameData, m: MatchupData): string[] {
  return m.answerIds.map((id) => answerById(data, id)?.authorId ?? '');
}

/** Uniform pick from a non-empty list. */
export function pickOne<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/** Fisher-Yates over a copy. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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

/** Adds to a seated author's score; points for someone who left stay in the result view only. */
export function award(gx: Gx, playerId: string, delta: number): void {
  if (delta > 0 && findPlayer(gx.ctx.players, playerId)) gx.effects.push({ type: 'score', playerId, delta });
}

/**
 * The next announcer: the first connected player after the cursor (join order) who is not among
 * `exclude`; the cursor moves past them so the job rotates. Null when nobody qualifies.
 */
export function pickAnnouncer(gx: Gx, exclude: string[]): string | null {
  const { data, ctx } = gx;
  const n = ctx.players.length;
  for (let step = 0; step < n; step++) {
    const i = (data.announcerCursor + step) % n;
    const p = ctx.players[i];
    if (p.connected && !exclude.includes(p.id)) {
      data.announcerCursor = (i + 1) % n;
      return p.id;
    }
  }
  return null;
}
