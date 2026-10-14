/**
 * Sound effects. Games declare a bank of named sounds (defineSounds) and play them by name; the
 * platform loads a game's bank when its screen mounts and its own after the first gesture. The
 * short note cues (your turn, the tick, a correct answer) are made in code and played with
 * playCue. Everything respects the sound switch, waits for a user gesture and never throws.
 */
import { defineSounds, soundEngine } from './audio/bank';
import { renderNotes } from './audio/synth';

export { defineSounds, soundBanks, soundEngine, type AnySoundBank, type SoundBank } from './audio/bank';
export { createSoundSchedule, type SoundSchedule } from './audio/schedule';
export { applause, drumroll, splash, whoosh } from './audio/synth';
export type { PlayOptions, SoundDef } from './audio/types';

export type Cue = 'correct' | 'yourTurn' | 'tick' | 'turnEnd' | 'fanfare';

export function setSoundEnabled(on: boolean): void {
  soundEngine.setEnabled(on);
}

/** Browsers only allow audio after a user gesture; call this from every pointer/key event. */
export function unlockAudio(): void {
  soundEngine.unlock();
}

/** The platform's cues (playCue); exported so tests can watch them. */
export const CUES = defineSounds<Cue>('cue', {
  correct: {
    render: renderNotes([
      { freq: 523.25, at: 0, dur: 0.12, type: 'triangle' },
      { freq: 659.25, at: 0.1, dur: 0.12, type: 'triangle' },
      { freq: 783.99, at: 0.2, dur: 0.22, type: 'triangle' },
    ]),
    volume: 0.6,
    steady: true,
  },
  yourTurn: {
    render: renderNotes([
      { freq: 587.33, at: 0, dur: 0.14, type: 'square', gain: 0.15 },
      { freq: 739.99, at: 0.14, dur: 0.14, type: 'square', gain: 0.15 },
      { freq: 880, at: 0.28, dur: 0.3, type: 'square', gain: 0.15 },
    ]),
    volume: 0.6,
    steady: true,
    cooldownMs: 600,
  },
  tick: { render: renderNotes([{ freq: 880, at: 0, dur: 0.07, type: 'square', gain: 0.13 }]), volume: 0.6, steady: true, cooldownMs: 400 },
  turnEnd: {
    render: renderNotes([
      { freq: 659.25, at: 0, dur: 0.16, type: 'triangle' },
      { freq: 493.88, at: 0.16, dur: 0.3, type: 'triangle' },
    ]),
    volume: 0.6,
    steady: true,
  },
  // A rising arpeggio that lands on a held chord.
  fanfare: {
    render: renderNotes([
      { freq: 523.25, at: 0, dur: 0.14, type: 'triangle' },
      { freq: 659.25, at: 0.12, dur: 0.14, type: 'triangle' },
      { freq: 783.99, at: 0.24, dur: 0.14, type: 'triangle' },
      { freq: 1046.5, at: 0.36, dur: 0.5, type: 'triangle', gain: 0.35 },
      { freq: 659.25, at: 0.36, dur: 0.5, type: 'sine', gain: 0.17 },
      { freq: 783.99, at: 0.36, dur: 0.5, type: 'sine', gain: 0.17 },
    ]),
    volume: 0.7,
    steady: true,
  },
});

export function playCue(cue: Cue): void {
  CUES.play(cue);
}

/** Someone else's moment at a shared table plays at this share of the level the player's own gets. */
export const ONLOOKER_VOLUME = 0.5;
