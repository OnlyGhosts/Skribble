import type { Avatar } from '@shared/avatar';
import type { RoomSettingsPatch } from '@shared/settings';
import { friendlyError } from '../lib/format';
import { clearSession } from '../lib/storage';
import { useGameStore, type JoinRequest } from '../store/useGameStore';
import { socket } from './socket';

const JOIN_TIMEOUT_MS = 10_000;
let joinTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Sends a create/join now, or parks it until the socket opens. Either way the Home screen gets
 * a definitive answer within JOIN_TIMEOUT_MS.
 */
function submitJoin(request: JoinRequest): void {
  const store = useGameStore.getState();
  store.beginJoin(request);
  if (socket.isOpen()) {
    store.setPendingJoin(null);
    socket.send(request);
  }
  if (joinTimer !== null) clearTimeout(joinTimer);
  joinTimer = setTimeout(() => {
    joinTimer = null;
    const s = useGameStore.getState();
    if (!s.joinPending) return;
    const code = socket.isOpen() ? 'TIMEOUT' : 'OFFLINE';
    s.failJoin({ code, message: friendlyError(code) });
  }, JOIN_TIMEOUT_MS);
}

export function createRoom(name: string, avatar: Avatar): void {
  submitJoin({ t: 'create', name, avatar });
}

export function joinRoom(code: string, name: string, avatar: Avatar): void {
  submitJoin({ t: 'join', code, name, avatar });
}

export function cancelJoin(): void {
  if (joinTimer !== null) {
    clearTimeout(joinTimer);
    joinTimer = null;
  }
  useGameStore.getState().failJoin({ code: 'OFFLINE', message: '' });
  useGameStore.getState().clearJoinError();
}

export function leaveRoom(): void {
  socket.flushDraw();
  socket.send({ t: 'leave' });
  clearSession();
  useGameStore.getState().resetRoom();
}

export function sendChat(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return socket.send({ t: 'chat', text: trimmed });
}

export function updateSettings(patch: RoomSettingsPatch): void {
  socket.send({ t: 'updateSettings', settings: patch });
}

export function updateProfile(name: string | undefined, avatar: Avatar | undefined): void {
  socket.send({ t: 'updateProfile', ...(name !== undefined ? { name } : {}), ...(avatar !== undefined ? { avatar } : {}) });
}

export function startGame(): void {
  socket.send({ t: 'start' });
}

export function chooseWord(index: number): void {
  socket.send({ t: 'chooseWord', index });
}

/** Undo/clear flush any buffered ops first so the server removes what the drawer sees as last. */
export function undoStroke(): void {
  socket.flushDraw();
  socket.send({ t: 'undo' });
}

export function clearCanvas(): void {
  socket.flushDraw();
  socket.send({ t: 'clear' });
}

export function kickPlayer(playerId: string): void {
  socket.send({ t: 'kick', playerId });
}

export function voteKick(playerId: string): void {
  socket.send({ t: 'voteKick', playerId });
}

export function rateDrawing(value: 'like' | 'dislike'): void {
  socket.send({ t: 'rate', value });
}

export function returnToLobby(): void {
  socket.send({ t: 'returnToLobby' });
}
