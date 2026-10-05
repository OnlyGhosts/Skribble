import { create } from 'zustand';
import type { CanvasAction, DrawOp } from '@shared/games/skribble/protocol';
import { applyOpsToActions } from './canvas/history';

/** Skribble's own client state: the canvas history and the guesser's half-typed word. */
interface SkribbleState {
  canvas: CanvasAction[];
  /** Bumped whenever the canvas must be redrawn from scratch (undo, clear, resync, rejoin). */
  canvasEpoch: number;
  /** What the guesser has typed into the word tiles but not sent yet; reset every turn. */
  guessDraft: string;
}

interface SkribbleActions {
  /** Replaces the history wholesale (welcome bootstrap, server resync). */
  setCanvas(actions: CanvasAction[]): void;
  /** Folds streamed ops (ours or a remote drawer's) into the history. */
  appendOps(ops: readonly DrawOp[]): void;
  undo(): void;
  clear(): void;
  setGuessDraft(draft: string): void;
  reset(): void;
}

export type SkribbleStore = SkribbleState & SkribbleActions;

export const useSkribbleStore = create<SkribbleStore>()((set) => ({
  canvas: [],
  canvasEpoch: 0,
  guessDraft: '',

  setCanvas: (canvas) => set((s) => ({ canvas, canvasEpoch: s.canvasEpoch + 1 })),
  appendOps: (ops) => set((s) => ({ canvas: applyOpsToActions(s.canvas, ops) })),
  undo: () => set((s) => ({ canvas: s.canvas.slice(0, -1), canvasEpoch: s.canvasEpoch + 1 })),
  clear: () => set((s) => ({ canvas: [], canvasEpoch: s.canvasEpoch + 1 })),
  setGuessDraft: (guessDraft) => set({ guessDraft }),
  reset: () => set((s) => ({ canvas: [], canvasEpoch: s.canvasEpoch + 1, guessDraft: '' })),
}));
