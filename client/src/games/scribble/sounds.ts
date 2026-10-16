/** Scribble's sounds: a pop when the word is picked, chimes for guesses, the buzzer and the turn's sting. */
import { defineSounds } from '../../platform/lib/sound';

export const scribbleSounds = defineSounds('scribble', {
  chosen: { file: 'ui/pop', volume: 0.45 },
  correct: { file: 'ui/chime', volume: 0.55, cooldownMs: 120 },
  close: { file: 'ui/blip', volume: 0.45 },
  timeUp: { file: 'ui/buzzer', volume: 0.5 },
  turnEnd: { file: 'stings/turn-end', volume: 0.55, cooldownMs: 1500, steady: true },
});
