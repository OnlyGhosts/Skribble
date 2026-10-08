/** Per-recipient projections of PlatformRoomData onto the wire protocol. */
import type { PlayerPublic, RoomPreview, RoomState, WaitingState, WelcomeMessage } from '../../../shared/platform/protocol.js';
import { moduleFor } from './module.js';
import { connectedCount, findPlayer, inProgress, isJoinable, minPlayers, platformPlayers, sortedPlayers } from './players.js';
import type { PlatformPlayerData, PlatformRoomData } from './state.js';

export function publicPlayer(p: PlatformPlayerData, hostId: string): PlayerPublic {
  return {
    id: p.id,
    name: p.name,
    avatar: { ...p.avatar },
    score: p.score,
    isHost: p.id === hostId,
    connected: p.connected,
    joinOrder: p.joinOrder,
  };
}

/** Snapshot for one recipient (`null` for a role-less view used by HTTP previews and tests). */
export function viewFor(data: PlatformRoomData, playerId: string | null, now: number): RoomState {
  const game = moduleFor(data.gameId);
  const players = platformPlayers(data);
  return {
    code: data.code,
    gameId: data.gameId,
    hostId: data.hostId,
    settings: structuredClone(data.settings),
    players: sortedPlayers(data).map((p) => publicPlayer(p, data.hostId)),
    phase: data.phase,
    podium: data.podium ? data.podium.map((e) => ({ ...e })) : null,
    game: data.game === null ? null : game.view(data.game, playerId !== null && findPlayer(data, playerId) ? playerId : null, { settings: data.settings, players, hostId: data.hostId, now }),
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
  return { reason: 'players', missing, needed: minPlayers(data), connected: connectedCount(data) };
}

/** What the home screen shows about a room before joining it. */
export function previewOf(data: PlatformRoomData): RoomPreview {
  return {
    exists: true,
    code: data.code,
    gameId: data.gameId,
    players: data.players.length,
    maxPlayers: data.settings.maxPlayers,
    inProgress: inProgress(data),
    joinable: isJoinable(data),
  };
}

/** Everything in `welcome` except `extra`, which the driver's side store supplies. */
export function welcomeFor(data: PlatformRoomData, playerId: string, now: number): Omit<WelcomeMessage, 'extra'> | null {
  const player = findPlayer(data, playerId);
  if (!player) return null;
  return { t: 'welcome', playerId, token: player.token, room: viewFor(data, playerId, now), chat: structuredClone(data.chat) };
}
