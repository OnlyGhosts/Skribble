/** Read-only queries over PlatformRoomData shared by the reducer, the views and the drivers. */
import { gameById } from '../../../shared/platform/games.js';
import { ROOM_HARD_CAP, seatLimit } from '../../../shared/platform/settings.js';
import type { PlatformPlayer, PlatformSpectator } from '../game.js';
import type { PlatformPlayerData, PlatformRoomData } from './state.js';

export function findPlayer(data: PlatformRoomData, id: string): PlatformPlayerData | undefined {
  return data.players.find((p) => p.id === id);
}

export function findByToken(data: PlatformRoomData, token: string): PlatformPlayerData | undefined {
  return token ? data.players.find((p) => p.token === token) : undefined;
}

export function sortedPlayers(data: PlatformRoomData): PlatformPlayerData[] {
  return [...data.players].sort((a, b) => a.joinOrder - b.joinOrder);
}

export function connectedPlayers(data: PlatformRoomData): PlatformPlayerData[] {
  return data.players.filter((p) => p.connected);
}

export function connectedCount(data: PlatformRoomData): number {
  return connectedPlayers(data).length;
}

export function connectedIds(data: PlatformRoomData): string[] {
  return connectedPlayers(data).map((p) => p.id);
}

/** Every seat the room can hold is taken (players in reconnect grace included). */
export function isFull(data: PlatformRoomData): boolean {
  return data.players.length >= ROOM_HARD_CAP;
}

export function inProgress(data: PlatformRoomData): boolean {
  return data.phase !== 'lobby';
}

export function isJoinable(data: PlatformRoomData): boolean {
  return !isFull(data) && (!inProgress(data) || data.settings.allowMidGameJoin);
}

export function minPlayers(data: PlatformRoomData): number {
  return gameById(data.gameId).minPlayers;
}

/** Seats the current game can fill at once (the room's hard cap when the game has no limit). */
export function gameSeatLimit(data: PlatformRoomData): number {
  return seatLimit(gameById(data.gameId));
}

/** Seated players in the running (or just ended) game, in join order. */
export function participants(data: PlatformRoomData): PlatformPlayerData[] {
  return sortedPlayers(data).filter((p) => p.participating);
}

/** Seated players watching the running game, in join order. */
export function spectatorPlayers(data: PlatformRoomData): PlatformPlayerData[] {
  return sortedPlayers(data).filter((p) => !p.participating);
}

/** Connected players who readied up and are not sitting out: the ones a start seats, in join order. */
export function readyPlayers(data: PlatformRoomData): PlatformPlayerData[] {
  return sortedPlayers(data).filter((p) => p.connected && p.ready && !p.sittingOut);
}

/** Enough participating seats (connected or in reconnect grace) for the game to go on; connections alone never decide that. */
export function hasEnoughSeated(data: PlatformRoomData): boolean {
  return participants(data).length >= minPlayers(data);
}

/**
 * Who decides a vote-kick: the connected participants while a game runs, every connected player in
 * the lobby (nobody is "in the game" there).
 */
export function electorate(data: PlatformRoomData): PlatformPlayerData[] {
  return connectedPlayers(data).filter((p) => data.phase === 'lobby' || p.participating);
}

export function othersConnected(data: PlatformRoomData, targetId: string): number {
  return electorate(data).filter((p) => p.id !== targetId).length;
}

/** A majority of the other connected players, and never a single voter. */
export function votesNeeded(data: PlatformRoomData, targetId: string): number {
  return Math.max(2, Math.floor(othersConnected(data, targetId) / 2) + 1);
}

/** What a game module may see of the participating players, in join order. */
export function platformPlayers(data: PlatformRoomData): PlatformPlayer[] {
  return participants(data).map((p) => ({ id: p.id, name: p.name, joinOrder: p.joinOrder, connected: p.connected, score: p.score }));
}

/** What a game module may see of the spectators, in join order. */
export function platformSpectators(data: PlatformRoomData): PlatformSpectator[] {
  return spectatorPlayers(data).map((p) => ({ id: p.id, name: p.name, connected: p.connected }));
}
