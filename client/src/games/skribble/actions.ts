import type { Rating } from '@shared/games/skribble/protocol';
import { socket } from '../../platform/net/socket';
import { skribbleCanvas } from './canvas';

export function chooseWord(index: number): void {
  socket.send({ t: 'chooseWord', index });
}

/** Undo, redo and clear are the shared canvas's: applied locally the moment they are sent, their echoes ignored. */
export function undoStroke(): void {
  skribbleCanvas.undo();
}

export function redoStroke(): void {
  skribbleCanvas.redo();
}

export function clearCanvas(): void {
  skribbleCanvas.clear();
}

export function rateDrawing(value: Rating): void {
  socket.send({ t: 'rate', value });
}
