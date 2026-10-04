import { MAX_ACTIONS_PER_TURN, MAX_POINTS_PER_STROKE, MAX_POINTS_PER_TURN } from '../shared/constants';
import type { CanvasAction, DrawOp } from '../shared/protocol';

export interface AppendResult {
  /** The ops to forward to viewers: dropped ops are missing, oversized moves are cut short. */
  accepted: DrawOp[];
  /** True when something the drawer drew locally did not make it into the history (an 'end' for an unknown stroke is not a loss). */
  truncated: boolean;
}

export interface CanvasStats {
  actions: number;
  /** Flat coordinate numbers across every stroke. */
  points: number;
}

/**
 * The canvas history of one room: what late joiners replay and what undo pops. Bounded by the
 * MAX_* caps so a maxed-out turn still fits in one `welcome`.
 */
export interface CanvasStore {
  append(ops: readonly DrawOp[]): AppendResult;
  /** Removes the most recent action; null when the canvas is empty. */
  undo(): CanvasAction | null;
  clear(): void;
  /** Deep copies, safe to send. */
  all(): CanvasAction[];
  stats(): CanvasStats;
}

/**
 * What the caps need to know about a canvas, without the coordinates themselves: the action and
 * point totals plus the point count of every stroke (keyed by stroke id). Both the in-memory
 * store and the Redis store (which keeps these in a hash) admit ops through `admitOp`.
 */
export interface CanvasCounts {
  actions: number;
  points: number;
  strokes: Map<number, number>;
}

export function emptyCounts(): CanvasCounts {
  return { actions: 0, points: 0, strokes: new Map() };
}

/**
 * Applies the caps to one op, updating `counts`. Returns the op to keep (a 'move' may be cut
 * short), or null to drop it. This is the single source of truth for what a canvas accepts.
 */
export function admitOp(op: DrawOp, counts: CanvasCounts): DrawOp | null {
  switch (op.k) {
    case 'start': {
      if (counts.actions >= MAX_ACTIONS_PER_TURN || counts.strokes.has(op.id)) return null;
      if (counts.points + 2 > MAX_POINTS_PER_TURN) return null;
      counts.actions += 1;
      counts.points += 2;
      counts.strokes.set(op.id, 2);
      return op;
    }
    case 'move': {
      const have = counts.strokes.get(op.id);
      if (have === undefined) return null;
      const room = Math.min(MAX_POINTS_PER_STROKE - have, MAX_POINTS_PER_TURN - counts.points);
      if (room < 2) return null;
      const pts = op.pts.length > room ? op.pts.slice(0, room - (room % 2)) : op.pts;
      counts.strokes.set(op.id, have + pts.length);
      counts.points += pts.length;
      return pts === op.pts ? op : { ...op, pts };
    }
    case 'end':
      return counts.strokes.has(op.id) ? op : null;
    case 'fill': {
      if (counts.actions >= MAX_ACTIONS_PER_TURN) return null;
      counts.actions += 1;
      return op;
    }
  }
}

/** True for the ops that begin a new canvas action. */
export function startsAction(op: DrawOp): boolean {
  return op.k === 'start' || op.k === 'fill';
}

type StrokeAction = Extract<CanvasAction, { kind: 'stroke' }>;

export class MemoryCanvasStore implements CanvasStore {
  private actions: CanvasAction[] = [];
  private strokes = new Map<number, StrokeAction>();
  private counts = emptyCounts();

  append(ops: readonly DrawOp[]): AppendResult {
    const accepted: DrawOp[] = [];
    let truncated = false;
    for (const op of ops) {
      const kept = admitOp(op, this.counts);
      if (kept) {
        this.apply(kept);
        accepted.push(kept);
      }
      if (kept !== op && op.k !== 'end') truncated = true;
    }
    return { accepted, truncated };
  }

  undo(): CanvasAction | null {
    const last = this.actions.pop();
    if (!last) return null;
    this.counts.actions -= 1;
    if (last.kind === 'stroke') {
      this.strokes.delete(last.id);
      this.counts.strokes.delete(last.id);
      this.counts.points -= last.points.length;
    }
    return last;
  }

  clear(): void {
    this.actions = [];
    this.strokes = new Map();
    this.counts = emptyCounts();
  }

  all(): CanvasAction[] {
    return this.actions.map((a) => (a.kind === 'stroke' ? { ...a, points: [...a.points] } : { ...a }));
  }

  stats(): CanvasStats {
    return { actions: this.counts.actions, points: this.counts.points };
  }

  /** Folds an already admitted op into the action list. */
  private apply(op: DrawOp): void {
    switch (op.k) {
      case 'start': {
        const stroke: StrokeAction = { kind: 'stroke', id: op.id, tool: op.tool, color: op.color, size: op.size, points: [op.x, op.y] };
        this.actions.push(stroke);
        this.strokes.set(op.id, stroke);
        return;
      }
      case 'move':
        this.strokes.get(op.id)?.points.push(...op.pts);
        return;
      case 'end': {
        const stroke = this.strokes.get(op.id);
        if (stroke) stroke.done = true;
        return;
      }
      case 'fill':
        this.actions.push({ kind: 'fill', x: op.x, y: op.y, color: op.color });
        return;
    }
  }
}

/** Rebuilds the action history from a stream of ops that were already admitted by the caps. */
export function replayOps(ops: readonly DrawOp[]): CanvasAction[] {
  const store = new MemoryCanvasStore();
  store.append(ops);
  return store.all();
}
