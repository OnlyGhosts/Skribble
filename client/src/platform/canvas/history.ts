import type { CanvasAction, DrawOp } from '@shared/platform/canvas';

function findStroke(actions: readonly CanvasAction[], id: number): number {
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i];
    if (a.kind === 'stroke' && a.id === id) return i;
  }
  return -1;
}

/**
 * Folds streaming ops into the immutable action history (mirrors what the server keeps).
 * Strokes touched in this call are cloned once so a burst of 'move' ops stays linear.
 */
export function applyOpsToActions(actions: readonly CanvasAction[], ops: readonly DrawOp[]): CanvasAction[] {
  const next = actions.slice();
  const cloned = new Set<number>();
  for (const op of ops) {
    switch (op.k) {
      case 'start':
        next.push({ kind: 'stroke', id: op.id, tool: op.tool, color: op.color, size: op.size, points: [op.x, op.y] });
        cloned.add(next.length - 1);
        break;
      case 'move': {
        const i = findStroke(next, op.id);
        if (i < 0) break;
        const stroke = next[i];
        if (stroke.kind !== 'stroke') break;
        if (!cloned.has(i)) {
          next[i] = { ...stroke, points: stroke.points.slice() };
          cloned.add(i);
        }
        const target = next[i];
        if (target.kind === 'stroke') for (const v of op.pts) target.points.push(v);
        break;
      }
      case 'end': {
        const i = findStroke(next, op.id);
        if (i < 0) break;
        const stroke = next[i];
        if (stroke.kind === 'stroke' && !stroke.done) next[i] = { ...stroke, done: true };
        break;
      }
      case 'fill':
        next.push({ kind: 'fill', x: op.x, y: op.y, color: op.color });
        break;
    }
  }
  return next;
}

/** The highest stroke id in the history, or -1 on a blank canvas; a drawer never reuses an id the server already knows. */
export function maxStrokeId(actions: readonly CanvasAction[]): number {
  let max = -1;
  for (const a of actions) if (a.kind === 'stroke' && a.id > max) max = a.id;
  return max;
}

/**
 * The ops that draw `action` again as stroke `id` (a fresh id: the server never takes one twice).
 * Redo replays an undone action through the ordinary draw path, so every viewer and late joiner
 * gets it like any other stroke.
 */
export function opsForAction(action: CanvasAction, id: number): DrawOp[] {
  if (action.kind === 'fill') return [{ k: 'fill', x: action.x, y: action.y, color: action.color }];
  const [x = 0, y = 0, ...rest] = action.points;
  const ops: DrawOp[] = [{ k: 'start', id, tool: action.tool, color: action.color, size: action.size, x, y }];
  if (rest.length >= 2) ops.push({ k: 'move', id, pts: rest });
  ops.push({ k: 'end', id });
  return ops;
}
