import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { CanvasAction, DrawOp } from '@shared/platform/canvas';
import { applyOpsToActions } from './history';

/** A canvas's client state: the action history, and an epoch that tells the renderer to redraw from scratch. */
export interface CanvasState {
  canvas: CanvasAction[];
  /** Bumped whenever the canvas must be redrawn from scratch (undo, clear, resync, rejoin). */
  canvasEpoch: number;
}

export interface CanvasActions {
  /** Replaces the history wholesale (welcome bootstrap, server resync). */
  setCanvas(actions: CanvasAction[]): void;
  /** Folds streamed ops (ours or a remote drawer's) into the history. */
  appendOps(ops: readonly DrawOp[]): void;
  undo(): void;
  clear(): void;
  reset(): void;
}

export type CanvasStore = CanvasState & CanvasActions;
export type UseCanvasStore = UseBoundStore<StoreApi<CanvasStore>>;

/** One store per canvas session; a game keeps the instance for the lifetime of the page. */
export function createCanvasStore(): UseCanvasStore {
  return create<CanvasStore>()((set) => ({
    canvas: [],
    canvasEpoch: 0,
    setCanvas: (canvas) => set((s) => ({ canvas, canvasEpoch: s.canvasEpoch + 1 })),
    appendOps: (ops) => set((s) => ({ canvas: applyOpsToActions(s.canvas, ops) })),
    undo: () => set((s) => ({ canvas: s.canvas.slice(0, -1), canvasEpoch: s.canvasEpoch + 1 })),
    clear: () => set((s) => ({ canvas: [], canvasEpoch: s.canvasEpoch + 1 })),
    reset: () => set((s) => ({ canvas: [], canvasEpoch: s.canvasEpoch + 1 })),
  }));
}
