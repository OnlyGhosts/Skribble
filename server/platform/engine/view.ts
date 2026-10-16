/** Per-recipient projections of PlatformRoomData onto the wire protocol. */
import type { PlayerPublic, RoomPreview, RoomState, WaitingState, WelcomeMessage } from '../../../shared/platform/protocol.js';
import { moduleFor } from './module.js';
import { findPlayer, gameSeatLimit, isFull, minPlayers, participants, platformPlayers, platformSpectators, sortedPlayers } from './players.js';
import { upgradeRoomData, type PlatformPlayerData, type PlatformRoomData } from './state.js';

export function publicPlayer(p: PlatformPlayerData, hostId: string): PlayerPublic {
  return {
    id: p.id,
    name: p.name,
    avatar: { ...p.avatar },
    score: p.score,
    isHost: p.id === hostId,
    connected: p.connected,
    joinOrder: p.joinOrder,
    ready: p.ready,
    sittingOut: p.sittingOut,
    participating: p.participating,
    idle: p.connected && p.idle === true,
  };
}

/** Snapshot for one recipient (`null` for a role-less view used by HTTP previews and tests). */
export function viewFor(stored: PlatformRoomData, playerId: string | null, now: number): RoomState {
  // A room loaded straight from storage may predate the current settings (a 'cheeky' content mode).
  const data = upgradeRoomData(stored);
  const game = moduleFor(data.gameId);
  const players = platformPlayers(data);
  const spectators = platformSpectators(data);
  return {
    code: data.code,
    gameId: data.gameId,
    hostId: data.hostId,
    settings: structuredClone(data.settings),
    players: sortedPlayers(data).map((p) => publicPlayer(p, data.hostId)),
    phase: data.phase,
    results: data.results ? structuredClone(data.results) : null,
    endRequested: data.endRequested === true,
    game: data.game === null ? null : game.view(data.game, playerId !== null && findPlayer(data, playerId) ? playerId : null, { settings: data.settings, players, spectators, hostId: data.hostId, now }),
    waiting: waitingFor(data),
    serverTime: now,
  };
}

/**
 * The hold a running game declared, with the live counts. The missing list is narrowed to players
 * still seated and disconnected: a snapshot rendered between a rejoin and the game's refreshed
 * effect would otherwise name someone the player list already shows as connected. With nobody
 * left to wait for there is no hold to show (a game never holds for an empty list), so such a
 * frame carries null rather than a nameless wait.
 */
function waitingFor(data: PlatformRoomData): WaitingState | null {
  // A room stored before this field existed has no list at all; it is simply not holding.
  if (!data.waiting || data.phase !== 'playing') return null;
  const missing = data.waiting.filter((id) => findPlayer(data, id)?.connected === false);
  if (missing.length === 0) return null;
  // `needed` is a participant count, so `connected` counts participants too (spectators never fill a seat).
  const state: WaitingState = { reason: 'players', missing, needed: minPlayers(data), connected: participants(data).filter((p) => p.connected).length };
  if (typeof data.waitingUntil === 'number') state.until = data.waitingUntil;
  return state;
}

/** What the home screen shows about a room before joining it. */
export function previewOf(data: PlatformRoomData): RoomPreview {
  return {
    exists: true,
    code: data.code,
    gameId: data.gameId,
    players: data.players.length,
    maxPlayers: gameSeatLimit(data),
    // Only a running game has anything to watch.
    inProgress: data.phase === 'playing',
    joinable: !isFull(data),
  };
}

/** Everything in `welcome` except `extra`, which the driver's side store supplies. */
export function welcomeFor(data: PlatformRoomData, playerId: string, now: number): Omit<WelcomeMessage, 'extra'> | null {
  const player = findPlayer(data, playerId);
  if (!player) return null;
  return { t: 'welcome', playerId, token: player.token, room: viewFor(data, playerId, now), chat: structuredClone(data.chat), seq: player.lastSeq ?? 0 };
}
