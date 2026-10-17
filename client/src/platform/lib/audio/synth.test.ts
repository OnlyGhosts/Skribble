import { describe, expect, it } from 'vitest';
import { SOFT_FALL_NOTES, SOFT_FALL_SECONDS, applause, drumroll, normalize, renderNotes, softFall, whoosh } from './synth';

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
    ['soft fall', softFall, SOFT_FALL_SECONDS],
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

  /** The pitch of `out` around `at` seconds: the strongest autocorrelation lag between 120 and 450 Hz. */
  function pitchAt(out: Float32Array, at: number): number {
    const from = Math.floor(at * RATE);
    const window = 1024;
    let best = 0;
    let bestLag = 0;
    for (let lag = Math.floor(RATE / 450); lag <= Math.ceil(RATE / 120); lag++) {
      let sum = 0;
      for (let i = 0; i < window; i++) sum += out[from + i] * out[from + i + lag];
      if (sum > best) {
        best = sum;
        bestLag = lag;
      }
    }
    return RATE / bestLag;
  }

  it('the soft fall steps down G, E flat, C, the last note resting on a low C', () => {
    const out = softFall(RATE, seeded());
    const [g, eFlat, c, low] = SOFT_FALL_NOTES;
    expect(pitchAt(out, g.at + 0.04)).toBeCloseTo(g.freq, -1);
    expect(pitchAt(out, eFlat.at + 0.06)).toBeCloseTo(eFlat.freq, -1);
    // C over its low octave repeats at the low C's period; either reading is the fall's floor.
    const floor = pitchAt(out, c.at + 0.2);
    expect([c.freq, low.freq].some((f) => Math.abs(floor - f) < f * 0.03)).toBe(true);
    expect(floor).toBeLessThan(pitchAt(out, eFlat.at + 0.06));
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.01);
  });

  it('normalises to the peak and leaves silence alone', () => {
    expect([...normalize(new Float32Array([0.1, -0.2]), 0.5)]).toEqual([0.25, -0.5]);
    expect([...normalize(new Float32Array(3))]).toEqual([0, 0, 0]);
  });
});
