/** Read-only queries over PlatformRoomData shared by the reducer, the views and the drivers. */
import { gameById } from '../../../shared/platform/games.js';
import type { PlatformPlayer } from '../game.js';
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

export function isFull(data: PlatformRoomData): boolean {
  return data.players.length >= data.settings.maxPlayers;
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

export function hasEnoughPlayers(data: PlatformRoomData): boolean {
  return connectedCount(data) >= minPlayers(data);
}

export function othersConnected(data: PlatformRoomData, targetId: string): number {
  return data.players.filter((p) => p.connected && p.id !== targetId).length;
}

/** A majority of the other connected players, and never a single voter. */
export function votesNeeded(data: PlatformRoomData, targetId: string): number {
  return Math.max(2, Math.floor(othersConnected(data, targetId) / 2) + 1);
}

/** What a game module may see of the players, in join order. */
export function platformPlayers(data: PlatformRoomData): PlatformPlayer[] {
  return sortedPlayers(data).map((p) => ({ id: p.id, name: p.name, joinOrder: p.joinOrder, connected: p.connected, score: p.score }));
}
