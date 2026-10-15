import { describe, expect, it } from 'vitest';
import { applause, drumroll, normalize, renderNotes, whoosh } from './synth';

/** A repeatable noise source, so the renders are the same every run. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const RATE = 22050;

describe('sounds made in code', () => {
  it.each([
    ['whoosh', whoosh, 0.42],
    ['drumroll', drumroll, 1.3],
    ['applause', applause, 1.9],
  ] as const)('%s renders a finite clip of the right length that peaks like the recordings', (_name, render, seconds) => {
    const out = render(RATE, seeded());
    expect(out.length).toBe(Math.ceil(seconds * RATE));
    let peak = 0;
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeCloseTo(0.89, 3);
  });

  it('renders note cues to their last note plus a short tail, silent outside the notes', () => {
    const out = renderNotes([
      { freq: 440, at: 0, dur: 0.1, type: 'square' },
      { freq: 660, at: 0.2, dur: 0.1, type: 'triangle' },
    ])(RATE, Math.random);
    expect(out.length).toBe(Math.ceil(0.33 * RATE));
    expect(Math.abs(out[Math.floor(0.15 * RATE)])).toBe(0);
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(0.4);
  });

  it('normalises to the peak and leaves silence alone', () => {
    expect([...normalize(new Float32Array([0.1, -0.2]), 0.5)]).toEqual([0.25, -0.5]);
    expect([...normalize(new Float32Array(3))]).toEqual([0, 0, 0]);
  });
});
