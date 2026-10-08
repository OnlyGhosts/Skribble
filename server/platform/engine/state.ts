/**
 * The complete, JSON-safe state of one room. No Map/Set/Date/class instances/timers/sockets:
 * `JSON.parse(JSON.stringify(data))` is the identity, so the same object can be stored in
 * memory or in Redis and driven from anywhere.
 *
 * Deadlines are epoch ms, so no timers are needed; the driver asks `nextDeadline(data)` when to
 * tick next. The running game's own state sits in `game`, opaque to the platform.
 */
import type { Avatar } from '../../../shared/platform/avatar.js';
import { gameById, type GameId } from '../../../shared/platform/games.js';
import type { ChatMessage, PodiumEntry, RoomPhase } from '../../../shared/platform/protocol.js';
import { defaultPlatformSettings, type PlatformSettings } from '../../../shared/platform/settings.js';
import { moduleFor } from './module.js';

export interface PlatformPlayerData {
  id: string;
  /** Secret used by `rejoin`. Players who leave or are kicked are removed, so a token never outlives its seat. */
  token: string;
  name: string;
  avatar: Avatar;
  score: number;
  /** Seat order (0-based, never reused within a room). */
  joinOrder: number;
  connected: boolean;
  /** Id of the connection bound to this seat; null while disconnected. */
  connectionId: string | null;
  /** When the current connection was established; the longest-connected player becomes host. */
  connectedAt: number;
  /** Epoch ms of the disconnect that started the reconnect grace; null while connected. */
  disconnectedAt: number | null;
}

export interface GraceDeadlines {
  /** The room is empty: it is destroyed at this time unless someone joins. */
  emptyRoomAt: number | null;
}

export interface VoteKick {
  targetId: string;
  voterIds: string[];
}

/** Platform settings with the game's settings flat next to them. */
export type RoomSettingsData = PlatformSettings & Record<string, unknown>;

export interface PlatformRoomData {
  code: string;
  gameId: GameId;
  /** Increments on every action that changed something; lets drivers detect concurrent writes. */
  version: number;
  createdAt: number;
  updatedAt: number;
  settings: RoomSettingsData;
  hostId: string;
  /** Host whose socket dropped: a connected stand-in holds the role until they rejoin or are removed. */
  returningHostId: string | null;
  /** In join order. */
  players: PlatformPlayerData[];
  /** Tokens of kicked players (capped): a kicked player's rejoin is refused with a clear message. */
  kickedTokens: string[];
  phase: RoomPhase;
  podium: PodiumEntry[] | null;
  /** The game module's state (its `D`); null in the lobby. */
  game: unknown;
  /** Ids of the disconnected players a holding game waits for (its last 'waiting' effect); null while it runs. */
  waiting: string[] | null;
  /** Public chat history (capped at CHAT_HISTORY_LENGTH), replayed to joiners. */
  chat: ChatMessage[];
  nextChatId: number;
  votes: VoteKick[];
  grace: GraceDeadlines;
  nextJoinOrder: number;
}

export const MAX_KICKED_TOKENS = 50;

export function createRoomData(code: string, gameId: GameId, now: number): PlatformRoomData {
  const game = moduleFor(gameId);
  return {
    code,
    gameId,
    version: 0,
    createdAt: now,
    updatedAt: now,
    settings: { ...defaultPlatformSettings(gameById(gameId)), ...structuredClone(game.settings.defaults as Record<string, unknown>) },
    hostId: '',
    returningHostId: null,
    players: [],
    kickedTokens: [],
    phase: 'lobby',
    podium: null,
    game: null,
    waiting: null,
    chat: [],
    nextChatId: 1,
    votes: [],
    grace: { emptyRoomAt: null },
    nextJoinOrder: 0,
  };
}
