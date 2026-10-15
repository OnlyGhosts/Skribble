/**
 * The platform's shared drawing canvas, for any game where someone draws and everyone watches
 * (Skribble today). The wire format lives in shared/platform/canvas.ts; this is the client half.
 *
 * A game wires it up in three steps:
 *
 * 1. Create one session for the lifetime of the page (a module-level constant in the game):
 *
 *      const canvas = createCanvasSession({
 *        link: { send: (m) => socket.send(m), isOpen: () => socket.isOpen() },
 *        // The key of the drawing turn this player is drawing in now, null when not drawing:
 *        // undo/clear echoes are ignored while drawing, and ops drawn offline are parked under it.
 *        myDrawingTurn: () => (iAmDrawing() ? `${code}:${round}:${turn}` : null),
 *      });
 *
 * 2. Hand the session the stream in the game module: `onServerMessage: canvas.handleServerMessage`,
 *    `onWelcome: canvas.onWelcome`, `onLeave: canvas.onLeave`; clear it at turn boundaries with
 *    `canvas.store.getState().clear()`.
 *
 * 3. Render `<GameCanvas session={canvas} canDraw settings footer={<Toolbar ... onUndo={canvas.undo} onRedo={canvas.redo} onClear={canvas.clear} />} />`
 *    in the screen; `canvas.store((s) => s.canvas.length > 0)` tells whether there is anything to undo.
 *
 * Coordinates are logical canvas pixels (CANVAS_WIDTH x CANVAS_HEIGHT); the canvas scales to fit
 * its stage at 4:3 and the stylesheet (canvas.css) brings the toolbar's 44px phone targets.
 */
export { GameCanvas } from './GameCanvas';
export { Toolbar } from './Toolbar';
export { BucketIcon, EraserIcon, PencilIcon, RedoIcon, TrashIcon, UndoIcon } from './Icons';
export { createCanvasSession, type CanvasSession, type CanvasSessionOptions } from './session';
export { createCanvasStore, type CanvasStore, type UseCanvasStore } from './store';
export { DrawQueue, MAX_OFFLINE_OPS, type DrawLink } from './drawQueue';
export { useDrawing, DEFAULT_DRAWING_SETTINGS, type DrawingSettings, type DrawTool } from './useDrawing';
export { CanvasRenderer, clampDpr, drawStroke, ERASER_COLOR, FILL_TOLERANCE, type CanvasSource, type RendererOptions } from './renderer';
export { floodFillImage, hexToRgb, paintSpans, type FillSpans, type PixelImage } from './floodFill';
export { applyOpsToActions, maxStrokeId, opsForAction } from './history';
