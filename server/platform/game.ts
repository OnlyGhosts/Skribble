/**
 * The contract between the platform and a game. A game module is a pure reducer plus a view:
 * the platform owns seats, hosts, chat, kicks, reconnects, scores, the podium and the clock;
 * the module decides what happens inside a running game.
 *
 * Type parameters: S = the game's settings, D = its JSON-safe state, V = its per-recipient
 * view, CMsg = its client messages, SMsg = its server messages.
 */
import type { z } from 'zod';
import type { GameMeta } from '../../shared/platform/games.js';
import type { ChatKind } from '../../shared/platform/protocol.js';
import type { PlatformSettings } from '../../shared/platform/settings.js';
import type { MaybePromise } from './drivers/types.js';
import { deepEqual } from './json.js';
import type { GameStorage } from './storage.js';

/** What a game may know about a seated player. Names and scores are the platform's; per-game state lives in D. */
export interface PlatformPlayer {
  id: string;
  name: string;
  joinOrder: number;
  connected: boolean;
  score: number;
}

/** Identity and randomness are injected so the reducer is deterministic. */
export interface GameCtx<S> {
  /** Epoch ms: the real clock, or the deadline being processed while a tick catches up. */
  now: number;
  /** Uniform in [0, 1). */
  rng: () => number;
  /** Fresh unique id. */
  newId: () => string;
  settings: S;
  /** Every seated player (connected or in reconnect grace), in join order. */
  players: PlatformPlayer[];
  hostId: string;
}

export interface GameViewCtx<S> {
  settings: S;
  players: PlatformPlayer[];
  hostId: string;
  now: number;
}

export type GameEvent<CMsg> =
  /** A validated game message from a seated, connected player (only while the room is 'playing'). */
  | { type: 'message'; playerId: string; msg: CMsg }
  /** A chat line; the game may consume it (a guess) by returning a 'chatHandled' effect. */
  | { type: 'chat'; playerId: string; text: string }
  /** A new player was seated mid-game (ctx.players already includes them). */
  | { type: 'playerJoined'; playerId: string }
  /** The player left, was kicked or their reconnect grace ran out (ctx.players no longer includes them). */
  | { type: 'playerLeft'; playerId: string }
  | { type: 'playerDisconnected'; playerId: string }
  | { type: 'playerReconnected'; playerId: string }
  /**
   * The earliest deadline from `nextDeadline` is due at ctx.now. Resolve it (and anything else
   * due); the platform calls again while deadlines remain, so one deadline per call is fine.
   */
  | { type: 'tick' };

/** 'all' and `except` mean the players connected once the action has been applied. */
export type Recipients = string[] | 'all' | { except: string[] };

export type GameEffect<SMsg> =
  | { type: 'send'; to: Recipients; msg: SMsg }
  /** Send every recipient a fresh room snapshot (rendered where this effect sits in the list). */
  | { type: 'snapshot'; to: Recipients }
  /** A chat line. Lines addressed to everyone are kept in the history for late joiners. */
  | { type: 'chat'; to: Recipients; kind: ChatKind; text: string; playerId?: string; name?: string }
  /** The triggering chat text was consumed (a guess): the platform does not broadcast it as a chat line. */
  | { type: 'chatHandled' }
  /** An error for one player (a refused move, say). */
  | { type: 'error'; playerId: string; code: 'NOT_ALLOWED' | 'INVALID_MESSAGE'; message: string }
  | { type: 'score'; playerId: string; delta: number }
  /** The game is over: the platform computes the podium and moves the room to 'ended'. */
  | { type: 'gameOver' }
  /** Abandon the game and return everyone to the lobby. */
  | { type: 'abort'; reason: string }
  /**
   * For games with a side store: 'reset' empties it and stamps it with `payload.stamp`
   * (see GameSideStore). Other names are reserved.
   */
  | { type: 'side'; name: 'reset'; payload?: { stamp: string } };

export interface GameResult<D, SMsg> {
  /** The same object as the input `data` when nothing changed. */
  data: D;
  effects: GameEffect<SMsg>[];
}

/** The part of a zod schema the platform uses (structural, so `schema.partial()` qualifies whatever its exact zod type). */
export interface Parser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

export interface GameSettingsSpec<S> {
  schema: z.ZodType<S>;
  /** `schema.partial()`: validates the game part of an updateSettings patch. */
  patchSchema: Parser<Partial<S>>;
  defaults: S;
  /** Fixes up invariants after a patch (e.g. dependent fields). */
  normalize?(s: S): S;
}

export interface GameServerModule<S = unknown, D = unknown, V = unknown, CMsg = unknown, SMsg = unknown> {
  meta: GameMeta;
  settings: GameSettingsSpec<S>;
  clientMessageSchema: z.ZodType<CMsg>;
  /** Called when the host starts the game. */
  start(ctx: GameCtx<S>): GameResult<D, SMsg>;
  /** PURE: never mutates `data`; returns the same object when nothing changed. */
  handle(ctx: GameCtx<S>, data: D, event: GameEvent<CMsg>): GameResult<D, SMsg>;
  /** Epoch ms at which the platform must deliver the next 'tick', or null. */
  nextDeadline(data: D): number | null;
  /** Per-recipient view; a null viewer is a spectator (HTTP previews, tests). */
  view(data: D, viewerId: string | null, ctx: GameViewCtx<S>): V;
  /**
   * Advanced: message types the driver hands to the side store instead of the reducer (high-rate
   * streams such as drawing). Requires `createSideStore`.
   */
  sideMessages?: ReadonlySet<string>;
  createSideStore?(storage: GameStorage): GameSideStore<D, CMsg, SMsg>;
}

/** The erased module type the registry and the engine work with. */
export type AnyGameServerModule = GameServerModule<unknown, unknown, unknown, unknown, unknown>;

/** Builds a settings spec from a zod object schema. */
export function defineSettings<S>(schema: z.ZodType<S> & { partial(): Parser<Partial<S>> }, defaults: S, normalize?: (s: S) => S): GameSettingsSpec<S> {
  const spec: GameSettingsSpec<S> = { schema, patchSchema: schema.partial(), defaults };
  if (normalize) spec.normalize = normalize;
  return spec;
}

/**
 * Helper for writing `handle` as mutations: `fn` edits a private copy of `data` and pushes
 * effects; the result carries the original object when nothing changed.
 */
export function withDraft<D, SMsg>(data: D, fn: (draft: D, effects: GameEffect<SMsg>[]) => void): GameResult<D, SMsg> {
  const draft = structuredClone(data);
  const effects: GameEffect<SMsg>[] = [];
  fn(draft, effects);
  return { data: deepEqual(draft, data) ? data : draft, effects };
}

// ---------------------------------------------------------------------------
// Side stores (advanced path, Skribble's canvas today)
// ---------------------------------------------------------------------------

/** What the room looks like to a side store: the platform's record with the game's data inside. */
export interface SideRoom<D> {
  code: string;
  phase: 'lobby' | 'playing' | 'ended';
  game: D | null;
  players: PlatformPlayer[];
}

export type SideOutcome<SMsg> =
  | {
      ok: true;
      /** Sequence number of the store change; 0 when nothing was stored (nothing to publish). */
      seq: number;
      sends: Array<{ to: Recipients; msg: SMsg }>;
      /** A player whose local copy drifted from the store (their input was cut by caps): resync them after a debounce. */
      resync?: string;
    }
  /** Refused; `message` (if any) is sent to the player as a NOT_ALLOWED error. */
  | { ok: false; message: string | null };

/**
 * A per-room store the driver consults for `sideMessages`, outside the reducer. It is built once
 * per driver over the platform's GameStorage, so one implementation serves memory and Redis.
 * Every change has a sequence number; the stamp ties the store to the game's current round of
 * data (Skribble: the canvas id) so writes authorised against stale data are refused.
 */
export interface GameSideStore<D, CMsg, SMsg> {
  /** The stamp the store must carry for `room`'s current game data ('' when none). */
  stamp(room: SideRoom<D>): string;
  handleMessage(room: SideRoom<D>, playerId: string, msg: CMsg, now: number): MaybePromise<SideOutcome<SMsg>>;
  /** The bootstrap for `welcome.extra` and the sequence number it is current to. */
  welcomeExtra(room: SideRoom<D>, playerId: string): MaybePromise<{ extra: unknown; seq: number }>;
  /** A full resync for a drifted player, or null when they no longer need one. */
  resync(room: SideRoom<D>, playerId: string, now: number): MaybePromise<{ msg: SMsg; seq: number } | null>;
}

export type AnyGameSideStore = GameSideStore<unknown, unknown, unknown>;

/** How long drifted side-store input is batched before the player gets a full resync. */
export const SIDE_RESYNC_DEBOUNCE_MS = 1000;

export function resolveRecipients(players: PlatformPlayer[], to: Recipients): string[] {
  if (Array.isArray(to)) return to;
  const excluded = to === 'all' ? [] : to.except;
  return players.filter((p) => p.connected && !excluded.includes(p.id)).map((p) => p.id);
}

/** Type helper for the flat settings of a room running game S. */
export type RoomSettings<S> = PlatformSettings & S;
