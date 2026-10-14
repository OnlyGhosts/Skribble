/** The Spy Game's sounds: the role reveal, the gavel, votes, a wrong guess and the two endings. */
import { defineSounds, whoosh } from '../../platform/lib/sound';

export const spygameSounds = defineSounds('spygame', {
  reveal: { render: whoosh, volume: 0.45 },
  accuse: { file: 'spygame/gavel', volume: 0.6 },
  vote: { file: 'ui/click', volume: 0.45 },
  wrongGuess: { file: 'ui/buzz', volume: 0.5 },
  caught: { file: 'stings/win', volume: 0.65, cooldownMs: 1500, steady: true },
  spyWins: { file: 'stings/sly', volume: 0.65, cooldownMs: 1500, steady: true },
});
