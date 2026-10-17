/**
 * The contract between the platform and a game. A game module is a pure reducer plus a view:
 * the platform owns seats, hosts, chat, kicks, reconnects, scores, the results and the clock;
 * the module decides what happens inside a running game.
 *
 * Type parameters: S = the game's settings, D = its JSON-safe state, V = its per-recipient
 * view, CMsg = its client messages, SMsg = its server messages.
 */
import type { z } from 'zod';
import type { GameMeta } from '../../shared/platform/games.js';
import type { ChatKind, RoomPhase } from '../../shared/platform/protocol.js';
import type { PlatformSettings } from '../../shared/platform/settings.js';
import type { MaybePromise } from './drivers/types.js';
import { deepEqual } from './json.js';
import type { GameStorage } from './storage.js';

/** What a game may know about a seated player. Names and scores are the platform's; per-game state lives in D. */
export interface PlatformPlayer {
  id: string;
  name: string;
  joinOrder: number;
  /**
   * The seat's socket is up. A socket that dropped only moments ago still counts (the game hears
   * of the drop AWAY_NOTICE_MS later, with 'playerDisconnected'), so a blink never costs a turn.
   */
  connected: boolean;
  /**
   * Connected, but the phone has sent nothing for IDLE_AFTER_MS (asleep, frozen, in the
   * background). The platform tells the game nothing more: a game may let the others act for an
   * idle player it is waiting on. Absent means false.
   */
  idle?: boolean;
  score: number;
}

/**
 * A seated player who watches this game: they sat it out, did not ready up, or joined while it was
 * running. In the room, never in the game; they play from the next game on.
 */
export interface PlatformSpectator {
  id: string;
  name: string;
  connected: boolean;
}

/** Identity and randomness are injected so the reducer is deterministic. */
export interface GameCtx<S> {
  /** Epoch ms: the real clock, or the deadline being processed while a tick catches up. */
  now: number;
  /** Uniform in [0, 1). */
  rng: () => number;
  /** Fresh unique id. */
  newId: () => string;
  /** The game's settings, flat next to the platform's (contentMode picks the content packs). */
  settings: RoomSettings<S>;
  /** Every participating seated player (connected or in reconnect grace), in join order. */
  players: PlatformPlayer[];
  /**
   * The other seated players: spectators who sat this game out or joined mid-game. They get
   * snapshots and chat but never play, and the set of participants never grows while a game runs.
   */
  spectators: PlatformSpectator[];
  hostId: string;
}

export interface GameViewCtx<S> {
  settings: RoomSettings<S>;
  players: PlatformPlayer[];
  spectators: PlatformSpectator[];
  hostId: string;
  now: number;
}

export type GameEvent<CMsg> =
  /** A validated game message from a seated, connected player (only while the room is 'playing'). */
  | { type: 'message'; playerId: string; msg: CMsg }
  /** A chat line; the game may consume it (a guess) by returning a 'chatHandled' effect. */
  | { type: 'chat'; playerId: string; text: string }
  /**
   * The player left, was kicked or their reconnect grace ran out (ctx.players no longer includes
   * them). Not delivered when the removal left fewer seats than `meta.minPlayers`: the platform
   * abandoned the game first.
   */
  | { type: 'playerLeft'; playerId: string }
  /**
   * A socket dropped / a disconnected player rejoined. The seat (and score) survives for
   * RECONNECT_GRACE_MS, and the platform never abandons a game over a disconnect alone: a game
   * that cannot go on without the player holds at its next boundary (see the 'waiting' effect).
   * A drop is reported AWAY_NOTICE_MS after it happens, and not at all when the player is back
   * by then (nor is that return reported).
   */
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
  /** The game is over: the platform ranks the players and takes the room back to the lobby with the results. */
  | { type: 'gameOver' }
  /**
   * The game cannot go on (too few players): the platform ranks the players on the scores so far
   * and takes the room back to the lobby, where the results say why (`reason`, a short line).
   */
  | { type: 'abort'; reason: string }
  /**
   * The game is holding at a boundary until the players in `missing` (seated, disconnected) come
   * back; the platform shows it as RoomState.waiting. Emit it again when the list changes and
   * `null` when the game goes on; abort, gameOver and the lobby clear it by themselves. `until`
   * (epoch ms): when the game stops waiting and goes on without them (shown as a countdown).
   */
  | { type: 'waiting'; missing: string[] | null; until?: number }
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
  /**
   * Message types (`msg.t`) the host may send even while sitting the game out, such as "next
   * round" or "end game". A spectator's other messages never reach `handle`.
   */
  hostMessages?: ReadonlySet<string>;
  /**
   * The game seats at most `meta.maxPlayers` at once by itself and queues the rest in join order
   * (they watch until a seat frees up). The platform then makes every ready player a participant
   * at the start instead of benching the extras, so the queue is fair to the earliest.
   */
  queuesSeats?: boolean;
  /**
   * Whether a participant goes in the results. A game that queues seats leaves off a player it
   * never dealt in (they would rank last having never played). Everyone by default.
   */
  ranks?(data: D, playerId: string): boolean;
  /**
   * The host's End game (the platform's `endGame`, host only, while playing). Emit the last score
   * effects and `gameOver` to end at once, or note it and end at the game's own next boundary
   * (Blackjack finishes the hand in play; RoomState.endRequested shows it meanwhile). Without
   * it the platform ends the game at once on the scores as they stand.
   */
  end?(ctx: GameCtx<S>, data: D): GameResult<D, SMsg>;
  /**
   * Where the game stands, as a short key (its phase, round, turn or hand). The platform sends
   * the phones a fresh room checkpoint at once when it changes, rather than within a few seconds.
   */
  milestone?(data: D): string;
  /**
   * The room was rebuilt from a checkpoint after a server restart. Every epoch-ms time in `data`
   * (any number within 30 days of the checkpoint) has already moved on by the downtime, and the
   * side store is empty: a game whose side store held part of the state restarts that part here
   * (Scribble restarts the turn in progress). Without it the game carries on as it was.
   */
  restored?(ctx: GameCtx<S>, data: D): GameResult<D, SMsg>;
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
// Side stores (advanced path, Scribble's canvas today)
// ---------------------------------------------------------------------------

/** What the room looks like to a side store: the platform's record with the game's data inside. */
export interface SideRoom<D> {
  code: string;
  phase: RoomPhase;
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
 * data (Scribble: the canvas id) so writes authorised against stale data are refused.
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
