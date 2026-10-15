import { describe, expect, it } from 'vitest';
import type { CanvasClientMessage, DrawOp } from '@shared/platform/canvas';
import { opsForAction } from './history';
import { createCanvasSession } from './session';

/** A session on a recording link, as the drawer of turn 't1'. */
function drawer(open = true) {
  const sent: CanvasClientMessage[] = [];
  const link = { send: (m: CanvasClientMessage) => (open ? (sent.push(m), true) : false), isOpen: () => open };
  const session = createCanvasSession({ link, myDrawingTurn: () => 't1' });
  return { session, sent };
}

const stroke = (id: number): DrawOp[] => [
  { k: 'start', id, tool: 'brush', color: '#000000', size: 6, x: 10, y: 10 },
  { k: 'move', id, pts: [20, 20, 30, 30] },
  { k: 'end', id },
];

const drawnOps = (sent: CanvasClientMessage[]): DrawOp[] => sent.flatMap((m) => (m.t === 'draw' ? m.ops : []));

describe('canvas redo', () => {
  it('brings the last undone stroke back as a new stroke everyone receives', () => {
    const { session, sent } = drawer();
    session.draw(stroke(session.nextStrokeId()));
    session.draw(stroke(session.nextStrokeId()));
    session.undo();
    expect(session.store.getState().canvas).toHaveLength(1);
    expect(session.store.getState().redoable).toHaveLength(1);

    session.redo();
    const { canvas, redoable } = session.store.getState();
    expect(canvas).toHaveLength(2);
    expect(redoable).toHaveLength(0);
    const back = canvas[1];
    // A fresh id: the server never takes the undone stroke's id twice.
    expect(back.kind === 'stroke' && back.id).toBe(2);
    expect(back.kind === 'stroke' && back.points).toEqual([10, 10, 20, 20, 30, 30]);
    const starts = drawnOps(sent).filter((op) => op.k === 'start');
    expect(starts.map((op) => op.k === 'start' && op.id)).toEqual([0, 1, 2]);
  });

  it('redoes in reverse order of the undos, and a new stroke or a clear forgets them', () => {
    const { session } = drawer();
    for (let i = 0; i < 3; i++) session.draw(stroke(session.nextStrokeId()));
    session.undo();
    session.undo();
    expect(session.store.getState().redoable).toHaveLength(2);
    session.redo();
    expect(session.store.getState().redoable).toHaveLength(1);
    session.store.getState().dropRedo();
    expect(session.store.getState().redoable).toHaveLength(0);
    session.undo();
    session.clear();
    expect(session.store.getState().redoable).toHaveLength(0);
  });

  it('keeps nothing for redo from a remote undo, and offers nothing while offline', () => {
    const remote = createCanvasSession({ link: { send: () => true, isOpen: () => true }, myDrawingTurn: () => null });
    remote.handleServerMessage({ t: 'draw', ops: stroke(0) });
    remote.handleServerMessage({ t: 'undo' });
    expect(remote.store.getState().canvas).toHaveLength(0);
    expect(remote.store.getState().redoable).toHaveLength(0);

    const { session, sent } = drawer(false);
    session.store.getState().setCanvas([{ kind: 'fill', x: 1, y: 1, color: '#ff0000' }]);
    session.store.setState({ redoable: [{ kind: 'fill', x: 2, y: 2, color: '#00ff00' }] });
    session.redo();
    expect(session.store.getState().redoable).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it('replays a fill as a fill and a dot as a start and an end', () => {
    expect(opsForAction({ kind: 'fill', x: 3, y: 4, color: '#123456' }, 9)).toEqual([{ k: 'fill', x: 3, y: 4, color: '#123456' }]);
    expect(opsForAction({ kind: 'stroke', id: 1, tool: 'eraser', color: '#000000', size: 12, points: [5, 6], done: true }, 7)).toEqual([
      { k: 'start', id: 7, tool: 'eraser', color: '#000000', size: 12, x: 5, y: 6 },
      { k: 'end', id: 7 },
    ]);
  });
});
