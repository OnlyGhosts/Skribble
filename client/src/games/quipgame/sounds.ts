/** Quip Game's sounds: a pop for an answer, a click for a vote, a drumroll for each reveal and applause for a big one. */
import { applause, defineSounds, drumroll } from '../../platform/lib/sound';

export const quipgameSounds = defineSounds('quipgame', {
  answer: { file: 'ui/pop', volume: 0.45 },
  vote: { file: 'ui/click', volume: 0.45 },
  reveal: { render: drumroll, volume: 0.5, cooldownMs: 1000 },
  applause: { render: applause, volume: 0.55, cooldownMs: 1500 },
});
