import type { Rating } from '@shared/games/scribble/protocol';
import { socket } from '../../platform/net/socket';
import { scribbleCanvas } from './canvas';

export function chooseWord(index: number): void {
  socket.send({ t: 'chooseWord', index });
}

/** Undo, redo and clear are the shared canvas's: applied locally the moment they are sent, their echoes ignored. */
export function undoStroke(): void {
  scribbleCanvas.undo();
}

export function redoStroke(): void {
  scribbleCanvas.redo();
}

export function clearCanvas(): void {
  scribbleCanvas.clear();
}

export function rateDrawing(value: Rating): void {
  socket.send({ t: 'rate', value });
}
