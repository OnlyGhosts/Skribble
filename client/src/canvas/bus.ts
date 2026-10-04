import type { DrawOp } from '@shared/protocol';

type Listener = (ops: readonly DrawOp[]) => void;
const listeners = new Set<Listener>();

/**
 * Incoming remote draw ops are rendered incrementally rather than by diffing the store's action
 * list; the store publishes them here and the mounted canvas subscribes.
 */
export const canvasBus = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  emit(ops: readonly DrawOp[]): void {
    for (const listener of listeners) listener(ops);
  },
};
