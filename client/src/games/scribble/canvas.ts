import { createCanvasSession } from '../../platform/canvas';
import { socket } from '../../platform/net/socket';
import { usePlatformStore, type PlatformStore } from '../../platform/store/usePlatformStore';
import { drawingTurnKey, selectScribbleRoom } from './hooks';

/** The key of the drawing turn this player is drawing in right now; null unless they are the drawer of a drawing turn. */
export function myDrawingTurn(s: PlatformStore): string | null {
  const room = selectScribbleRoom(s);
  const phase = room?.game?.phase;
  if (!room || !phase || phase.kind !== 'drawing' || phase.drawerId !== s.playerId) return null;
  return drawingTurnKey(room);
}

/** Scribble's canvas: the platform's shared canvas session on the game socket. */
export const scribbleCanvas = createCanvasSession({
  link: { send: (msg) => socket.send(msg), isOpen: () => socket.isOpen() },
  myDrawingTurn: () => myDrawingTurn(usePlatformStore.getState()),
});
