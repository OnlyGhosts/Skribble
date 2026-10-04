import { describe, expect, it } from 'vitest';
import {
  MAX_ACTIONS_PER_TURN,
  MAX_CANVAS_RESYNC_BYTES,
  MAX_POINTS_PER_STROKE,
  MAX_POINTS_PER_TURN,
  MAX_WS_MESSAGE_BYTES,
} from './constants';

describe('canvas caps', () => {
  it('bound the whole canvas, not just one stroke', () => {
    // A drawer can hold the per-stroke cap on every stroke; without a canvas-wide cap that is
    // MAX_ACTIONS_PER_TURN * MAX_POINTS_PER_STROKE numbers (18M with the old 3000 x 6000 values).
    expect(MAX_POINTS_PER_TURN).toBeLessThanOrEqual(MAX_ACTIONS_PER_TURN * MAX_POINTS_PER_STROKE);
    expect(MAX_POINTS_PER_STROKE).toBeLessThanOrEqual(MAX_POINTS_PER_TURN);
  });

  it('keep the worst-case canvas resync (sent in welcome to every joiner) under 1 MiB', () => {
    expect(MAX_CANVAS_RESYNC_BYTES).toBeLessThan(1024 * 1024);
    // A single inbound move batch (2000 numbers, protocol cap) must still fit in one stroke.
    expect(MAX_POINTS_PER_STROKE).toBeGreaterThanOrEqual(2000);
    expect(MAX_WS_MESSAGE_BYTES).toBeGreaterThanOrEqual(2000 * 8);
  });
});
