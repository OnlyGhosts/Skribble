/** Scribble's canvas: the platform's canvas side store, authorised for the drawer during their turn. */
import type { ScribbleClientMessage } from '../../../shared/games/scribble/protocol.js';
import { createCanvasStore, type CanvasPolicy } from '../../platform/sideStores/canvas.js';
import { NOT_DRAWER_MESSAGE, drawerCheck, type ScribbleData } from './state.js';

export const scribbleCanvasPolicy: CanvasPolicy<ScribbleData> = {
  stamp: (game) => game?.canvasId ?? '',
  check: (game, playerId, now) => (game ? drawerCheck(game, playerId, now) : 'silent'),
  forbiddenMessage: NOT_DRAWER_MESSAGE,
};

export const createScribbleCanvasStore = createCanvasStore<ScribbleData, ScribbleClientMessage>(scribbleCanvasPolicy);
