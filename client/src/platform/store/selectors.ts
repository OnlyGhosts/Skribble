import type { PlayerPublic, RoomState } from '@shared/platform/protocol';
import type { AnyGameClientModule } from '../game';
import { registeredGame } from '../registry';
import { usePlatformStore, type PlatformStore } from './usePlatformStore';

// Derived selectors (stable references: they return objects owned by the state).

export const selectMe = (s: PlatformStore): PlayerPublic | null => s.room?.players.find((p) => p.id === s.playerId) ?? null;

export const selectIsHost = (s: PlatformStore): boolean => s.room !== null && s.room.hostId === s.playerId;

export function playerName(room: RoomState | null, playerId: string): string {
  return room?.players.find((p) => p.id === playerId)?.name ?? 'Someone';
}

/** The module of the game the current room runs; null outside a room. */
export function activeGame(): AnyGameClientModule | null {
  const room = usePlatformStore.getState().room;
  return room ? registeredGame(room.gameId) : null;
}

export function useActiveGame(): AnyGameClientModule | null {
  const gameId = usePlatformStore((s) => s.room?.gameId ?? null);
  return gameId ? registeredGame(gameId) : null;
}
