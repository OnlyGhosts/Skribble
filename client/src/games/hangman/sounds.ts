/** Hangman's sounds: key clicks, right and wrong letters, the pencil and the two endings. */
import { defineSounds } from '../../platform/lib/sound';

export const hangmanSounds = defineSounds('hangman', {
  key: { file: 'ui/key', volume: 0.35, cooldownMs: 40 },
  right: { file: 'ui/chime', volume: 0.55 },
  wrong: { file: 'ui/buzz', volume: 0.45 },
  section: { file: 'hangman/scratch', volume: 0.45 },
  solved: { file: 'stings/solved', volume: 0.65, cooldownMs: 1500, steady: true },
  hanged: { file: 'stings/lose', volume: 0.6, cooldownMs: 1500, steady: true },
});
