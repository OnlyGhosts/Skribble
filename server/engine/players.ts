/** Read-only queries over RoomData shared by the reducer, the views and the drivers. */
import { MIN_PLAYERS_TO_START } from '../../shared/constants.js';
import type { PhaseData, PlayerData, RoomData } from './state.js';

export function findPlayer(data: RoomData, id: string): PlayerData | undefined {
  return data.players.find((p) => p.id === id);
}

export function findByToken(data: RoomData, token: string): PlayerData | undefined {
  return token ? data.players.find((p) => p.token === token) : undefined;
}

export function sortedPlayers(data: RoomData): PlayerData[] {
  return [...data.players].sort((a, b) => a.joinOrder - b.joinOrder);
}

export function connectedPlayers(data: RoomData): PlayerData[] {
  return data.players.filter((p) => p.connected);
}

export function connectedCount(data: RoomData): number {
  return connectedPlayers(data).length;
}

export function connectedIds(data: RoomData): string[] {
  return connectedPlayers(data).map((p) => p.id);
}

export function isGamePhase(kind: PhaseData['kind']): boolean {
  return kind === 'choosing' || kind === 'drawing' || kind === 'turnEnd';
}

export function isFull(data: RoomData): boolean {
  return data.players.length >= data.settings.maxPlayers;
}

export function inProgress(data: RoomData): boolean {
  return data.phase.kind !== 'lobby';
}

export function isJoinable(data: RoomData): boolean {
  return !isFull(data) && (!inProgress(data) || data.settings.allowMidGameJoin);
}

export function hasEnoughPlayers(data: RoomData): boolean {
  return connectedCount(data) >= MIN_PLAYERS_TO_START;
}

/** True when every connected non-drawer has guessed (and there is at least one). */
export function everyoneGuessed(data: RoomData): boolean {
  if (!data.turn) return false;
  let pending = 0;
  let guessers = 0;
  for (const p of data.players) {
    if (p.id === data.turn.drawerId || !p.connected) continue;
    guessers++;
    if (!p.guessedThisTurn) pending++;
  }
  return guessers > 0 && pending === 0;
}

export function othersConnected(data: RoomData, targetId: string): number {
  return data.players.filter((p) => p.connected && p.id !== targetId).length;
}

/** A majority of the other connected players, and never a single voter. */
export function votesNeeded(data: RoomData, targetId: string): number {
  return Math.max(2, Math.floor(othersConnected(data, targetId) / 2) + 1);
}

/** The drawer may draw during the drawing phase, until its deadline (even if no tick has ended it yet). */
export function canDraw(data: RoomData, playerId: string, now: number): boolean {
  return data.phase.kind === 'drawing' && data.turn !== null && data.turn.drawerId === playerId && now < data.turn.endsAt;
}

export function isDrawer(data: RoomData, playerId: string): boolean {
  return data.turn !== null && data.turn.drawerId === playerId;
}

export const NOT_DRAWER_MESSAGE = 'Only the drawer can draw right now.';

/**
 * Whether a canvas op from `playerId` is accepted. Ops the drawer had in flight when their turn
 * ended are expected ('silent'); only a stranger drawing gets an error ('forbidden').
 */
export function drawerCheck(data: RoomData, playerId: string, now: number): 'ok' | 'silent' | 'forbidden' {
  if (canDraw(data, playerId, now)) return 'ok';
  return isDrawer(data, playerId) ? 'silent' : 'forbidden';
}
