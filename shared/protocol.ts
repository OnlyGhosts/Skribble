/**
 * Wire protocol between client and server. JSON messages over a single WebSocket (`/ws`).
 *
 * - Client → server messages are validated with `clientMessageSchema` (zod) on the server.
 * - Server → client messages are plain typed objects (`ServerMessage`).
 *
 * State sync model: the server pushes a full per-recipient `RoomState` snapshot (`{t:'room'}`)
 * whenever anything but drawing/chat changes (players, settings, phase, scores, hints, ratings).
 * Drawing (`draw`/`undo`/`clear`) and chat are incremental. On (re)join the client receives
 * `welcome` with the snapshot, the full canvas history and recent chat.
 */
import { z } from 'zod';
import { avatarSchema, type Avatar } from './avatar';
import { roomSettingsPatchSchema, type RoomSettings } from './settings';
import { CHAT_MAX_LENGTH, NAME_MAX_LENGTH, NAME_MIN_LENGTH } from './constants';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');

export const nameSchema = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(NAME_MIN_LENGTH).max(NAME_MAX_LENGTH));

export const toolSchema = z.enum(['brush', 'eraser']);
export type Tool = z.infer<typeof toolSchema>;

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Streaming drawing operations. Coordinates are logical canvas pixels
 * (0..CANVAS_WIDTH, 0..CANVAS_HEIGHT) and may be fractional. Stroke `id`s are
 * assigned by the drawer and must be unique within a turn (an incrementing counter).
 */
export const drawOpSchema = z.discriminatedUnion('k', [
  z.object({
    k: z.literal('start'),
    id: z.number().int().nonnegative(),
    tool: toolSchema,
    color: hexColorSchema,
    size: z.number().min(1).max(100),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  /** Append points to the stroke `id`; `pts` is flat: [x0, y0, x1, y1, ...]. */
  z.object({
    k: z.literal('move'),
    id: z.number().int().nonnegative(),
    pts: z.array(z.number().finite()).min(2).max(2000).refine((a) => a.length % 2 === 0, 'pts must be pairs'),
  }),
  z.object({ k: z.literal('end'), id: z.number().int().nonnegative() }),
  /** Flood fill at (x, y) with `color`. */
  z.object({ k: z.literal('fill'), x: z.number().finite(), y: z.number().finite(), color: hexColorSchema }),
]);
export type DrawOp = z.infer<typeof drawOpSchema>;

/** Canvas history as kept by the server and replayed by late joiners. Undo removes the last action. */
export type CanvasAction =
  | {
      kind: 'stroke';
      id: number;
      tool: Tool;
      color: string;
      size: number;
      points: number[];
      /** Set once the drawer's 'end' op arrived; absent while the stroke may still receive points. */
      done?: boolean;
    }
  | { kind: 'fill'; x: number; y: number; color: string };

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
  /** True once this player has guessed the current word (also true for the drawer). */
  guessedThisTurn: boolean;
  /** Points earned during the current turn (reset each turn). */
  turnPoints: number;
  /** Player's position in the turn order (0-based). Useful for the lobby "who draws next" UI. */
  joinOrder: number;
}

export type TurnEndReason = 'allGuessed' | 'timeUp' | 'drawerLeft' | 'noWordChosen';

export type Phase =
  | { kind: 'lobby' }
  | {
      kind: 'choosing';
      drawerId: string;
      /** Epoch ms (server clock) when a word is auto-picked. */
      endsAt: number;
      /** Only present in the drawer's snapshot. */
      choices?: string[];
    }
  | {
      kind: 'drawing';
      drawerId: string;
      startedAt: number;
      endsAt: number;
      /** Hidden letters as "_", spaces/hyphens kept. Letters appear as hints are revealed. */
      mask: string;
      /** Only present in the drawer's snapshot (and for players who already guessed). */
      word?: string;
      likes: number;
      dislikes: number;
      /** This recipient's own rating, if any. */
      myRating?: 'like' | 'dislike';
    }
  | {
      kind: 'turnEnd';
      drawerId: string;
      word: string;
      reason: TurnEndReason;
      endsAt: number;
      /** Points earned this turn by player id (drawer included). */
      points: Record<string, number>;
    }
  | {
      kind: 'gameEnd';
      podium: Array<{ playerId: string; score: number; rank: number }>;
    };

export interface RoomState {
  code: string;
  hostId: string;
  settings: RoomSettings;
  players: PlayerPublic[];
  phase: Phase;
  /** 1-based current round (0 in lobby). */
  round: number;
  totalRounds: number;
  /** 1-based turn within the round (0 in lobby). */
  turn: number;
  turnsInRound: number;
  /** Server epoch ms when this snapshot was produced; clients use it to compute a clock offset. */
  serverTime: number;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type ChatKind =
  | 'chat' // normal message visible to everyone
  | 'guessed' // message from someone who already guessed; only visible to drawer + other guessers
  | 'correct' // "Alice guessed the word!"
  | 'close' // "'aple' is close!" — only sent to the guesser
  | 'system' // joins, leaves, host changes, kicks, turn info
  | 'hint'; // "The word was: apple"

export interface ChatMessage {
  id: number;
  kind: ChatKind;
  playerId?: string;
  name?: string;
  text: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('create'), name: nameSchema, avatar: avatarSchema }),
  z.object({ t: z.literal('join'), code: z.string().max(16), name: nameSchema, avatar: avatarSchema }),
  /** Resume a previous seat after a reload/disconnect using the token from `welcome`. */
  z.object({ t: z.literal('rejoin'), code: z.string().max(16), token: z.string().min(8).max(128) }),
  /** Host only, lobby only. */
  z.object({ t: z.literal('updateSettings'), settings: roomSettingsPatchSchema }),
  /** Lobby only. */
  z.object({ t: z.literal('updateProfile'), name: nameSchema.optional(), avatar: avatarSchema.optional() }),
  /** Host only, lobby only, needs MIN_PLAYERS_TO_START connected players. */
  z.object({ t: z.literal('start') }),
  /** Drawer only, during `choosing`. */
  z.object({ t: z.literal('chooseWord'), index: z.number().int().min(0).max(9) }),
  /** Drawer only, during `drawing`. Ops are batched by the client (~every 30ms). */
  z.object({ t: z.literal('draw'), ops: z.array(drawOpSchema).min(1).max(200) }),
  z.object({ t: z.literal('undo') }),
  z.object({ t: z.literal('clear') }),
  z.object({ t: z.literal('chat'), text: z.string().min(1).max(CHAT_MAX_LENGTH) }),
  /** Host only. */
  z.object({ t: z.literal('kick'), playerId: z.string().max(64) }),
  /** Any player; majority of other connected players kicks. */
  z.object({ t: z.literal('voteKick'), playerId: z.string().max(64) }),
  /** Non-drawers during `drawing`: rate the drawing. Sending the same value again clears it. */
  z.object({ t: z.literal('rate'), value: z.enum(['like', 'dislike']) }),
  /** Host only, during `gameEnd`. */
  z.object({ t: z.literal('returnToLobby') }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('ping') }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageOf<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>;

// ---------------------------------------------------------------------------
// Server → Client
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

export type ServerMessage =
  /** Sent once after a successful create/join/rejoin. */
  | { t: 'welcome'; playerId: string; token: string; room: RoomState; canvas: CanvasAction[]; chat: ChatMessage[] }
  /** Full per-recipient snapshot; replaces the client's room state wholesale. */
  | { t: 'room'; room: RoomState }
  | { t: 'draw'; ops: DrawOp[] }
  | { t: 'undo' }
  | { t: 'clear' }
  /** Full canvas resync (e.g. after rejoin mid-turn). */
  | { t: 'canvas'; actions: CanvasAction[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'error'; code: ErrorCode; message: string }
  /** The recipient was removed from the room; the socket is closed afterwards. */
  | { t: 'kicked'; reason: string }
  | { t: 'pong'; serverTime: number };

export type ServerMessageOf<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

/** Best-effort structural check for incoming server messages on the client. */
export function isServerMessage(x: unknown): x is ServerMessage {
  return typeof x === 'object' && x !== null && typeof (x as { t?: unknown }).t === 'string';
}

export const WS_PATH = '/ws';

/** Close codes the server uses; 4xxx is the application range. */
export const CLOSE_REPLACED = 4001;
export const CLOSE_REMOVED = 4002;

/** GET /api/rooms/:code — lets the home screen preview a code before joining. Always HTTP 200. */
export const ROOM_PREVIEW_PATH = '/api/rooms';

export type RoomPreview =
  | { exists: false; code: string; reason: 'INVALID_CODE' | 'ROOM_NOT_FOUND' }
  | { exists: true; code: string; players: number; maxPlayers: number; inProgress: boolean; joinable: boolean };

/** Session storage key under which the client remembers its seat for reconnects. */
export const SESSION_STORAGE_KEY = 'skribble.session';

export interface StoredSession {
  code: string;
  token: string;
  playerId: string;
}
