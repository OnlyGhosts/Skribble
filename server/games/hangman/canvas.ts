/**
 * Hangman's canvas: the platform's canvas side store, authorised for the hangman during a drawing
 * step. Each figure section is a segment, so clear (and undo) only touch the section being drawn.
 */
import type { HangmanClientMessage } from '../../../shared/games/hangman/protocol.js';
import { createCanvasStore, type CanvasPolicy } from '../../platform/sideStores/canvas.js';
import { NOT_HANGMAN_MESSAGE, drawCheck, type HangmanData } from './state.js';

export const hangmanCanvasPolicy: CanvasPolicy<HangmanData> = {
  stamp: (game) => game?.canvasId ?? '',
  check: (game, playerId, now) => (game ? drawCheck(game, playerId, now) : 'silent'),
  forbiddenMessage: NOT_HANGMAN_MESSAGE,
  segment: (game) => (game?.phase.kind === 'drawing' ? `section-${game.phase.section}` : ''),
};

export const createHangmanCanvasStore = createCanvasStore<HangmanData, HangmanClientMessage>(hangmanCanvasPolicy);
