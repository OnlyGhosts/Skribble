import { beforeEach, describe, expect, it } from 'vitest';
import type { CanvasAction } from '@shared/protocol';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();

const { isChatAppend, useGameStore } = await import('./useGameStore');
const { chatLine, drawingPhase, resetStore, room, welcome } = await import('../test/fixtures');

const stroke = (id: number): CanvasAction => ({ kind: 'stroke', id, tool: 'brush', color: '#000000', size: 6, points: [1, 1, 2, 2], done: true });
const state = () => useGameStore.getState();

beforeEach(resetStore);

describe('isChatAppend', () => {
  it('recognises a single appended line', () => {
    const prev = [chatLine(1), chatLine(2)];
    const next = [...prev, chatLine(3, 'correct')];
    expect(isChatAppend(prev, next)).toBe(true);
  });

  it('recognises an append that trimmed the oldest line to stay within the cap', () => {
    const prev = [chatLine(1), chatLine(2), chatLine(3)];
    const next = [prev[1], prev[2], chatLine(4, 'correct')];
    expect(isChatAppend(prev, next)).toBe(true);
  });

  it('rejects a history replaced wholesale by a welcome, even when its last line is new', () => {
    const prev = [chatLine(1), chatLine(2)];
    const history = [chatLine(1), chatLine(2), chatLine(3, 'correct')]; // fresh objects from the wire
    expect(isChatAppend(prev, history)).toBe(false);
    expect(isChatAppend(prev, [chatLine(9, 'correct')])).toBe(false);
    expect(isChatAppend(prev, prev)).toBe(false);
    expect(isChatAppend(prev, [])).toBe(false);
  });
});

describe('messages after leaving', () => {
  it('ignores room, chat and canvas messages while not in a room', () => {
    state().handleServerMessage(welcome('bob', room()));
    state().resetRoom();
    state().handleServerMessage({ t: 'room', room: room() });
    state().handleServerMessage({ t: 'chat', message: chatLine(1) });
    state().handleServerMessage({ t: 'draw', ops: [{ k: 'start', id: 0, tool: 'brush', color: '#000000', size: 6, x: 1, y: 1 }] });
    state().handleServerMessage({ t: 'canvas', actions: [stroke(1)] });
    expect(state().room).toBeNull();
    expect(state().chat).toEqual([]);
    expect(state().canvas).toEqual([]);
  });

  it('still enters a room through welcome', () => {
    state().handleServerMessage(welcome('bob', room()));
    expect(state().room?.code).toBe('ABCD');
    state().handleServerMessage({ t: 'chat', message: chatLine(1) });
    expect(state().chat).toHaveLength(1);
  });
});

describe('welcome and the guess draft', () => {
  const turn = () => room({ round: 1, turn: 1, turnsInRound: 2, phase: drawingPhase('host') });

  it('keeps a half-typed guess across a rejoin into the same turn', () => {
    state().handleServerMessage(welcome('bob', turn()));
    state().setGuessDraft('ab');
    state().handleServerMessage(welcome('bob', turn()));
    expect(state().guessDraft).toBe('ab');
  });

  it('clears the draft when the rejoin lands in another turn or seat', () => {
    state().handleServerMessage(welcome('bob', turn()));
    state().setGuessDraft('ab');
    state().handleServerMessage(welcome('bob', room({ round: 1, turn: 2, turnsInRound: 2, phase: drawingPhase('bob') })));
    expect(state().guessDraft).toBe('');

    state().setGuessDraft('cd');
    state().handleServerMessage(welcome('carol', room({ round: 1, turn: 2, turnsInRound: 2, phase: drawingPhase('bob') })));
    expect(state().guessDraft).toBe('');
  });
});

describe('undo and clear', () => {
  const turn = (drawerId: string) => room({ round: 1, turn: 1, turnsInRound: 2, phase: drawingPhase(drawerId) });

  it('the drawer applies undo locally and ignores the echo, so a stroke started meanwhile survives', () => {
    state().handleServerMessage(welcome('bob', turn('bob')));
    state().appendLocalOps([
      { k: 'start', id: 1, tool: 'brush', color: '#000000', size: 6, x: 1, y: 1 },
      { k: 'end', id: 1 },
      { k: 'start', id: 2, tool: 'brush', color: '#000000', size: 6, x: 5, y: 5 },
      { k: 'end', id: 2 },
    ]);
    const epoch = state().canvasEpoch;
    state().undoLocal(); // what undoStroke() does when the undo was sent
    expect(state().canvas.map((a) => (a.kind === 'stroke' ? a.id : -1))).toEqual([1]);
    expect(state().canvasEpoch).toBe(epoch + 1);

    // The drawer starts stroke 3 before the server's echo arrives.
    state().appendLocalOps([{ k: 'start', id: 3, tool: 'brush', color: '#000000', size: 6, x: 9, y: 9 }]);
    state().handleServerMessage({ t: 'undo' });
    expect(state().canvas.map((a) => (a.kind === 'stroke' ? a.id : -1))).toEqual([1, 3]);
    state().handleServerMessage({ t: 'clear' });
    expect(state().canvas).toHaveLength(2);
  });

  it('a guesser applies the broadcast undo and clear', () => {
    state().handleServerMessage({ ...welcome('bob', turn('host')), canvas: [stroke(1), stroke(2)] });
    state().handleServerMessage({ t: 'undo' });
    expect(state().canvas).toHaveLength(1);
    state().handleServerMessage({ t: 'clear' });
    expect(state().canvas).toHaveLength(0);
  });
});

describe('clock offset', () => {
  it('seeds from snapshots until a pong gives a corrected value, then sticks to pongs', () => {
    const now = Date.now();
    state().handleServerMessage(welcome('bob', room({ serverTime: now + 4000 })));
    expect(state().clockOffset).toBeCloseTo(4000, -2);
    state().setClockOffset(1200);
    state().handleServerMessage({ t: 'room', room: room({ serverTime: now + 4000 }) });
    expect(state().clockOffset).toBe(1200);
    state().handleServerMessage(welcome('bob', room({ serverTime: now + 4000 })));
    expect(state().clockOffset).toBe(1200);
  });
});
