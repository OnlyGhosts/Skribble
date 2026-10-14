import { describe, expect, it, vi } from 'vitest';
import { defineSounds } from './bank';
import { LATE_MS, MASTER_VOLUME, RATE_JITTER, SoundEngine, type AudioEnv } from './engine';
import type { SoundDef } from './types';

/** Just enough of an AudioContext to see what was played, at what level and rate. */
class FakeContext {
  state: 'running' | 'suspended' = 'running';
  sampleRate = 8000;
  destination = { node: 'destination' };
  gains: { gain: { value: number }; connect: (n: unknown) => unknown }[] = [];
  sources: { buffer: unknown; playbackRate: { value: number }; started: boolean }[] = [];
  buffers: { length: number }[] = [];
  decodes: ArrayBuffer[] = [];
  decodeDelayMs = 0;
  failDecode = false;

  createGain() {
    const node = { gain: { value: 1 }, connect: (n: unknown) => n };
    this.gains.push(node);
    return node;
  }

  createBufferSource() {
    const source = {
      buffer: null as unknown,
      playbackRate: { value: 1 },
      started: false,
      connect: (n: unknown) => n,
      start: () => {
        source.started = true;
      },
    };
    this.sources.push(source);
    return source;
  }

  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    const buffer = { length, getChannelData: () => data };
    this.buffers.push(buffer);
    return buffer;
  }

  decodeAudioData(bytes: ArrayBuffer, ok: (b: unknown) => void, fail: (e: unknown) => void): Promise<unknown> {
    this.decodes.push(bytes);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (this.failDecode) {
          fail(new Error('bad data'));
          reject(new Error('bad data'));
          return;
        }
        const buffer = { decodedFrom: bytes.byteLength };
        ok(buffer);
        resolve(buffer);
      }, this.decodeDelayMs);
    });
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  /** The level of the n-th sound played (its own gain node; the first gain is the master). */
  levelOf(n: number): number {
    return this.gains[n + 1].gain.value;
  }
}

function setup(opts: { random?: number; fetchFails?: boolean; noAudio?: boolean } = {}) {
  let clock = 0;
  const ctx = new FakeContext();
  const fetched: string[] = [];
  const env: AudioEnv = {
    createContext: vi.fn(() => (opts.noAudio ? null : (ctx as unknown as AudioContext))),
    fetchBytes: vi.fn(async (url: string) => {
      fetched.push(url);
      if (opts.fetchFails) throw new Error('404');
      return new ArrayBuffer(url.length);
    }),
    now: () => clock,
    random: () => opts.random ?? 0.5,
  };
  const engine = new SoundEngine(env);
  return {
    ctx,
    env,
    engine,
    fetched,
    advance(ms: number) {
      clock += ms;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const CHIP: SoundDef = { file: 'table/chip', volume: 0.5 };

describe('SoundEngine', () => {
  it('plays nothing and creates no context before a user gesture', async () => {
    const { engine, ctx, env } = setup();
    engine.load(['/sounds/table/chip.mp3']);
    engine.play('t.chip', CHIP);
    await flush();
    expect(env.createContext).not.toHaveBeenCalled();
    expect(ctx.sources).toHaveLength(0);
  });

  it('routes every sound through the master volume at its own level times the scale', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = setup();
    engine.unlock();
    engine.load(['/sounds/table/chip.mp3']);
    await vi.runAllTimersAsync();
    engine.play('t.chip', CHIP, { volume: 0.5 });
    expect(ctx.gains[0].gain.value).toBe(MASTER_VOLUME);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].started).toBe(true);
    expect(ctx.levelOf(0)).toBeCloseTo(0.25);
    vi.useRealTimers();
  });

  it('stays silent with sound switched off, and plays again once it is back on', async () => {
    vi.useFakeTimers();
    const { engine, ctx, advance } = setup();
    engine.unlock();
    engine.load(['/sounds/table/chip.mp3']);
    await vi.runAllTimersAsync();
    engine.setEnabled(false);
    engine.play('t.chip', CHIP);
    expect(ctx.sources).toHaveLength(0);
    engine.setEnabled(true);
    advance(1000);
    engine.play('t.chip', CHIP);
    expect(ctx.sources).toHaveLength(1);
    vi.useRealTimers();
  });

  it('muted at the first gesture: makes no context until sound is switched on, then decodes what was loaded', async () => {
    vi.useFakeTimers();
    const { engine, ctx, env } = setup();
    engine.setEnabled(false);
    engine.load(['/sounds/table/chip.mp3']);
    engine.unlock();
    await vi.runAllTimersAsync();
    expect(env.createContext).not.toHaveBeenCalled();
    engine.setEnabled(true);
    await vi.runAllTimersAsync();
    expect(ctx.decodes).toHaveLength(1);
    expect(engine.ready('/sounds/table/chip.mp3')).toBe(true);
    vi.useRealTimers();
  });

  it('drops a repeat inside the cooldown, per sound', async () => {
    vi.useFakeTimers();
    const { engine, ctx, advance } = setup();
    engine.unlock();
    engine.load(['/sounds/table/chip.mp3']);
    await vi.runAllTimersAsync();
    const def: SoundDef = { ...CHIP, cooldownMs: 100 };
    engine.play('t.chip', def);
    advance(50);
    engine.play('t.chip', def);
    engine.play('t.other', def);
    expect(ctx.sources).toHaveLength(2);
    advance(60);
    engine.play('t.chip', def);
    expect(ctx.sources).toHaveLength(3);
    vi.useRealTimers();
  });

  it('wanders the playback rate by at most the jitter, and not at all for a steady sound', async () => {
    vi.useFakeTimers();
    for (const random of [0, 0.999999]) {
      const { engine, ctx, advance } = setup({ random });
      engine.unlock();
      engine.load(['/sounds/table/chip.mp3']);
      await vi.runAllTimersAsync();
      engine.play('t.chip', CHIP);
      advance(1000);
      engine.play('t.steady', { ...CHIP, steady: true });
      const [jittered, steady] = ctx.sources.map((s) => s.playbackRate.value);
      expect(Math.abs(jittered - 1)).toBeGreaterThan(RATE_JITTER * 0.99);
      expect(Math.abs(jittered - 1)).toBeLessThanOrEqual(RATE_JITTER + 1e-9);
      expect(steady).toBe(1);
    }
    vi.useRealTimers();
  });

  it('fetches a file once, only when asked, and decodes it only after the gesture', async () => {
    vi.useFakeTimers();
    const { engine, ctx, fetched } = setup();
    expect(fetched).toEqual([]);
    engine.load(['/sounds/a.mp3', '/sounds/b.mp3']);
    engine.load(['/sounds/a.mp3']);
    await vi.runAllTimersAsync();
    expect(fetched).toEqual(['/sounds/a.mp3', '/sounds/b.mp3']);
    expect(ctx.decodes).toHaveLength(0);
    engine.unlock();
    await vi.runAllTimersAsync();
    expect(ctx.decodes).toHaveLength(2);
    expect(engine.ready('/sounds/a.mp3')).toBe(true);
    vi.useRealTimers();
  });

  it('plays a file still decoding if it is ready in time, and skips it when the moment has passed', async () => {
    vi.useFakeTimers();
    const quick = setup();
    quick.engine.unlock();
    quick.ctx.decodeDelayMs = 10;
    quick.engine.play('t.chip', CHIP);
    await vi.runAllTimersAsync();
    expect(quick.ctx.sources).toHaveLength(1);

    const slow = setup();
    slow.engine.unlock();
    slow.ctx.decodeDelayMs = LATE_MS + 100;
    slow.engine.play('t.chip', CHIP);
    slow.advance(LATE_MS + 100);
    await vi.runAllTimersAsync();
    expect(slow.ctx.sources).toHaveLength(0);
    vi.useRealTimers();
  });

  it('never throws: no Web Audio, a missing file, a file that will not decode', async () => {
    vi.useFakeTimers();
    const none = setup({ noAudio: true });
    none.engine.unlock();
    expect(() => none.engine.play('t.chip', CHIP)).not.toThrow();

    const missing = setup({ fetchFails: true });
    missing.engine.unlock();
    missing.engine.load(['/sounds/table/chip.mp3']);
    expect(() => missing.engine.play('t.chip', CHIP)).not.toThrow();
    await vi.runAllTimersAsync();
    expect(missing.ctx.sources).toHaveLength(0);

    const broken = setup();
    broken.ctx.failDecode = true;
    broken.engine.unlock();
    broken.engine.play('t.chip', CHIP);
    await vi.runAllTimersAsync();
    expect(broken.ctx.sources).toHaveLength(0);

    const throwing = setup();
    throwing.env.createContext = () => {
      throw new Error('blocked');
    };
    expect(() => throwing.engine.unlock()).not.toThrow();
    expect(() => throwing.engine.play('t.chip', CHIP)).not.toThrow();
    vi.useRealTimers();
  });

  it('runs what waits for the first gesture once, at that gesture', () => {
    const { engine } = setup();
    const fn = vi.fn();
    engine.afterFirstGesture(fn);
    expect(fn).not.toHaveBeenCalled();
    engine.unlock();
    engine.unlock();
    expect(fn).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    engine.afterFirstGesture(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('renders a sound made in code once and reuses the buffer', () => {
    const { engine, ctx, advance } = setup();
    engine.unlock();
    const render = vi.fn((rate: number) => new Float32Array(rate / 10));
    const def: SoundDef = { render, volume: 0.4 };
    engine.play('t.made', def);
    advance(1000);
    engine.play('t.made', def);
    expect(render).toHaveBeenCalledTimes(1);
    expect(ctx.buffers).toHaveLength(1);
    expect(ctx.buffers[0].length).toBe(800);
    expect(ctx.sources).toHaveLength(2);
  });

  it('renders the sounds made in code of a loaded bank at the gesture, before their first play', () => {
    const { engine, ctx } = setup();
    const render = vi.fn((rate: number) => new Float32Array(rate / 100));
    engine.load([], [render]);
    expect(render).not.toHaveBeenCalled();
    engine.unlock();
    expect(render).toHaveBeenCalledTimes(1);
    engine.play('t.made', { render, volume: 0.4 });
    expect(render).toHaveBeenCalledTimes(1);
    expect(ctx.sources).toHaveLength(1);
  });

  it('wakes a context the system suspended on the next gesture', () => {
    const { engine, ctx } = setup();
    engine.unlock();
    ctx.state = 'suspended';
    engine.unlock();
    expect(ctx.state).toBe('running');
  });
});

describe('defineSounds', () => {
  it('registers the bank with its files once each, and loads only that bank', () => {
    const { engine, fetched } = setup();
    const bank = defineSounds(
      'test-bank',
      {
        a: { file: ['x/one', 'x/two'], volume: 0.3 },
        b: { file: 'x/one', volume: 0.3 },
        c: { render: () => new Float32Array(1), volume: 0.3 },
      },
      engine,
    );
    expect(bank.urls).toEqual(['/sounds/x/one.mp3', '/sounds/x/two.mp3']);
    expect(fetched).toEqual([]);
    bank.load();
    expect(fetched).toEqual(['/sounds/x/one.mp3', '/sounds/x/two.mp3']);
  });

  it('keeps the cooldowns of two banks apart', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = setup();
    const one = defineSounds('bank-one', { hit: { file: 'x/hit', volume: 0.5 } }, engine);
    const two = defineSounds('bank-two', { hit: { file: 'x/hit', volume: 0.5 } }, engine);
    engine.unlock();
    one.load();
    await vi.runAllTimersAsync();
    one.play('hit');
    two.play('hit');
    one.play('hit');
    expect(ctx.sources).toHaveLength(2);
    vi.useRealTimers();
  });
});
