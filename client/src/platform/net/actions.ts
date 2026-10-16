import type { Avatar } from '@shared/platform/avatar';
import type { GameId } from '@shared/platform/games';
import { friendlyError } from '../lib/format';
import { heldSeat } from '../lib/storage';
import { usePlatformStore, type JoinRequest } from '../store/usePlatformStore';
import { socket } from './socket';

const JOIN_TIMEOUT_MS = 10_000;
let joinTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Sends a create/join now, or parks it until the socket opens. Either way the home screen gets
 * a definitive answer within JOIN_TIMEOUT_MS.
 */
function submitJoin(request: JoinRequest): void {
  const store = usePlatformStore.getState();
  store.beginJoin(request);
  if (socket.isOpen()) {
    store.setPendingJoin(null);
    sendJoin(request);
  }
  if (joinTimer !== null) clearTimeout(joinTimer);
  joinTimer = setTimeout(() => {
    joinTimer = null;
    const s = usePlatformStore.getState();
    if (!s.joinPending) return;
    const code = socket.isOpen() ? 'TIMEOUT' : 'OFFLINE';
    s.failJoin({ code, message: friendlyError(code) });
  }, JOIN_TIMEOUT_MS);
}

/** A join for a room whose seat this phone still holds goes back into that seat (falling back to the join). */
export function sendJoin(request: JoinRequest): void {
  const seat = request.t === 'join' ? heldSeat(request.code, Date.now()) : null;
  if (!seat || !socket.resumeOrJoin(seat, request)) socket.send(request);
}

export function createRoom(gameId: GameId, name: string, avatar: Avatar): void {
  submitJoin({ t: 'create', gameId, name, avatar });
}

/**
 * Codes are one namespace across games: the server tells us which game the room runs. A code
 * whose seat this phone still holds puts the player back in it.
 */
export function joinRoom(code: string, name: string, avatar: Avatar): void {
  submitJoin({ t: 'join', code, name, avatar });
}

export function cancelJoin(): void {
  if (joinTimer !== null) {
    clearTimeout(joinTimer);
    joinTimer = null;
  }
  usePlatformStore.getState().failJoin({ code: 'OFFLINE', message: '' });
  usePlatformStore.getState().clearJoinError();
}

/** The game module flushes first (`onLeave`, through resetRoom) while the seat is still ours; then the seat goes. */
export function leaveRoom(): void {
  usePlatformStore.getState().resetRoom();
  socket.leave();
}

export function sendChat(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return socket.send({ t: 'chat', text: trimmed });
}

/** One flat patch: platform fields and the room's game fields side by side. */
export function updateSettings(patch: Record<string, unknown>): void {
  socket.send({ t: 'updateSettings', settings: patch });
}

export function updateProfile(name: string | undefined, avatar: Avatar | undefined): void {
  socket.send({ t: 'updateProfile', ...(name !== undefined ? { name } : {}), ...(avatar !== undefined ? { avatar } : {}) });
}

/** Host only, in the lobby: the party moves to another game without anyone leaving. */
export function selectGame(gameId: GameId): void {
  socket.send({ t: 'selectGame', gameId });
}

/** Lobby: ready for the next game (or not). */
export function setReady(ready: boolean): void {
  socket.send({ t: 'ready', ready });
}

/** Lobby: sit the next game out while staying in the party (or come back in). */
export function setSitOut(sitOut: boolean): void {
  socket.send({ t: 'sitOut', sitOut });
}

/**
 * "Count me in" for a player sitting out: back in and ready in one tap (sitOut false, then ready,
 * in that order on the one socket). The host only comes back in; pressing Start readies them.
 */
export function countMeIn(isHost: boolean): void {
  setSitOut(false);
  if (!isHost) setReady(true);
}

export function startGame(): void {
  socket.send({ t: 'start' });
}

export function kickPlayer(playerId: string): void {
  socket.send({ t: 'kick', playerId });
}

export function voteKick(playerId: string): void {
  socket.send({ t: 'voteKick', playerId });
}

/** Host only, while a game runs: ends it for everyone (at once, or after the hand in play where the game says so). */
export function endGame(): void {
  socket.send({ t: 'endGame' });
}
