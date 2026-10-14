import { useSyncExternalStore } from 'react';
import { createCanvasSession } from '../../platform/canvas';
import { socket } from '../../platform/net/socket';
import { usePlatformStore, type PlatformStore } from '../../platform/store/usePlatformStore';
import { drawingKey, selectHangmanRoom } from './hooks';

/** The key of the section this player is drawing right now; null unless they are the hangman of a drawing step. */
export function myDrawingTurn(s: PlatformStore): string | null {
  const room = selectHangmanRoom(s);
  if (!room || room.game?.hangmanId !== s.playerId) return null;
  return drawingKey(room);
}

/** Hangman's canvas: the platform's shared canvas session on the game socket. */
export const hangmanCanvas = createCanvasSession({ link: { send: (msg) => socket.send(msg), isOpen: () => socket.isOpen() }, myDrawingTurn: () => myDrawingTurn(usePlatformStore.getState()) });

/** How many actions the canvas holds, read with the live state as the server snapshot too (like useHangman). */
export function useStrokeCount(): number {
  const read = () => hangmanCanvas.store.getState().canvas.length;
  return useSyncExternalStore(hangmanCanvas.store.subscribe, read, read);
}
