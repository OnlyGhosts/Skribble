/** Skribble's canvas: the platform's canvas side store, authorised for the drawer during their turn. */
import type { SkribbleClientMessage } from '../../../shared/games/skribble/protocol.js';
import { createCanvasStore, type CanvasPolicy } from '../../platform/sideStores/canvas.js';
import { NOT_DRAWER_MESSAGE, drawerCheck, type SkribbleData } from './state.js';

export const skribbleCanvasPolicy: CanvasPolicy<SkribbleData> = {
  stamp: (game) => game?.canvasId ?? '',
  check: (game, playerId, now) => (game ? drawerCheck(game, playerId, now) : 'silent'),
  forbiddenMessage: NOT_DRAWER_MESSAGE,
};

export const createSkribbleCanvasStore = createCanvasStore<SkribbleData, SkribbleClientMessage>(skribbleCanvasPolicy);
