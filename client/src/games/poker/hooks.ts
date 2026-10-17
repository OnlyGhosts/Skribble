import type { PokerPlayerView, PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { useSyncExternalStore } from 'react';
import type { PlayerPublic, RoomState } from '@shared/platform/protocol';
import { usePlatformStore } from '../../platform/store/usePlatformStore';

export function playerOf(room: RoomState, id: string | null | undefined): PlayerPublic | undefined {
  return id ? room.players.find((p) => p.id === id) : undefined;
}

export function nameOf(room: RoomState, id: string | null | undefined): string {
  return playerOf(room, id)?.name ?? 'Someone';
}

export function seatOf(view: PokerView | null, playerId: string | null): PokerPlayerView | undefined {
  return playerId !== null ? view?.players[playerId] : undefined;
}

/** Whether it is `playerId`'s move. */
export function isMyTurn(view: PokerView | null, playerId: string | null): boolean {
  return playerId !== null && view !== null && view.phase === 'acting' && view.turn === playerId;
}

/** Dealt into the current hand (folded or not). */
export function isInHand(view: PokerView | null, playerId: string | null): boolean {
  return playerId !== null && view !== null && view.order.includes(playerId);
}

/**
 * The table round from the seat after `meId`: the hand's seats in order, then the participants
 * not dealt in (busted, or seated from the next hand) by join order. Without a seat of my own the
 * ring starts at the first seat.
 */
export function seatRing(room: PokerRoomState, view: PokerView, meId: string | null): string[] {
  const waiting = room.players
    .filter((p) => p.participating && view.players[p.id] !== undefined && !view.order.includes(p.id))
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .map((p) => p.id);
  const ring = [...view.order, ...waiting];
  const at = meId === null ? -1 : ring.indexOf(meId);
  if (at < 0) return ring;
  return [...ring.slice(at + 1), ...ring.slice(0, at)];
}

/** The street's highest bet. */
export function highestBet(view: Pick<PokerView, 'players'>): number {
  return Object.values(view.players).reduce((max, p) => Math.max(max, p.bet), 0);
}

/** One step of the game (hand, street, phase and turn): the raise panel belongs to one step. */
export function stepOf(room: PokerRoomState | null): string | null {
  const v = room?.game;
  if (!v) return null;
  return `${v.hand}:${v.street ?? ''}:${v.phase}:${v.turn ?? ''}`;
}

/** Whether the socket is up, read the same way on the server render (the unit tests) as live. */
export function useConnected(): boolean {
  const read = () => usePlatformStore.getState().connection === 'connected';
  return useSyncExternalStore(usePlatformStore.subscribe, read, read);
}

/** The server is restarting (or bringing the room back after one): the status line says so, as the notice does. */
export function useRestarting(): boolean {
  const read = () => usePlatformStore.getState().connection === 'restarting';
  return useSyncExternalStore(usePlatformStore.subscribe, read, read);
}

/** A rejoin is in flight (the socket is back, the seat not yet): the controls wait for it. */
export function useRejoining(): boolean {
  const read = () => usePlatformStore.getState().rejoining;
  return useSyncExternalStore(usePlatformStore.subscribe, read, read);
}
