import { socket } from '../../platform/net/socket';
import { hangmanCanvas } from './canvas';
import { useHangmanStore } from './store';

export function chooseWord(index: number): void {
  socket.send({ t: 'chooseWord', index });
}

export function sendCustomWord(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return socket.send({ t: 'customWord', text: trimmed });
}

export function guessLetter(letter: string): void {
  socket.send({ t: 'letter', letter: letter.toUpperCase() });
}

export function guessWord(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return socket.send({ t: 'word', text: trimmed });
}

export function drawDone(): void {
  socket.send({ t: 'drawDone' });
}

/** Strokes of the section being drawn: the only ones undo and clear may touch. */
export function sectionStrokes(): number {
  return hangmanCanvas.store.getState().canvas.length - useHangmanStore.getState().sectionFloor;
}

export function undoStroke(): void {
  if (sectionStrokes() > 0) hangmanCanvas.undo();
}

/**
 * Clears the current section only. The server answers a section clear with one undo per removed
 * stroke, which the drawer's own session ignores (as it does every echo of its own undo/clear), so
 * the local history walks back to the section's floor here, the moment the clear is sent.
 */
export function clearSection(): void {
  if (sectionStrokes() <= 0) return;
  hangmanCanvas.queue.flush();
  if (!socket.send({ t: 'clear' })) return;
  const store = hangmanCanvas.store.getState();
  store.setCanvas(store.canvas.slice(0, useHangmanStore.getState().sectionFloor));
}
