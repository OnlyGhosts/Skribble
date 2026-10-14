import { useSyncExternalStore } from 'react';
import type { BlackjackPlayerView, BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import type { PlayerPublic, RoomState } from '@shared/platform/protocol';
import { usePlatformStore } from '../../platform/store/usePlatformStore';

export function playerOf(room: RoomState, id: string | null | undefined): PlayerPublic | undefined {
  return id ? room.players.find((p) => p.id === id) : undefined;
}

export function nameOf(room: RoomState, id: string | null | undefined): string {
  return playerOf(room, id)?.name ?? 'Someone';
}

export function seatOf(view: BlackjackView | null, playerId: string | null): BlackjackPlayerView | undefined {
  return playerId !== null ? view?.players[playerId] : undefined;
}

/** Whether `playerId` holds the hand in play. */
export function isActing(view: BlackjackView | null, playerId: string | null): boolean {
  return playerId !== null && view !== null && view.phase === 'acting' && view.turn?.playerId === playerId;
}

/** In this round's deal (bet placed or still to place) rather than watching it. */
export function isInRound(view: BlackjackView | null, playerId: string | null): boolean {
  return playerId !== null && view !== null && view.order.includes(playerId);
}

/** Seats still to bet while the betting clock runs. */
export function pendingBettors(view: BlackjackView): string[] {
  return view.phase === 'betting' ? view.order.filter((id) => (view.players[id]?.bet ?? 0) === 0) : [];
}

/**
 * The seats round the table, left to right: the seats on the table (or about to be dealt) in
 * play order, then every other participant (just joined, out of chips) by join order.
 */
export function seatOrder(room: BlackjackRoomState, view: BlackjackView, dealt: readonly string[]): string[] {
  const first = [...dealt, ...view.order.filter((id) => !dealt.includes(id))].filter((id) => view.players[id] !== undefined);
  const rest = room.players
    .filter((p) => p.participating && view.players[p.id] !== undefined && !first.includes(p.id))
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .map((p) => p.id);
  return [...first, ...rest];
}

/** Whether the socket is up, read the same way on the server render (the unit tests) as live. */
export function useConnected(): boolean {
  const read = () => usePlatformStore.getState().connection === 'connected';
  return useSyncExternalStore(usePlatformStore.subscribe, read, read);
}

export { useTableNow } from '../../platform/table/useTableNow';
export { prefersReducedMotion } from '../../platform/lib/media';
