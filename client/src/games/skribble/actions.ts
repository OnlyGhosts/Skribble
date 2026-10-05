import type { Rating } from '@shared/games/skribble/protocol';
import { socket } from '../../platform/net/socket';
import { drawQueue } from './net';
import { useSkribbleStore } from './store';

export function chooseWord(index: number): void {
  socket.send({ t: 'chooseWord', index });
}

/**
 * Undo/clear flush any buffered ops first so the server removes what the drawer sees as last, and
 * take effect locally at once: by the time the server's echo arrives the drawer may already have
 * started a new stroke, so applying the echo against the current list would remove the wrong one
 * (the module ignores the drawer's own echoes for that reason).
 */
export function undoStroke(): void {
  drawQueue.flush();
  if (socket.send({ t: 'undo' })) useSkribbleStore.getState().undo();
}

export function clearCanvas(): void {
  drawQueue.flush();
  if (socket.send({ t: 'clear' })) useSkribbleStore.getState().clear();
}

export function rateDrawing(value: Rating): void {
  socket.send({ t: 'rate', value });
}
