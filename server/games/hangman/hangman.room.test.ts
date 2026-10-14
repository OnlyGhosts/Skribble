/** Hangman through a memory Room: the figure is drawn section by section on the shared canvas, and clear only touches the section being drawn. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HangmanClientMessage, HangmanView } from '../../../shared/games/hangman/protocol.js';
import type { DrawOp } from '../../../shared/platform/canvas.js';
import { createHarness, startGame, type Harness } from '../../platform/drivers/testUtils.js';

const START = new Date('2026-01-01T12:00:00Z').getTime();

const start = (id: number): DrawOp => ({ k: 'start', id, tool: 'brush', color: '#000000', size: 6, x: 1, y: 1 });

const view = (h: Harness): HangmanView => h.room.getState(null).game as HangmanView;
const send = (h: Harness, playerId: string, msg: HangmanClientMessage): void => h.room.handleMessage(playerId, { kind: 'game', msg });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Hangman: the canvas through the room', () => {
  it('lets only the hangman draw during a drawing step, keeps earlier sections through a clear and hands joiners the figure so far', () => {
    const h = createHarness({ gameId: 'hangman' });
    const [alice, bob, carol] = startGame(h, ['Alice', 'Bob', 'Carol']);
    send(h, alice, { t: 'chooseWord', index: 0 });
    expect(view(h)).toMatchObject({ phase: 'guessing', guesserId: bob, mask: '_____' });

    // Nobody draws while the word is being guessed.
    send(h, alice, { t: 'draw', ops: [start(1)] });
    send(h, bob, { t: 'draw', ops: [start(1)] });
    expect(h.transport.errors(alice)).toEqual([]);
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
    expect(h.canvas()).toHaveLength(0);

    // Section 1: two strokes; a clear here empties the canvas (nothing came before).
    send(h, bob, { t: 'letter', letter: 'z' });
    expect(view(h)).toMatchObject({ phase: 'drawing', section: 1 });
    h.transport.clear();
    send(h, alice, { t: 'draw', ops: [start(1), start(2)] });
    expect(h.canvas()).toHaveLength(2);
    expect(h.transport.ofType(bob, 'draw')).toHaveLength(1);
    expect(h.transport.ofType(alice, 'draw')).toHaveLength(0);
    send(h, carol, { t: 'draw', ops: [start(3)] });
    expect(h.transport.errors(carol)).toEqual(['NOT_ALLOWED']);
    send(h, alice, { t: 'clear' });
    expect(h.canvas()).toHaveLength(0);
    expect(h.transport.ofType(bob, 'clear')).toHaveLength(1);
    send(h, alice, { t: 'draw', ops: [start(4)] });
    send(h, alice, { t: 'drawDone' });
    expect(view(h)).toMatchObject({ phase: 'guessing', guesserId: carol, section: null });
    // Ops still in flight after the step are dropped without a word.
    send(h, alice, { t: 'draw', ops: [start(5)] });
    expect(h.transport.errors(alice)).toEqual([]);
    expect(h.canvas()).toHaveLength(1);

    // Section 2: clear removes only its own strokes, as undos on the wire; undo cannot reach section 1.
    send(h, carol, { t: 'letter', letter: 'x' });
    expect(view(h)).toMatchObject({ phase: 'drawing', section: 2 });
    h.transport.clear();
    send(h, alice, { t: 'undo' });
    expect(h.canvas()).toHaveLength(1);
    expect(h.transport.ofType(bob, 'undo')).toHaveLength(0);
    send(h, alice, { t: 'draw', ops: [start(6), start(7)] });
    expect(h.canvas()).toHaveLength(3);
    send(h, alice, { t: 'clear' });
    expect(h.canvas().map((a) => (a.kind === 'stroke' ? a.id : -1))).toEqual([4]);
    expect(h.transport.ofType(bob, 'undo')).toHaveLength(2);
    expect(h.transport.ofType(bob, 'clear')).toHaveLength(0);
    send(h, alice, { t: 'draw', ops: [start(8)] });

    // A joiner's welcome carries the figure so far; the draw clock ends the step.
    const dave = h.join('Dave');
    expect(h.welcomeCanvas(dave).map((a) => (a.kind === 'stroke' ? a.id : -1))).toEqual([4, 8]);
    vi.advanceTimersByTime(10_000);
    expect(view(h)).toMatchObject({ phase: 'guessing', guesserId: bob, wrong: 2 });

    // The next word starts on an empty canvas.
    send(h, bob, { t: 'word', text: 'apple' });
    expect(view(h)).toMatchObject({ phase: 'turnEnd', word: 'APPLE' });
    vi.advanceTimersByTime(6_000);
    expect(view(h)).toMatchObject({ phase: 'choosing', hangmanId: bob });
    expect(h.canvas()).toHaveLength(0);
    expect(h.welcomeCanvas(h.join('Eve'))).toEqual([]);
  });
});
