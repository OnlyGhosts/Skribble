import { CANVAS_SIDE_MESSAGE_TYPES, isCanvasWelcomeExtra, type CanvasServerMessage, type DrawOp } from '@shared/platform/canvas';
import type { WireMessage } from '@shared/platform/protocol';
import { DrawQueue, type DrawLink } from './drawQueue';
import { maxStrokeId, opsForAction } from './history';
import { createCanvasStore, type UseCanvasStore } from './store';

type Listener = (ops: readonly DrawOp[]) => void;

export interface CanvasSessionOptions {
  /** The socket the drawer's ops go out on. */
  link: DrawLink;
  /**
   * Identifies the drawing turn this player is drawing in right now (room, round, turn, drawer),
   * or null when they are not the one drawing: it keys the ops parked during an outage.
   */
  myDrawingTurn(): string | null;
}

/**
 * Everything a game needs around one canvas on the client: the history store the screen renders
 * from, the queue that batches the drawer's ops, and the handling of the shared canvas stream.
 * The local drawer applies undo/clear the moment they are sent and ignores the server's echoes:
 * by the time an echo arrives they may have started a new stroke, so applying it against the
 * current list would remove the wrong one.
 */
export interface CanvasSession {
  store: UseCanvasStore;
  queue: DrawQueue;
  /** Incoming ops, for the mounted canvas to render incrementally rather than by diffing the history. */
  subscribe(listener: Listener): () => void;
  /** The drawer's own ops: into the history, to the mounted canvas, and onto the wire. */
  draw(ops: readonly DrawOp[]): void;
  /** A stroke id the server has not seen on this canvas: above every id in the history and every id handed out. */
  nextStrokeId(): number;
  /** Removes the drawer's last action and keeps it for redo. */
  undo(): void;
  /** Draws the last undone action again, as a new stroke. */
  redo(): void;
  clear(): void;
  /** A server message that may belong to the canvas stream; returns true when it did. */
  handleServerMessage(msg: WireMessage): boolean;
  /** `welcome.extra` (the canvas history) plus any ops parked during the outage for the turn the rejoin landed in. */
  onWelcome(extra: unknown): void;
  /** The room is being left: flush what must still go out, drop the rest. */
  onLeave(): void;
}

const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set([...CANVAS_SIDE_MESSAGE_TYPES, 'canvas']);

export function createCanvasSession(options: CanvasSessionOptions): CanvasSession {
  const store = createCanvasStore();
  const queue = new DrawQueue(options.link, options.myDrawingTurn);
  const listeners = new Set<Listener>();
  const emit = (ops: readonly DrawOp[]): void => {
    for (const listener of listeners) listener(ops);
  };
  const isLocalDrawer = (): boolean => options.myDrawingTurn() !== null;
  // After a reload the counter restarts, but the server still holds the canvas (restored into the
  // store), so an id is never below the history's highest.
  let strokeCounter = 0;
  const nextStrokeId = (): number => {
    const id = Math.max(strokeCounter, maxStrokeId(store.getState().canvas) + 1);
    strokeCounter = id + 1;
    return id;
  };
  const draw = (ops: readonly DrawOp[]): void => {
    store.getState().appendOps(ops);
    emit(ops);
    queue.queue(ops);
  };

  return {
    store,
    queue,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    draw,
    nextStrokeId,
    undo() {
      queue.flush();
      if (options.link.send({ t: 'undo' })) store.getState().undo(true);
    },
    redo() {
      if (!options.link.isOpen()) return;
      const action = store.getState().takeRedo();
      if (!action) return;
      draw(opsForAction(action, nextStrokeId()));
      queue.flush();
    },
    clear() {
      queue.flush();
      if (options.link.send({ t: 'clear' })) store.getState().clear();
    },
    handleServerMessage(raw) {
      if (!SERVER_MESSAGE_TYPES.has(raw.t)) return false;
      // The server is trusted on shape; only the discriminator is checked here.
      const msg = raw as CanvasServerMessage;
      const s = store.getState();
      switch (msg.t) {
        case 'draw':
          s.appendOps(msg.ops);
          emit(msg.ops);
          break;
        case 'undo':
          if (!isLocalDrawer()) s.undo();
          break;
        case 'clear':
          if (!isLocalDrawer()) s.clear();
          break;
        case 'canvas':
          s.setCanvas(msg.actions);
          break;
      }
      return true;
    },
    onWelcome(extra) {
      store.getState().setCanvas(isCanvasWelcomeExtra(extra) ? extra.canvas : []);
      const restored = queue.resumeOfflineOps(options.myDrawingTurn());
      if (restored.length > 0) store.getState().appendOps(restored);
    },
    onLeave() {
      queue.flush();
      queue.dropOffline();
      store.getState().reset();
    },
  };
}
