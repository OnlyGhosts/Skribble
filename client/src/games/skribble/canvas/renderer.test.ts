import { describe, expect, it } from 'vitest';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@shared/games/skribble/constants';
import type { CanvasAction, DrawOp } from '@shared/games/skribble/protocol';
import { applyOpsToActions } from './history';
import { CanvasRenderer } from './renderer';
import { FakeCanvas, geometry } from '../test/fakeCanvas';

function makeRenderer(dpr = 1) {
  const display = new FakeCanvas(false);
  const logical = new FakeCanvas(true);
  const renderer = new CanvasRenderer(display as unknown as HTMLCanvasElement, { logical, dpr });
  return { renderer, display: display.ctx, logical: logical.ctx };
}

const style = { tool: 'brush' as const, color: '#000000', size: 6 };
const start = (id: number, x: number, y: number): DrawOp => ({ k: 'start', id, ...style, x, y });
const move = (id: number, pts: number[]): DrawOp => ({ k: 'move', id, pts });
const end = (id: number): DrawOp => ({ k: 'end', id });

describe('replaying a stroke that is still being drawn', () => {
  it('draws no straight tail for an unfinished last stroke, so continuing it matches the incremental output', () => {
    // Reference: every op streamed into one renderer.
    const incremental = makeRenderer();
    incremental.renderer.applyOps([start(1, 100, 300), move(1, [200, 300, 300, 300]), move(1, [300, 400, 300, 500]), end(1)]);

    // A viewer joining mid-stroke replays the partial history, then receives the rest.
    const partial: CanvasAction[] = [{ kind: 'stroke', id: 1, ...style, points: [100, 300, 200, 300, 300, 300] }];
    const joiner = makeRenderer();
    joiner.renderer.replayAll(partial);
    const afterReplay = geometry(joiner.display);
    expect(afterReplay.some((c) => c.op === 'lineTo' && c.args[0] === 300 && c.args[1] === 300), 'no tail to the newest point yet').toBe(false);
    joiner.renderer.applyOps([move(1, [300, 400, 300, 500]), end(1)]);

    expect(geometry(joiner.display)).toEqual(geometry(incremental.display));
  });

  it('still draws the tail of a finished last stroke', () => {
    const { renderer, display } = makeRenderer();
    renderer.replayAll([{ kind: 'stroke', id: 1, ...style, points: [0, 0, 10, 0, 20, 0], done: true }]);
    expect(geometry(display).some((c) => c.op === 'lineTo' && c.args[0] === 20)).toBe(true);
  });
});

describe('flood fills', () => {
  function wallAt(x: number, logical: FakeCanvas['ctx']) {
    for (let y = 0; y < CANVAS_HEIGHT; y++) logical.setPixel(x, y, '#000000');
  }

  it('fills the same logical region whatever the display pixel ratio', () => {
    const a = makeRenderer(1);
    const b = makeRenderer(2);
    for (const r of [a, b]) {
      wallAt(100, r.logical);
      r.renderer.applyOp({ k: 'fill', x: 10, y: 10, color: '#ff0000' });
    }
    const rects = (r: ReturnType<typeof makeRenderer>) => r.display.calls.filter((c) => c.op === 'rect');
    expect(rects(a).length).toBe(CANVAS_HEIGHT);
    expect(rects(a)).toEqual(rects(b));
    expect(a.logical.pixel(50, 50)).toBe('#ff0000');
    expect(a.logical.pixel(150, 50)).toBe('#ffffff');
    // Spans are painted in logical coordinates: the display context's transform scales them.
    expect(rects(a).find((c) => c.args[1] === 0)?.args).toEqual([0, 0, 100, 1]);
    expect(a.display.calls.filter((c) => c.op === 'getImageData')).toHaveLength(0);
  });

  it('remembers each fill action’s spans so a replay never floods the bitmap again', () => {
    const { renderer, logical, display } = makeRenderer();
    let actions: CanvasAction[] = [];
    const fills: DrawOp[] = [
      { k: 'fill', x: 10, y: 10, color: '#ff0000' },
      { k: 'fill', x: 10, y: 10, color: '#00ff00' },
    ];
    actions = applyOpsToActions(actions, fills);
    renderer.applyOps(fills, actions);
    const floods = () => logical.calls.filter((c) => c.op === 'getImageData').length;
    expect(floods()).toBe(2);

    // Undo: the first fill is replayed from its cached spans.
    renderer.replayAll(actions.slice(0, 1));
    expect(floods()).toBe(2);
    expect(logical.pixel(5, 5)).toBe('#ff0000');
    expect(display.calls.filter((c) => c.op === 'rect').length).toBeGreaterThan(0);

    // A resynced list (fresh action objects) is flooded once, then cached again.
    const resynced = applyOpsToActions([], fills.slice(0, 1));
    renderer.replayAll(resynced);
    expect(floods()).toBe(3);
    renderer.replayAll(resynced);
    expect(floods()).toBe(3);
  });

  it('keeps the logical bitmap at the fixed canvas size', () => {
    const logical = new FakeCanvas(true);
    new CanvasRenderer(new FakeCanvas(false) as unknown as HTMLCanvasElement, { logical, dpr: 2 });
    expect([logical.width, logical.height]).toEqual([CANVAS_WIDTH, CANVAS_HEIGHT]);
  });
});
