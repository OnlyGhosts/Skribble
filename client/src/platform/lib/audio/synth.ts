/**
 * Sounds made in code, rendered once into samples: the short note cues (your turn, the tick) and
 * the few effects no recording fits (a whoosh, a drumroll, applause). Pure functions of
 * the sample rate and a noise source, so they can be tested without a browser.
 */
import type { Render } from './types';

const TAU = Math.PI * 2;
/** Everything rendered peaks here, like the recorded files (-1 dB). */
const PEAK = 0.89;

export type Wave = 'sine' | 'square' | 'triangle';

export interface Note {
  freq: number;
  /** Seconds after the cue starts. */
  at: number;
  dur: number;
  type?: Wave;
  gain?: number;
}

/** One cycle of a band-limited wave at `phase` (in cycles), with harmonics kept under `limit` Hz. */
function wave(type: Wave, phase: number, freq: number, limit: number): number {
  if (type === 'sine') return Math.sin(TAU * phase);
  let sum = 0;
  for (let k = 1; k * freq < limit; k += 2) {
    sum += type === 'square' ? Math.sin(TAU * k * phase) / k : (((k - 1) / 2) % 2 === 0 ? 1 : -1) * (Math.sin(TAU * k * phase) / (k * k));
  }
  return type === 'square' ? (4 / Math.PI) * sum : (8 / (Math.PI * Math.PI)) * sum;
}

/** A quick exponential swell into an exponential fade, like a plucked note. */
function noteEnvelope(t: number, dur: number, peak: number): number {
  const floor = 0.0001;
  const attack = 0.01;
  if (t < 0 || t > dur) return 0;
  if (t < attack) return peak * Math.pow(floor / peak, 1 - t / attack);
  return peak * Math.pow(floor / peak, (t - attack) / Math.max(dur - attack, 0.001));
}

export function normalize(samples: Float32Array, peak = PEAK): Float32Array {
  let max = 0;
  for (const v of samples) max = Math.max(max, Math.abs(v));
  if (max === 0) return samples;
  const k = peak / max;
  for (let i = 0; i < samples.length; i++) samples[i] *= k;
  return samples;
}

/** A few notes, mixed; levels stay relative to each other and are not normalised. */
export function renderNotes(notes: readonly Note[]): Render {
  return (sampleRate) => {
    const end = Math.max(...notes.map((n) => n.at + n.dur)) + 0.03;
    const out = new Float32Array(Math.ceil(end * sampleRate));
    const limit = sampleRate / 2.5;
    for (const n of notes) {
      const from = Math.floor(n.at * sampleRate);
      const len = Math.ceil(n.dur * sampleRate);
      const peak = n.gain ?? 0.3;
      for (let i = 0; i < len && from + i < out.length; i++) {
        const t = i / sampleRate;
        out[from + i] += wave(n.type ?? 'sine', n.freq * t, n.freq, limit) * noteEnvelope(t, n.dur, peak);
      }
    }
    return out;
  };
}

type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** A biquad (RBJ cookbook) whose frequency may move from sample to sample. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly type: FilterType,
    private readonly sampleRate: number,
    private readonly q = 0.707,
  ) {}

  tune(freq: number): this {
    const w = (TAU * Math.min(freq, this.sampleRate * 0.45)) / this.sampleRate;
    const alpha = Math.sin(w) / (2 * this.q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    if (this.type === 'lowpass') {
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = this.b0;
    } else if (this.type === 'highpass') {
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    }
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const noise = (random: () => number): number => random() * 2 - 1;

/** Adds a short filtered noise burst (a clap, a drum hit) at `at` seconds. */
function burst(out: Float32Array, sampleRate: number, random: () => number, at: number, opts: { amp: number; decay: number; filter: Biquad }): void {
  const from = Math.floor(at * sampleRate);
  const len = Math.ceil(opts.decay * 6 * sampleRate);
  for (let i = 0; i < len && from + i < out.length; i++) {
    const t = i / sampleRate;
    const env = t < 0.001 ? t / 0.001 : Math.exp(-(t - 0.001) / opts.decay);
    out[from + i] += opts.filter.run(noise(random)) * env * opts.amp;
  }
}

/** A falling sine (a plop, a tom). */
function drop(out: Float32Array, sampleRate: number, at: number, opts: { from: number; to: number; sweep: number; decay: number; amp: number }): void {
  const start = Math.floor(at * sampleRate);
  const len = Math.ceil(opts.decay * 6 * sampleRate);
  let phase = 0;
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / sampleRate;
    const freq = opts.to + (opts.from - opts.to) * Math.exp(-t / opts.sweep);
    phase += freq / sampleRate;
    out[start + i] += Math.sin(TAU * phase) * Math.exp(-t / opts.decay) * opts.amp;
  }
}

/** Air moving past: band-passed noise that swells and sweeps up and back down. */
export const whoosh: Render = (sampleRate, random) => {
  const dur = 0.42;
  const out = new Float32Array(Math.ceil(dur * sampleRate));
  const bp = new Biquad('bandpass', sampleRate, 0.9);
  for (let i = 0; i < out.length; i++) {
    const shape = Math.sin((Math.PI * i) / out.length) ** 2;
    if (i % 32 === 0) bp.tune(320 + 2400 * shape);
    out[i] = bp.run(noise(random)) * shape;
  }
  return normalize(out);
};

/** A snare roll that speeds up and swells, then lands on an accent with a low drum. */
export const drumroll: Render = (sampleRate, random) => {
  const out = new Float32Array(Math.ceil(1.3 * sampleRate));
  const end = 0.9;
  let t = 0;
  while (t < end) {
    const progress = t / end;
    const hp = new Biquad('highpass', sampleRate, 0.8).tune(1100 + random() * 300);
    burst(out, sampleRate, random, t, { amp: 0.3 + 0.45 * progress + random() * 0.08, decay: 0.03, filter: hp });
    t += 0.062 - 0.02 * progress + (random() - 0.5) * 0.006;
  }
  burst(out, sampleRate, random, end + 0.04, { amp: 1, decay: 0.09, filter: new Biquad('highpass', sampleRate, 0.7).tune(700) });
  drop(out, sampleRate, end + 0.04, { from: 170, to: 95, sweep: 0.05, decay: 0.12, amp: 0.9 });
  return normalize(out);
};

/** A small crowd clapping: lots of short band-passed bursts that swell and die away over a soft bed. */
export const applause: Render = (sampleRate, random) => {
  const dur = 1.9;
  const out = new Float32Array(Math.ceil(dur * sampleRate));
  const density = (t: number) => (t < 0.25 ? t / 0.25 : Math.exp(-(t - 0.25) / 0.65));
  let claps = 0;
  while (claps < 170) {
    const at = random() * (dur - 0.15);
    if (random() > density(at)) continue;
    claps++;
    const bp = new Biquad('bandpass', sampleRate, 1.3).tune(850 + random() * 1900);
    burst(out, sampleRate, random, at, { amp: 0.35 + random() * 0.65, decay: 0.008 + random() * 0.012, filter: bp });
  }
  const bed = new Biquad('lowpass', sampleRate).tune(2600);
  for (let i = 0; i < out.length; i++) out[i] += bed.run(noise(random)) * density(i / sampleRate) * 0.06;
  return normalize(out);
};
