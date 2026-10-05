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
import type { GameId } from './games.js';
import { CHAT_MAX_LENGTH, NAME_MAX_LENGTH, NAME_MIN_LENGTH } from './constants.js';
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
}

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export interface PodiumEntry {
  playerId: string;
  score: number;
  /** 1-based; tied scores share a rank. */
  rank: number;
}

/**
 * Snapshot for one recipient. `V` is the game's per-recipient view (null in the lobby) and `S`
 * the game's settings, which sit flat next to the platform settings.
 */
export interface RoomState<V = unknown, S = Record<string, unknown>> {
  code: string;
  gameId: GameId;
  hostId: string;
  settings: PlatformSettings & S;
  players: PlayerPublic[];
  phase: RoomPhase;
  /** Final standings once the game ended; null otherwise. */
  podium: PodiumEntry[] | null;
  game: V | null;
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
  | 'guessed' // a message only a subset sees (Skribble: players who already solved the word)
  | 'correct' // "Alice guessed the word!"
  | 'close' // a private nudge ("'aple' is close!")
  | 'hint'; // "The word was: apple"

export const CHAT_KINDS: readonly ChatKind[] = ['chat', 'system', 'guessed', 'correct', 'close', 'hint'];

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

export const gameIdSchema = z.enum(['skribble', 'spygame', 'template']);

export const platformClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('create'), gameId: gameIdSchema, name: nameSchema, avatar: avatarSchema }),
  z.object({ t: z.literal('join'), code: z.string().max(16), name: nameSchema, avatar: avatarSchema }),
  /** Resume a previous seat after a reload/disconnect using the token from `welcome`. */
  z.object({ t: z.literal('rejoin'), code: z.string().max(16), token: z.string().min(8).max(128) }),
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
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('chat'), text: z.string().min(1).max(CHAT_MAX_LENGTH) }),
  /** Host only. */
  z.object({ t: z.literal('kick'), playerId: z.string().max(64) }),
  /** Any player; a majority of the other connected players kicks. */
  z.object({ t: z.literal('voteKick'), playerId: z.string().max(64) }),
  /** Host only, once the game ended. */
  z.object({ t: z.literal('returnToLobby') }),
]);

export type PlatformClientMessage = z.infer<typeof platformClientMessageSchema>;
export type PlatformClientMessageOf<T extends PlatformClientMessage['t']> = Extract<PlatformClientMessage, { t: T }>;

export const PLATFORM_CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set(platformClientMessageSchema.options.map((o) => o.shape.t.value));

export function isPlatformMessageType(t: string): t is PlatformClientMessage['t'] {
  return PLATFORM_CLIENT_MESSAGE_TYPES.has(t);
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
  | 'GAME_IN_PROGRESS'
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
  /** Game bootstrap (Skribble: the canvas history). Absent for games without one. */
  extra?: unknown;
}

export type PlatformServerMessage<V = unknown, S = Record<string, unknown>> =
  /** Sent once after a successful create/join/rejoin. */
  | WelcomeMessage<V, S>
  /** Full per-recipient snapshot; replaces the client's room state wholesale. */
  | { t: 'room'; room: RoomState<V, S> }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'error'; code: ErrorCode; message: string }
  /** The recipient was removed from the room; the socket is closed afterwards. */
  | { t: 'kicked'; reason: string }
  | { t: 'pong'; serverTime: number };

export type PlatformServerMessageOf<T extends PlatformServerMessage['t']> = Extract<PlatformServerMessage, { t: T }>;

export const PLATFORM_SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set(['welcome', 'room', 'chat', 'error', 'kicked', 'pong']);

export function isPlatformServerMessage(x: unknown): x is PlatformServerMessage {
  return isWireMessage(x) && PLATFORM_SERVER_MESSAGE_TYPES.has(x.t);
}

export const WS_PATH = '/ws';

/** Close codes the server uses; 4xxx is the application range. */
export const CLOSE_REPLACED = 4001;
export const CLOSE_REMOVED = 4002;

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
