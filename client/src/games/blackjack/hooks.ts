import type { BlackjackPlayerView, BlackjackRoomState, BlackjackView, HandView } from '@shared/games/blackjack/protocol';
import { useSyncExternalStore } from 'react';
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

/** In the round's deal (bet placed or still to place) rather than watching it. */
export function isInRound(view: BlackjackView | null, playerId: string | null): boolean {
  return playerId !== null && view !== null && view.order.includes(playerId);
}

/** The table's seats this round: everyone dealt in, in join order, then the participants watching (busted out or just joined). */
export function tableOrder(room: BlackjackRoomState, view: BlackjackView): string[] {
  const watching = room.players
    .filter((p) => p.participating && view.players[p.id] !== undefined && !view.order.includes(p.id))
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .map((p) => p.id);
  return [...view.order, ...watching];
}

/** The most a seat may stake this round: the table maximum or what the player holds, their current stake included. */
export function betCap(view: BlackjackView, maxBet: number, playerId: string): number {
  const seat = view.players[playerId];
  if (!seat) return 0;
  return Math.min(maxBet, seat.chips + seat.bet);
}

export function clampBet(amount: number, minBet: number, cap: number): number {
  if (!Number.isFinite(amount)) return minBet;
  return Math.max(minBet, Math.min(cap, Math.round(amount)));
}

/** Seats still to bet while the betting clock runs. */
export function pendingBettors(view: BlackjackView): string[] {
  return view.order.filter((id) => (view.players[id]?.bet ?? 0) === 0);
}

/** A hand is over for the player once it stood, bust, was a natural or got settled. */
export function handDone(hand: HandView): boolean {
  return hand.status !== 'waiting' && hand.status !== 'acting';
}

/** One step of the game: the round and phase, plus the hand in play, so a turn passing in the same phase still counts. */
export function stepOf(room: BlackjackRoomState | null): string | null {
  const v = room?.game;
  if (!v) return null;
  return `${v.round}:${v.phase}:${v.turn ? `${v.turn.playerId}/${v.turn.handIndex}` : ''}`;
}

export function roundChanged(prev: BlackjackRoomState | null, next: BlackjackRoomState): boolean {
  return prev?.game?.round !== next.game?.round;
}

export function phaseEntered(prev: BlackjackRoomState | null, next: BlackjackRoomState, phase: BlackjackView['phase']): boolean {
  return next.game?.phase === phase && (prev?.game?.phase !== phase || roundChanged(prev, next));
}

/** Net chips a player's settled hands returned this round: positive for a win, negative for a loss, 0 for pushes only. */
export function netOf(view: BlackjackView, playerId: string): number {
  return view.results.filter((r) => r.playerId === playerId).reduce((sum, r) => sum + r.payout - r.bet, 0);
}

/** Whether the socket is up, read the same way on the server render (the unit tests) as live. */
export function useConnected(): boolean {
  const read = () => usePlatformStore.getState().connection === 'connected';
  return useSyncExternalStore(usePlatformStore.subscribe, read, read);
}
