import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { CanvasAction, DrawOp } from '@shared/platform/canvas';
import { applyOpsToActions } from './history';

/** A canvas's client state: the action history, and an epoch that tells the renderer to redraw from scratch. */
export interface CanvasState {
  canvas: CanvasAction[];
  /** Bumped whenever the canvas must be redrawn from scratch (undo, clear, resync, rejoin). */
  canvasEpoch: number;
  /** The drawer's own undone actions, newest last: what redo brings back. */
  redoable: CanvasAction[];
}

export interface CanvasActions {
  /** Replaces the history wholesale (welcome bootstrap, server resync). */
  setCanvas(actions: CanvasAction[]): void;
  /** Folds streamed ops (ours or a remote drawer's) into the history. */
  appendOps(ops: readonly DrawOp[]): void;
  /** Removes the last action; `keep` puts it on the redo stack (the drawer's own undo). */
  undo(keep?: boolean): void;
  /** Takes the newest undone action off the redo stack, for the session to draw again. */
  takeRedo(): CanvasAction | null;
  /** Forgets the redo stack (a new stroke). */
  dropRedo(): void;
  clear(): void;
  reset(): void;
}

export type CanvasStore = CanvasState & CanvasActions;
export type UseCanvasStore = UseBoundStore<StoreApi<CanvasStore>>;

/** One store per canvas session; a game keeps the instance for the lifetime of the page. */
export function createCanvasStore(): UseCanvasStore {
  return create<CanvasStore>()((set, get) => ({
    canvas: [],
    canvasEpoch: 0,
    redoable: [],
    setCanvas: (canvas) => set((s) => ({ canvas, canvasEpoch: s.canvasEpoch + 1, redoable: [] })),
    appendOps: (ops) => set((s) => ({ canvas: applyOpsToActions(s.canvas, ops) })),
    undo: (keep = false) =>
      set((s) => {
        const last = s.canvas[s.canvas.length - 1];
        return { canvas: s.canvas.slice(0, -1), canvasEpoch: s.canvasEpoch + 1, redoable: keep && last ? [...s.redoable, last] : s.redoable };
      }),
    takeRedo: () => {
      const { redoable } = get();
      const action = redoable[redoable.length - 1] ?? null;
      if (action) set({ redoable: redoable.slice(0, -1) });
      return action;
    },
    dropRedo: () => {
      if (get().redoable.length > 0) set({ redoable: [] });
    },
    clear: () => set((s) => ({ canvas: [], canvasEpoch: s.canvasEpoch + 1, redoable: [] })),
    reset: () => set((s) => ({ canvas: [], canvasEpoch: s.canvasEpoch + 1, redoable: [] })),
  }));
}
