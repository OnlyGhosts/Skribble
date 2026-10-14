/**
 * The sound player: one AudioContext, created on the first user gesture, a master volume, and a
 * cache of decoded buffers. Recorded files are fetched as soon as a screen asks for them and
 * decoded once the context exists; sounds made in code are rendered on first use. Everything is
 * best-effort: without Web Audio, before a gesture or with sound off, play does nothing, and it
 * never throws.
 */
import { isSample, soundUrls, type PlayOptions, type Render, type SoundDef } from './types';

export const MASTER_VOLUME = 0.6;
/** Each play wanders up to this much off pitch, so repeats do not sound mechanical. */
export const RATE_JITTER = 0.04;
export const DEFAULT_COOLDOWN_MS = 60;
/** A file still decoding plays if it is ready this soon after it was asked for; later, the moment has passed. */
export const LATE_MS = 250;

/** What the engine needs from the browser; the tests pass fakes. */
export interface AudioEnv {
  createContext(): AudioContext | null;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  /** Milliseconds, for the cooldowns. */
  now(): number;
  random(): number;
}

interface Sample {
  bytes: Promise<ArrayBuffer | null>;
  buffer: AudioBuffer | null;
  decoding: Promise<AudioBuffer | null> | null;
}

function decodeBuffer(ctx: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  // The callback form: older Safari has no promise-returning decodeAudioData.
  return new Promise((resolve, reject) => {
    const result = ctx.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
    result?.catch(reject);
  });
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private on = true;
  /** A user gesture has happened: browsers block audio before one. */
  private gestured = false;
  private readonly samples = new Map<string, Sample>();
  private readonly rendered = new Map<Render, AudioBuffer>();
  /** Sounds made in code waiting for the context to render them ahead of their first play. */
  private readonly toRender = new Set<Render>();
  private readonly lastPlayed = new Map<string, number>();
  private readonly afterGesture: (() => void)[] = [];

  constructor(private readonly env: AudioEnv) {}

  setEnabled(on: boolean): void {
    this.on = on;
    if (on && this.gestured) this.context();
  }

  /** Called from every pointer and key press: the first one creates the context; later ones wake it if the OS suspended it. */
  unlock(): void {
    const first = !this.gestured;
    this.gestured = true;
    if (this.on) this.context();
    if (!first) return;
    for (const fn of this.afterGesture.splice(0)) {
      try {
        fn();
      } catch {
        /* a listener must not break the gesture */
      }
    }
  }

  /** Runs `fn` after the first user gesture (at once if it has happened). */
  afterFirstGesture(fn: () => void): void {
    if (this.gestured) fn();
    else this.afterGesture.push(fn);
  }

  /** Starts fetching these files (and readies these sounds made in code); idempotent. Decoding and rendering wait for the context. */
  load(urls: readonly string[], renders: readonly Render[] = []): void {
    for (const url of urls) this.sample(url);
    for (const render of renders) {
      if (this.ctx) this.renderBuffer(this.ctx, render);
      else this.toRender.add(render);
    }
  }

  /** True once the file is decoded and can play at once. */
  ready(url: string): boolean {
    return this.samples.get(url)?.buffer != null;
  }

  /** Plays a sound under `key` (its cooldown is per key). */
  play(key: string, def: SoundDef, opts: PlayOptions = {}): void {
    try {
      if (!this.on || !this.gestured) return;
      const level = Math.min(1, Math.max(0, def.volume * (opts.volume ?? 1)));
      if (level <= 0) return;
      const now = this.env.now();
      const last = this.lastPlayed.get(key);
      if (last !== undefined && now - last < (def.cooldownMs ?? DEFAULT_COOLDOWN_MS)) return;
      const ctx = this.context();
      if (!ctx) return;
      this.lastPlayed.set(key, now);
      const rate = def.steady ? 1 : 1 + (this.env.random() * 2 - 1) * RATE_JITTER;
      if (!isSample(def)) {
        this.start(ctx, this.renderBuffer(ctx, def.render), level, rate);
        return;
      }
      const urls = soundUrls(def);
      const url = urls[Math.floor(this.env.random() * urls.length)] ?? urls[0];
      const sample = this.sample(url);
      if (sample.buffer) {
        this.start(ctx, sample.buffer, level, rate);
        return;
      }
      void this.decode(url).then((buffer) => {
        if (buffer && this.on && this.env.now() - now <= LATE_MS) this.start(ctx, buffer, level, rate);
      });
    } catch {
      /* sound is optional */
    }
  }

  private context(): AudioContext | null {
    try {
      if (!this.ctx) {
        const ctx = this.env.createContext();
        if (!ctx) return null;
        const master = ctx.createGain();
        master.gain.value = MASTER_VOLUME;
        master.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
        this.prepareAll();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return this.ctx;
    } catch {
      return null;
    }
  }

  private sample(url: string): Sample {
    let sample = this.samples.get(url);
    if (!sample) {
      let bytes: Promise<ArrayBuffer | null>;
      try {
        bytes = this.env.fetchBytes(url).catch(() => null);
      } catch {
        bytes = Promise.resolve(null);
      }
      sample = { bytes, buffer: null, decoding: null };
      this.samples.set(url, sample);
      if (this.ctx) void this.decode(url);
    }
    return sample;
  }

  private decode(url: string): Promise<AudioBuffer | null> {
    const sample = this.sample(url);
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    sample.decoding ??= sample.bytes
      .then((bytes) => (bytes ? decodeBuffer(ctx, bytes) : null))
      .then((buffer) => {
        sample.buffer = buffer;
        return buffer;
      })
      .catch(() => null);
    return sample.decoding;
  }

  private prepareAll(): void {
    for (const url of this.samples.keys()) void this.decode(url);
    const ctx = this.ctx;
    if (!ctx) return;
    for (const render of this.toRender) this.renderBuffer(ctx, render);
    this.toRender.clear();
  }

  private renderBuffer(ctx: AudioContext, render: Render): AudioBuffer {
    let buffer = this.rendered.get(render);
    if (!buffer) {
      this.toRender.delete(render);
      const data = render(ctx.sampleRate, () => this.env.random());
      buffer = ctx.createBuffer(1, Math.max(1, data.length), ctx.sampleRate);
      buffer.getChannelData(0).set(data);
      this.rendered.set(render, buffer);
    }
    return buffer;
  }

  private start(ctx: AudioContext, buffer: AudioBuffer, level: number, rate: number): void {
    try {
      if (!this.master) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = level;
      source.connect(gain).connect(this.master);
      source.start();
    } catch {
      /* sound is optional */
    }
  }
}

type AudioContextCtor = typeof AudioContext;

/** The real browser, read only when called (the module also loads in the unit tests and the e2e catalogue). */
export const browserEnv: AudioEnv = {
  createContext() {
    if (typeof window === 'undefined') return null;
    const w = window as Window & { webkitAudioContext?: AudioContextCtor };
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    return Ctor ? new Ctor() : null;
  },
  async fetchBytes(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.arrayBuffer();
  },
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  random: () => Math.random(),
};
