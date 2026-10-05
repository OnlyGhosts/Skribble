/**
 * Tiny WebAudio cue synthesiser. No asset files: every cue is a few oscillator notes.
 * Everything is best-effort — when AudioContext is missing or blocked we silently do nothing.
 */
export type Cue = 'correct' | 'yourTurn' | 'tick' | 'turnEnd';

let context: AudioContext | null = null;
let enabled = true;

type AudioContextCtor = typeof AudioContext;

function resolveContextCtor(): AudioContextCtor | null {
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

function getContext(): AudioContext | null {
  try {
    if (!context) {
      const Ctor = resolveContextCtor();
      if (!Ctor) return null;
      context = new Ctor();
    }
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

/** Browsers only allow audio after a user gesture; call this from the first pointer/key event. */
export function unlockAudio(): void {
  if (!enabled) return;
  getContext();
}

interface Note {
  freq: number;
  /** seconds after the cue starts */
  at: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

function play(notes: Note[]): void {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? 'sine';
      osc.frequency.setValueAtTime(n.freq, now + n.at);
      const peak = n.gain ?? 0.12;
      gain.gain.setValueAtTime(0.0001, now + n.at);
      gain.gain.exponentialRampToValueAtTime(peak, now + n.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + n.at);
      osc.stop(now + n.at + n.dur + 0.02);
    }
  } catch {
    /* audio is optional */
  }
}

const CUES: Record<Cue, Note[]> = {
  correct: [
    { freq: 523.25, at: 0, dur: 0.12, type: 'triangle' },
    { freq: 659.25, at: 0.1, dur: 0.12, type: 'triangle' },
    { freq: 783.99, at: 0.2, dur: 0.22, type: 'triangle' },
  ],
  yourTurn: [
    { freq: 587.33, at: 0, dur: 0.14, type: 'square', gain: 0.06 },
    { freq: 739.99, at: 0.14, dur: 0.14, type: 'square', gain: 0.06 },
    { freq: 880, at: 0.28, dur: 0.3, type: 'square', gain: 0.06 },
  ],
  tick: [{ freq: 880, at: 0, dur: 0.07, type: 'square', gain: 0.05 }],
  turnEnd: [
    { freq: 659.25, at: 0, dur: 0.16, type: 'triangle' },
    { freq: 493.88, at: 0.16, dur: 0.3, type: 'triangle' },
  ],
};

export function playCue(cue: Cue): void {
  play(CUES[cue]);
}
