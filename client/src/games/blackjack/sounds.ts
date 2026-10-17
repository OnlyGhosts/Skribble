/** Blackjack's sounds: the shared table files at the levels this table wants, its own blackjack sting and the dealer's soft fall. */
import { defineSounds, softFall, whoosh } from '../../platform/lib/sound';
import { TABLE_FILES } from '../../platform/table/sounds';

export const blackjackSounds = defineSounds('blackjack', {
  deal: { file: TABLE_FILES.deal, volume: 0.4, cooldownMs: 40 },
  /** The half of a split sliding over to its own hand. */
  slide: { file: TABLE_FILES.place, volume: 0.35, cooldownMs: 40 },
  flip: { file: TABLE_FILES.flip, volume: 0.45 },
  /** The last round's cards swept to the discards before a new deal: a soft swoosh. */
  sweep: { render: whoosh, volume: 0.2, cooldownMs: 300 },
  bet: { file: TABLE_FILES.chipLay, volume: 0.45, cooldownMs: 60 },
  collect: { file: TABLE_FILES.collect, volume: 0.55 },
  push: { file: 'ui/click', volume: 0.35 },
  bust: { file: TABLE_FILES.thud, volume: 0.5 },
  /** A bright jingle with a cascade of chips, about 1.4 s. */
  blackjack: { file: 'stings/blackjack', volume: 0.7, steady: true },
  /** The dealer turns over a natural: a soft three-note fall, under a second. */
  dealerBlackjack: { render: softFall, volume: 0.5, steady: true },
});
