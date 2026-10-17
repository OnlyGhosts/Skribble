/**
 * Platform wire protocol between client and server: JSON messages over a single WebSocket (`/ws`).
 * Everything here is game-agnostic. A game adds its own client and server messages (validated with
 * its module's schema) and its own view inside `RoomState.game`.
 *
 * State sync model: the server pushes a full per-recipient `RoomState` snapshot (`{t:'room'}`)
 * whenever something visible changes. Chat and game streams (such as drawing) are incremental.
 * On (re)join the client receives `welcome` with the snapshot, recent chat and the game's bootstrap.
 */
import { z } from 'zod';
import { avatarSchema, type Avatar } from './avatar.js';
import { upgradeGameId, type GameId } from './games.js';
import { CHAT_MAX_LENGTH, CHECKPOINT_MAX_CHARS, NAME_MAX_LENGTH, NAME_MIN_LENGTH } from './constants.js';
import type { PlatformSettings } from './settings.js';

export const nameSchema = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(NAME_MIN_LENGTH).max(NAME_MAX_LENGTH));

// ---------------------------------------------------------------------------
// Room state (server → client snapshot)
// ---------------------------------------------------------------------------

export interface PlayerPublic {
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  isHost: boolean;
  /** False while the player is disconnected but still within the reconnect grace period. */
  connected: boolean;
  /** Seat order (0-based, never reused within a room); games use it as their turn order. */
  joinOrder: number;
  /** Lobby only: the player has readied up for the next game. */
  ready: boolean;
  /** The player chose to sit the next game out; they stay in the party as a spectator. */
  sittingOut: boolean;
  /** True while this player is in the running game (ready, not sitting out, within the game's seat limit). A mid-game joiner watches. */
  participating: boolean;
  /** Connected, but the phone has sent nothing for IDLE_AFTER_MS: it is asleep, frozen or in the background. */
  idle?: boolean;
}

/** A room is in its lobby between games and 'playing' while one runs; a finished game goes straight back to the lobby. */
export type RoomPhase = 'lobby' | 'playing';

/** One player's line in a finished game's standings, kept whole so it reads right after they leave. */
export interface ResultEntry {
  playerId: string;
  name: string;
  avatar: Avatar;
  score: number;
  /** 1-based; tied scores share a rank. */
  rank: number;
}

/** How a game came to an end: on its own, by the host's End game, or with too few players left. */
export type GameEndReason = 'finished' | 'host' | 'players';

/**
 * The final standings of the last game, carried by the lobby until the next game starts, so a
 * phone that missed the moment (a reload, a reconnect, a late tab) can still show them once.
 */
export interface GameResults {
  /** Unique per finished game: a phone shows each one once. */
  id: string;
  gameId: GameId;
  reason: GameEndReason;
  /** Best first; spectators are not ranked. */
  entries: ResultEntry[];
}

/**
 * Snapshot for one recipient. `V` is the game's per-recipient view (null in the lobby) and `S`
 * the game's settings, which sit flat next to the platform settings.
 */
/**
 * A running game is holding at a boundary (next round / next turn) because too few players are
 * connected, while enough still hold seats within the reconnect grace. The game resumes by itself
 * when enough of them come back; the host may remove the missing players instead.
 */
export interface WaitingState {
  reason: 'players';
  /** Seated players currently disconnected whose return would let the game continue. */
  missing: string[];
  /** Connected players required to continue. */
  needed: number;
  connected: number;
  /** Server epoch ms when the game stops waiting and goes on without them; absent when it waits until they are back or removed. */
  until?: number;
}

export interface RoomState<V = unknown, S = Record<string, unknown>> {
  code: string;
  gameId: GameId;
  hostId: string;
  settings: PlatformSettings & S;
  players: PlayerPublic[];
  phase: RoomPhase;
  /** The last game's final standings, in the lobby until the next game starts; null otherwise. */
  results: GameResults | null;
  /** The host asked to end the running game and it is finishing its hand in play (Blackjack). */
  endRequested: boolean;
  game: V | null;
  /** Set while the game is paused waiting for disconnected players; null otherwise. */
  waiting?: WaitingState | null;
  /** Server epoch ms when this snapshot was produced; clients use it to compute a clock offset. */
  serverTime: number;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** Every chat line kind the platform knows how to render; games may use any of them. */
export type ChatKind =
  | 'chat' // a player's message
  | 'system' // joins, leaves, host changes, kicks, game announcements
  | 'guessed' // a message only a subset sees (Scribble: players who already solved the word)
  | 'correct' // "Alice guessed the word!"
  | 'close' // a private nudge ("'aple' is close!")
  | 'hint' // "The word was: apple"
  | 'notice'; // an event the screen does not show otherwise ("Ann is now the host"); the client toasts it

export const CHAT_KINDS: readonly ChatKind[] = ['chat', 'system', 'guessed', 'correct', 'close', 'hint', 'notice'];

export interface ChatMessage {
  id: number;
  kind: ChatKind;
  playerId?: string;
  name?: string;
  text: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// Client → Server (platform messages)
// ---------------------------------------------------------------------------

/**
 * A game id on the wire. A former id (from before a rename, such as Scribble's 'skribble', sent by a
 * client loaded before the deploy) parses as the current one.
 */
export const gameIdSchema = z.preprocess(
  (v) => (typeof v === 'string' ? (upgradeGameId(v) ?? v) : v),
  z.enum(['scribble', 'spygame', 'quipgame', 'blackjack', 'poker', 'template']),
);

export const platformClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('create'), gameId: gameIdSchema, name: nameSchema, avatar: avatarSchema }),
  z.object({ t: z.literal('join'), code: z.string().max(16), name: nameSchema, avatar: avatarSchema }),
  /** Resume a previous seat after a reload/disconnect using the token from `welcome`. */
  z.object({ t: z.literal('rejoin'), code: z.string().max(16), token: z.string().min(8).max(128) }),
  /**
   * After a rejoin failed with `roomGone` (a server restart lost the room): bring the room back
   * from the newest checkpoint this phone holds, then rejoin its seat. Answered like a rejoin.
   */
  z.object({ t: z.literal('restore'), code: z.string().max(16), token: z.string().min(8).max(128), checkpoint: z.string().min(1).max(CHECKPOINT_MAX_CHARS) }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('ping') }),
  /**
   * Host only, lobby only. One flat patch of platform and game fields; the server validates it
   * against the platform patch schema merged with the room's game settings schema.
   */
  z.object({ t: z.literal('updateSettings'), settings: z.record(z.string(), z.unknown()) }),
  /** Lobby only. */
  z.object({ t: z.literal('updateProfile'), name: nameSchema.optional(), avatar: avatarSchema.optional() }),
  /** Host only, lobby only, needs the game's minPlayers connected. */
  /** Host only, lobby only: switch the party to another game (game settings reset to that game's defaults). */
  z.object({ t: z.literal('selectGame'), gameId: gameIdSchema }),
  /** Lobby only. */
  z.object({ t: z.literal('ready'), ready: z.boolean() }),
  /** Lobby only: sit the next game out (or come back in). */
  z.object({ t: z.literal('sitOut'), sitOut: z.boolean() }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('chat'), text: z.string().min(1).max(CHAT_MAX_LENGTH) }),
  /** Host only. */
  z.object({ t: z.literal('kick'), playerId: z.string().max(64) }),
  /** Any player; a majority of the other connected players kicks. */
  z.object({ t: z.literal('voteKick'), playerId: z.string().max(64) }),
  /**
   * Host only, while a game runs: end it for everyone. The game ends at once, or at its own next
   * boundary (Blackjack finishes the hand in play), and everyone gets the results in the lobby.
   */
  z.object({ t: z.literal('endGame') }),
]);

export type PlatformClientMessage = z.infer<typeof platformClientMessageSchema>;
export type PlatformClientMessageOf<T extends PlatformClientMessage['t']> = Extract<PlatformClientMessage, { t: T }>;

export const PLATFORM_CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set(platformClientMessageSchema.options.map((o) => o.shape.t.value));

export function isPlatformMessageType(t: string): t is PlatformClientMessage['t'] {
  return PLATFORM_CLIENT_MESSAGE_TYPES.has(t);
}

/**
 * Every room message (platform or game) may carry a client sequence number under this key: a
 * positive integer that grows with each message the seat sends. The room applies a message only
 * when its number is above the last one it applied for the seat, so a message resent after a
 * reconnect is never applied twice. Messages without one are always applied.
 */
export const CLIENT_SEQ_KEY = 'cs';

/** The client sequence number a raw message carries, or undefined when it has none (or a bad one). */
export function clientSeqOf(msg: WireMessage): number | undefined {
  const cs = msg[CLIENT_SEQ_KEY];
  return typeof cs === 'number' && Number.isSafeInteger(cs) && cs > 0 ? cs : undefined;
}

/** Any wire message: an object with a string discriminator. Game messages are validated by the game. */
export interface WireMessage {
  t: string;
  [field: string]: unknown;
}

export function isWireMessage(x: unknown): x is WireMessage {
  return typeof x === 'object' && x !== null && typeof (x as { t?: unknown }).t === 'string';
}

// ---------------------------------------------------------------------------
// Server → Client (platform messages)
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'INVALID_CODE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'REJOIN_FAILED'
  | 'INVALID_MESSAGE'
  | 'NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface WelcomeMessage<V = unknown, S = Record<string, unknown>> {
  t: 'welcome';
  playerId: string;
  token: string;
  room: RoomState<V, S>;
  chat: ChatMessage[];
  /** Game bootstrap (Scribble: the canvas history). Absent for games without one. */
  extra?: unknown;
  /**
   * The highest client sequence number (`cs`) the room has applied for this seat: a client that
   * kept unconfirmed messages through an outage resends only the ones above it.
   */
  seq?: number;
}

export type PlatformServerMessage<V = unknown, S = Record<string, unknown>> =
  /** Sent once after a successful create/join/rejoin. */
  | WelcomeMessage<V, S>
  /** Full per-recipient snapshot; replaces the client's room state wholesale. */
  | { t: 'room'; room: RoomState<V, S> }
  | { t: 'chat'; message: ChatMessage }
  /**
   * `roomGone` is set on a REJOIN_FAILED when no live room has the code (a server restart lost
   * it): a phone holding a checkpoint for the room sends `restore`, one without retries quietly
   * for RESTORE_RETRY_MS, since another phone may be bringing the room back.
   */
  | { t: 'error'; code: ErrorCode; message: string; roomGone?: true }
  /**
   * The room as the server can rebuild it after a restart: sealed and opaque to the client, which
   * keeps the newest one with its seat and sends it back in `restore`. Sent to a few phones per room.
   * `null`: this phone no longer gets them, so it drops the one it holds (an old copy must not
   * bring back a room that has moved on).
   */
  | { t: 'checkpoint'; checkpoint: string | null }
  /** The recipient was removed from the room; the socket is closed afterwards. */
  | { t: 'kicked'; reason: string }
  | { t: 'pong'; serverTime: number };

export type PlatformServerMessageOf<T extends PlatformServerMessage['t']> = Extract<PlatformServerMessage, { t: T }>;

export const PLATFORM_SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set(['welcome', 'room', 'chat', 'error', 'checkpoint', 'kicked', 'pong']);

export function isPlatformServerMessage(x: unknown): x is PlatformServerMessage {
  return isWireMessage(x) && PLATFORM_SERVER_MESSAGE_TYPES.has(x.t);
}

export const WS_PATH = '/ws';

/** Close codes the server uses; 4xxx is the application range. */
export const CLOSE_REPLACED = 4001;
export const CLOSE_REMOVED = 4002;
/**
 * The server is restarting (a deploy): it sent fresh checkpoints first, and the game carries on once
 * it is back. The standard Service Restart code, which pages from before checkpoints already read
 * as the server going away.
 */
export const CLOSE_RESTARTING = 1012;

/** GET /api/rooms/:code — previews a code before joining and resolves which game it belongs to. Always HTTP 200. */
export const ROOM_PREVIEW_PATH = '/api/rooms';

export type RoomPreview =
  | { exists: false; code: string; reason: 'INVALID_CODE' | 'ROOM_NOT_FOUND' }
  | { exists: true; code: string; gameId: GameId; players: number; maxPlayers: number; inProgress: boolean; joinable: boolean };

/** Session storage key under which the client remembers its seat for reconnects. */
export const SESSION_STORAGE_KEY = 'boredgames.session';

export interface StoredSession {
  code: string;
  gameId: GameId;
  token: string;
  playerId: string;
}
