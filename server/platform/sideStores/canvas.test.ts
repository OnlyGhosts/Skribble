/** The platform's canvas side store, driven through Skribble's policy (the drawer draws during their turn). */
import { describe, expect, it } from 'vitest';
import { MAX_ACTIONS_PER_TURN, MAX_POINTS_PER_STROKE, type CanvasClientMessage, type DrawOp } from '../../../shared/platform/canvas.js';
import { skribbleCanvasPolicy } from '../../games/skribble/canvas.js';
import type { SkribbleData } from '../../games/skribble/state.js';
import type { SideRoom } from '../game.js';
import { MemoryStorage, type GameStorage } from '../storage.js';
import { CanvasHistory, CanvasStore, admitOp, createCanvasStore, emptyCounts, replayOps, type CanvasPolicy } from './canvas.js';

const newStore = (storage: GameStorage): CanvasStore<SkribbleData, CanvasClientMessage> => new CanvasStore(storage, skribbleCanvasPolicy);

const start = (id: number): DrawOp => ({ k: 'start', id, tool: 'brush', color: '#ff0000', size: 6, x: 10, y: 20 });
const move = (id: number, n = 2): DrawOp => ({ k: 'move', id, pts: new Array<number>(n).fill(1) });

function room(canvasId = 'canvas-1', drawerId = 'alice', endsAt = 10_000): SideRoom<SkribbleData> {
  const game: SkribbleData = {
    phase: { kind: 'drawing' },
    turn: { drawerId, choices: [], word: 'apple', startedAt: 0, endsAt, revealOrder: [], revealAt: [], revealed: [], correct: 0, guesserIds: [], guessed: [drawerId], points: {}, ratings: {} },
    canvasId,
    round: 1,
    turnQueue: [drawerId],
    turnIndex: 0,
    usedWords: [],
    grace: { drawerGoneAt: null, allGuessedAt: null },
  };
  return { code: 'ABCD', phase: 'playing', game, players: [{ id: drawerId, name: 'Alice', joinOrder: 0, connected: true, score: 0 }, { id: 'bob', name: 'Bob', joinOrder: 1, connected: true, score: 0 }] };
}

/** Unwraps a MaybePromise that the memory storage answers synchronously. */
function sync<T>(value: T | Promise<T>): T {
  if (value instanceof Promise) throw new Error('expected a synchronous answer');
  return value;
}

describe('admitOp', () => {
  it('applies the caps op by op and truncates oversized moves to whole points', () => {
    const counts = emptyCounts();
    expect(admitOp(start(1), counts)).toEqual(start(1));
    expect(admitOp(start(1), counts)).toBeNull(); // duplicate id
    expect(admitOp(move(2), counts)).toBeNull(); // unknown stroke
    expect(admitOp({ k: 'end', id: 2 }, counts)).toBeNull();
    const big = move(1, MAX_POINTS_PER_STROKE);
    const kept = admitOp(big, counts);
    expect(kept && kept.k === 'move' ? kept.pts.length : 0).toBe(MAX_POINTS_PER_STROKE - 2);
    expect(admitOp(move(1), counts)).toBeNull(); // the stroke is full
    expect(counts).toMatchObject({ actions: 1, points: MAX_POINTS_PER_STROKE });
    for (let i = 1; i < MAX_ACTIONS_PER_TURN; i++) expect(admitOp({ k: 'fill', x: i, y: 0, color: '#000000' }, counts)).not.toBeNull();
    expect(admitOp({ k: 'fill', x: 0, y: 0, color: '#000000' }, counts)).toBeNull();
    expect(replayOps([start(1), move(1, 4), { k: 'end', id: 1 }])).toEqual([{ kind: 'stroke', id: 1, tool: 'brush', color: '#ff0000', size: 6, points: [10, 20, 1, 1, 1, 1], done: true }]);
  });
});

describe('CanvasStore over MemoryStorage', () => {
  it('stores batches per action, undoes whole actions across read chunks and replays the same history as CanvasHistory', () => {
    const storage = new MemoryStorage();
    const store = newStore(storage);
    const reference = new CanvasHistory();
    const r = room();
    storage.reset('ABCD', null, 'canvas-1');

    // One stroke fed in 12 small batches: the undo must walk back past the 8-item chunk boundary.
    const ops: DrawOp[][] = [[start(1)]];
    for (let i = 0; i < 11; i++) ops.push([move(1, 2)]);
    ops.push([{ k: 'fill', x: 1, y: 1, color: '#00ff00' }]);
    for (const batch of ops) {
      reference.append(batch);
      const out = sync(store.handleMessage(r, 'alice', { t: 'draw', ops: batch }, 0));
      expect(out.ok).toBe(true);
    }
    expect(storage.length('ABCD')).toBe(13);
    expect(sync(store.load('ABCD')).actions).toEqual(reference.all());
    expect(sync(store.welcomeExtra(r))).toEqual({ extra: { canvas: reference.all() }, seq: 14 });

    expect(sync(store.handleMessage(r, 'alice', { t: 'undo' }, 0))).toMatchObject({ ok: true, seq: 15, sends: [{ to: 'all', msg: { t: 'undo' } }] });
    reference.undo();
    expect(sync(store.handleMessage(r, 'alice', { t: 'undo' }, 0))).toMatchObject({ ok: true, seq: 16 });
    reference.undo();
    expect(sync(store.load('ABCD')).actions).toEqual([]);
    expect(storage.state('ABCD').hash).toEqual({ stamp: 'canvas-1', actions: '0', points: '0' });
    // Nothing left: undo is a no-op nobody hears about.
    expect(sync(store.handleMessage(r, 'alice', { t: 'undo' }, 0))).toEqual({ ok: true, seq: 0, sends: [] });
  });

  it('authorises only the drawer, refuses stale stamps silently and resyncs a drawer whose input was cut', () => {
    const storage = new MemoryStorage();
    const store = newStore(storage);
    const r = room();
    storage.reset('ABCD', null, 'canvas-1');
    expect(sync(store.handleMessage(r, 'bob', { t: 'draw', ops: [start(1)] }, 0))).toEqual({ ok: false, message: 'Only the drawer can draw right now.' });
    // Messages that are not canvas messages are not the store's business.
    expect(sync(store.handleMessage(r, 'alice', { t: 'rate' } as unknown as CanvasClientMessage, 0))).toEqual({ ok: false, message: null });
    // The drawer after their deadline: in-flight ops, dropped without a word.
    expect(sync(store.handleMessage(r, 'alice', { t: 'draw', ops: [start(1)] }, 10_000))).toEqual({ ok: false, message: null });
    expect(sync(store.resync(r, 'alice', 10_000))).toBeNull();

    storage.reset('ABCD', null, 'canvas-2');
    expect(sync(store.handleMessage(r, 'alice', { t: 'draw', ops: [start(1)] }, 0))).toEqual({ ok: true, seq: 0, sends: [] });
    expect(sync(store.handleMessage(r, 'alice', { t: 'clear' }, 0))).toEqual({ ok: true, seq: 0, sends: [] });
    expect(storage.length('ABCD')).toBe(0);

    storage.reset('ABCD', null, 'canvas-1');
    const out = sync(store.handleMessage(r, 'alice', { t: 'draw', ops: [start(1), move(1, MAX_POINTS_PER_STROKE), move(1, 2)] }, 0));
    expect(out).toMatchObject({ ok: true, resync: 'alice' });
    expect(out.ok && out.sends[0].to).toEqual({ except: ['alice'] });
    const resync = sync(store.resync(r, 'alice', 0));
    expect(resync?.msg).toMatchObject({ t: 'canvas' });
    expect(resync && resync.msg.t === 'canvas' && resync.msg.actions[0].kind === 'stroke' ? resync.msg.actions[0].points.length : 0).toBe(MAX_POINTS_PER_STROKE);
  });

  it('retries when another writer gets in between the read and the write', async () => {
    const inner = new MemoryStorage();
    let attempts = 0;
    // A storage whose first two appends fail the way a concurrent Redis writer would make them fail.
    const flaky: GameStorage = {
      ...inner,
      state: (code) => Promise.resolve(inner.state(code)),
      list: (code) => inner.list(code),
      length: (code) => inner.length(code),
      range: (code, a, b) => inner.range(code, a, b),
      append: (code, seq, items, fields) => (++attempts <= 2 ? 'conflict' : inner.append(code, seq, items, fields)),
      pop: (code, seq, count, inc, del) => inner.pop(code, seq, count, inc, del),
      reset: (code, seq, stamp) => inner.reset(code, seq, stamp),
      drop: (code) => inner.drop(code),
    };
    const store = createCanvasStore<SkribbleData, CanvasClientMessage>(skribbleCanvasPolicy)(flaky);
    inner.reset('ABCD', null, 'canvas-1');
    const out = await store.handleMessage(room(), 'alice', { t: 'draw', ops: [start(1)] }, 0);
    expect(out).toMatchObject({ ok: true, seq: 2 });
    expect(attempts).toBe(3);
    expect(inner.length('ABCD')).toBe(1);
  });
});

describe('CanvasStore segments', () => {
  /** A game whose canvas is drawn in numbered segments (Hangman's figure sections). */
  interface Segmented {
    canvasId: string;
    segment: number;
  }
  const policy: CanvasPolicy<Segmented> = { stamp: (game) => game?.canvasId ?? '', check: () => 'ok', forbiddenMessage: 'no', segment: (game) => (game ? `s${game.segment}` : '') };
  const segRoom = (segment: number): SideRoom<Segmented> => ({ code: 'ABCD', phase: 'playing', game: { canvasId: 'c1', segment }, players: [] });

  it('undo and clear stop at the start of the current segment; the first segment clears like a plain canvas', () => {
    const storage = new MemoryStorage();
    const store = new CanvasStore<Segmented, CanvasClientMessage>(storage, policy);
    const reference = new CanvasHistory();
    storage.reset('ABCD', null, 'c1');

    // Segment 1: two strokes, then clear empties the canvas (it began on an empty one).
    for (const batch of [[start(1)], [move(1, 4)], [start(2)]]) {
      reference.append(batch);
      expect(sync(store.handleMessage(segRoom(1), 'alice', { t: 'draw', ops: batch }, 0)).ok).toBe(true);
    }
    expect(storage.state('ABCD').hash).toMatchObject({ segment: 's1', floor: '0', actions: '2' });
    expect(sync(store.handleMessage(segRoom(1), 'alice', { t: 'clear' }, 0))).toMatchObject({ ok: true, sends: [{ to: 'all', msg: { t: 'clear' } }] });
    expect(sync(store.load('ABCD')).actions).toEqual([]);
    reference.clear();

    // Segment 1 again: one stroke and a fill stay for good once segment 2 begins.
    for (const batch of [[start(3)], [move(3, 6)], [{ k: 'fill', x: 1, y: 1, color: '#00ff00' } as DrawOp]]) {
      reference.append(batch);
      sync(store.handleMessage(segRoom(1), 'alice', { t: 'draw', ops: batch }, 0));
    }
    const kept = reference.all();

    // Segment 2 before any drawing: nothing to undo or clear, and nobody hears about it.
    expect(sync(store.handleMessage(segRoom(2), 'alice', { t: 'undo' }, 0))).toEqual({ ok: true, seq: 0, sends: [] });
    expect(sync(store.handleMessage(segRoom(2), 'alice', { t: 'clear' }, 0))).toEqual({ ok: true, seq: 0, sends: [] });
    expect(sync(store.load('ABCD')).actions).toEqual(kept);

    // Segment 2: three strokes fed in small batches (the walk back crosses a chunk boundary), then one undo and a clear.
    const ops: DrawOp[][] = [[start(4)]];
    for (let i = 0; i < 9; i++) ops.push([move(4, 2)]);
    ops.push([start(5)], [move(5, 2)], [start(6)]);
    for (const batch of ops) {
      reference.append(batch);
      sync(store.handleMessage(segRoom(2), 'alice', { t: 'draw', ops: batch }, 0));
    }
    expect(storage.state('ABCD').hash).toMatchObject({ segment: 's2', floor: '2', actions: '5' });
    expect(sync(store.handleMessage(segRoom(2), 'alice', { t: 'undo' }, 0))).toMatchObject({ ok: true, sends: [{ to: 'all', msg: { t: 'undo' } }] });
    reference.undo();
    expect(sync(store.load('ABCD')).actions).toEqual(reference.all());
    // Clearing the segment removes its remaining two actions as two undos on the wire.
    const cleared = sync(store.handleMessage(segRoom(2), 'alice', { t: 'clear' }, 0));
    expect(cleared).toMatchObject({
      ok: true,
      sends: [
        { to: 'all', msg: { t: 'undo' } },
        { to: 'all', msg: { t: 'undo' } },
      ],
    });
    expect(sync(store.load('ABCD')).actions).toEqual(kept);
    expect(storage.state('ABCD').hash).toEqual({ stamp: 'c1', segment: 's2', floor: '2', actions: '2', points: '8', 's:3': '8' });
    // The segment is empty again: a further undo would reach into segment 1 and is refused.
    expect(sync(store.handleMessage(segRoom(2), 'alice', { t: 'undo' }, 0))).toEqual({ ok: true, seq: 0, sends: [] });

    // Segment 3 starts on top of the kept actions; its clear leaves them alone too.
    sync(store.handleMessage(segRoom(3), 'alice', { t: 'draw', ops: [start(7)] }, 0));
    // A rejoining drawer learns where the segment began from the welcome, so their own clear stops there as well.
    expect(sync(store.welcomeExtra(segRoom(3))).extra).toEqual({
      canvas: [
        ...kept,
        {
          kind: 'stroke',
          id: 7,
          tool: 'brush',
          color: '#ff0000',
          size: 6,
          points: [10, 20],
        },
      ],
      floor: 2,
    });
    expect(sync(store.handleMessage(segRoom(3), 'alice', { t: 'clear' }, 0))).toMatchObject({ ok: true, sends: [{ to: 'all', msg: { t: 'undo' } }] });
    expect(sync(store.load('ABCD')).actions).toEqual(kept);
    // An untouched segment's floor is the whole canvas; a plain canvas (no segments) carries no floor.
    expect(sync(store.welcomeExtra(segRoom(4))).extra).toEqual({ canvas: kept, floor: 2 });
  });
});
