/** Blackjack's sounds: the shared table files at the levels this table wants. */
import { defineSounds } from '../../platform/lib/sound';
import { TABLE_FILES } from '../../platform/table/sounds';

export const blackjackSounds = defineSounds('blackjack', {
  deal: { file: TABLE_FILES.deal, volume: 0.4, cooldownMs: 40 },
  flip: { file: TABLE_FILES.flip, volume: 0.45 },
  bet: { file: TABLE_FILES.chipLay, volume: 0.45 },
  collect: { file: TABLE_FILES.collect, volume: 0.55 },
  push: { file: 'ui/click', volume: 0.35 },
  bust: { file: TABLE_FILES.thud, volume: 0.5 },
  blackjack: { file: TABLE_FILES.natural, volume: 0.6 },
  shuffle: { file: TABLE_FILES.shuffle, volume: 0.45, cooldownMs: 2000 },
});
