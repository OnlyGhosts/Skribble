/** The Spy Game's JSON-safe state (the module's `D`), its working context and the small queries over it. */
import type { SpygameOutcome, SpygameServerMessage, SpygameSettings } from '../../../shared/games/spygame/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import type { GameCtx, GameEffect, PlatformPlayer } from '../../platform/game.js';

/** The round clock: counting down to `endsAt`, or holding `remainingMs` while a vote runs or the spy is away. */
export type ClockData = { kind: 'running'; endsAt: number } | { kind: 'paused'; remainingMs: number };

export interface RoundData {
  spyId: string;
  locationId: string;
  /** SPYGAME_CANDIDATES location ids in the order everyone sees them. */
  candidates: string[];
  /** Players seated and connected when the round started; everyone else spectates until the next round. */
  playerIds: string[];
  guessesLeft: number;
  /** The spy's wrong guesses so far. */
  guessed: string[];
  /** Players who already started a vote this round. */
  accusers: string[];
  clock: ClockData;
  /** The spy's socket is down: the clock stays paused until they rejoin. */
  spyAway: boolean;
}

export interface VoteData {
  accuserId: string;
  accusedId: string;
  /** Round agents except the accused; the accuser is in here and pre-counted as Yes. */
  eligible: string[];
  votes: Record<string, boolean>;
  endsAt: number;
}

export interface RevealData {
  outcome: SpygameOutcome;
  spyId: string;
  locationId: string;
  points: Record<string, number>;
  endsAt: number;
}

export interface SpygameData {
  /** 'over' once the last reveal ended and the platform took over with the podium. */
  phase: 'playing' | 'voting' | 'reveal' | 'over';
  /** 1-based current round. */
  round: number;
  current: RoundData;
  vote: VoteData | null;
  reveal: RevealData | null;
  /** Players who have been the spy in the current rotation; cleared once everyone had a turn. */
  spyHistory: string[];
  usedLocationIds: string[];
}

export type Ctx = GameCtx<SpygameSettings>;
export type Effect = GameEffect<SpygameServerMessage>;

/** The module's working context: a private copy of the state plus the effects produced so far. */
export interface Gx {
  ctx: Ctx;
  data: SpygameData;
  effects: Effect[];
}

export const MIN_PLAYERS = gameById('spygame').minPlayers;

export function findPlayer(ctx: Ctx, id: string): PlatformPlayer | undefined {
  return ctx.players.find((p) => p.id === id);
}

export function nameOf(ctx: Ctx, id: string): string {
  return findPlayer(ctx, id)?.name ?? 'Someone';
}

export function connectedCount(ctx: Ctx): number {
  return ctx.players.filter((p) => p.connected).length;
}

export function isRoundPlayer(data: SpygameData, id: string): boolean {
  return data.current.playerIds.includes(id);
}

/** The round's players other than the spy. */
export function agentIds(data: SpygameData): string[] {
  return data.current.playerIds.filter((id) => id !== data.current.spyId);
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
