/**
 * The complete, JSON-safe state of one room. No Map/Set/Date/class instances/timers/sockets:
 * `JSON.parse(JSON.stringify(data))` is the identity, so the same object can be stored in
 * memory or in Redis and driven from anywhere.
 *
 * Deadlines are epoch ms, so no timers are needed; the driver asks `nextDeadline(data)` when to
 * tick next. The running game's own state sits in `game`, opaque to the platform.
 */
import type { Avatar } from '../../../shared/platform/avatar.js';
import { gameById, upgradeGameId, type GameId } from '../../../shared/platform/games.js';
import type { ChatMessage, GameResults, RoomPhase } from '../../../shared/platform/protocol.js';
import { defaultPlatformSettings, upgradeContentMode, type PlatformSettings } from '../../../shared/platform/settings.js';
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
  /** Lobby only: readied up for the next game. Reset to false when a game starts. */
  ready: boolean;
  /** Chose to sit the next game out; persists across games until the player changes it. */
  sittingOut: boolean;
  /** In the running game; false in the lobby. */
  participating: boolean;
  /**
   * While the socket is down: when the running game hears of it (AWAY_NOTICE_MS after the drop).
   * Until then the game still counts the player as connected; null once it knows or while
   * connected. Absent in rooms stored before it existed.
   */
  awayNoticeAt?: number | null;
  /** Connected but silent for IDLE_AFTER_MS (the connection layer tells the room). Absent means false. */
  idle?: boolean;
  /** The highest client sequence number applied for this seat (see CLIENT_SEQ_KEY). Absent means 0. */
  lastSeq?: number;
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
  /** The last game's final standings, kept in the lobby until the next game starts; null otherwise. */
  results: GameResults | null;
  /** The host's End game is in (the game ends at its next boundary); false otherwise. Absent in older rooms. */
  endRequested?: boolean;
  /** The game module's state (its `D`); null in the lobby. */
  game: unknown;
  /** Ids of the disconnected players a holding game waits for (its last 'waiting' effect); null while it runs. */
  waiting: string[] | null;
  /** When the holding game goes on without them (the effect's `until`); null or absent when it waits for good. */
  waitingUntil?: number | null;
  /** Public chat history (capped at CHAT_HISTORY_LENGTH), replayed to joiners. */
  chat: ChatMessage[];
  nextChatId: number;
  votes: VoteKick[];
  grace: GraceDeadlines;
  nextJoinOrder: number;
}

export const MAX_KICKED_TOKENS = 50;

/**
 * Rooms stored before the party fields existed load with them filled in: a running game counts
 * every seat as playing, and a settings record from before content modes, or from when 'cheeky'
 * was a mode, reads as a family room (the games index their content packs by it, so it must
 * always name a mode that exists). A game's settings stored before a field was added take its
 * default; retired fields stay, harmlessly, since nothing reads them. A room stored under a game's
 * former id (Scribble's rooms from before its rename) loads under the current one.
 */
export function upgradeRoomData(stored: PlatformRoomData): PlatformRoomData {
  const gameId = upgradeGameId(stored.gameId) ?? stored.gameId;
  const data = upgradeEndedPhase(gameId === stored.gameId ? stored : { ...stored, gameId });
  const players = data.players as Array<Partial<PlatformPlayerData> & PlatformPlayerData>;
  const settings = data.settings as Partial<RoomSettingsData> & Record<string, unknown>;
  const playersCurrent = players.every((p) => typeof p.ready === 'boolean' && typeof p.sittingOut === 'boolean' && typeof p.participating === 'boolean');
  const contentMode = upgradeContentMode(settings.contentMode);
  const gameSettings = upgradeGameSettings(data);
  if (playersCurrent && settings.contentMode === contentMode && gameSettings === null) return data;
  return {
    ...data,
    settings: { ...(gameSettings ?? data.settings), contentMode },
    players: players.map((p) => ({
      ...p,
      ready: p.ready ?? false,
      sittingOut: p.sittingOut ?? false,
      participating: p.participating ?? data.phase !== 'lobby',
    })),
  };
}

/** A room as stored before the results lived in the lobby: a podium phase, a `podium` list. */
type LegacyRoomData = Omit<PlatformRoomData, 'phase' | 'results'> & {
  phase: RoomPhase | 'ended';
  results?: GameResults | null;
  podium?: Array<{ playerId: string; score: number; rank: number }> | null;
};

/**
 * A room stored on the old podium phase loads as a lobby carrying that podium as its results
 * (everyone is between games either way); the old `podium` field of any other room is dropped.
 */
function upgradeEndedPhase(stored: PlatformRoomData): PlatformRoomData {
  const legacy = stored as LegacyRoomData;
  if (legacy.phase !== 'ended' && legacy.results !== undefined && !('podium' in legacy)) return stored;
  const { podium, ...rest } = legacy;
  if (legacy.phase !== 'ended') return { ...rest, phase: legacy.phase, results: legacy.results ?? null };
  const entries = (podium ?? []).flatMap((e) => {
    const p = legacy.players.find((x) => x.id === e.playerId);
    return p ? [{ playerId: p.id, name: p.name, avatar: { ...p.avatar }, score: e.score, rank: e.rank }] : [];
  });
  return {
    ...rest,
    phase: 'lobby',
    game: null,
    waiting: null,
    waitingUntil: null,
    votes: [],
    endRequested: false,
    results: { id: `stored-${legacy.version}`, gameId: legacy.gameId, reason: 'finished', entries },
    players: legacy.players.map((p) => ({ ...p, score: 0, participating: false })),
  };
}

/** The room's settings with the game's missing fields filled in, or null when none is missing. */
function upgradeGameSettings(data: PlatformRoomData): RoomSettingsData | null {
  const stored = data.settings as Record<string, unknown>;
  const gameDefaults = moduleFor(data.gameId).settings.defaults as Record<string, unknown>;
  const missing = Object.keys(gameDefaults).filter((key) => !(key in stored));
  if (missing.length === 0) return null;
  return { ...data.settings, ...Object.fromEntries(missing.map((key) => [key, structuredClone(gameDefaults[key])])) };
}

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
    results: null,
    endRequested: false,
    game: null,
    waiting: null,
    waitingUntil: null,
    chat: [],
    nextChatId: 1,
    votes: [],
    grace: { emptyRoomAt: null },
    nextJoinOrder: 0,
  };
}
