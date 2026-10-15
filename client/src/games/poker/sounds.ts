/** Poker's sounds: the shared table files at the levels this table wants, a swoosh for the muck and a sting for a won pot. */
import { defineSounds, whoosh } from '../../platform/lib/sound';
import { TABLE_FILES } from '../../platform/table/sounds';

export const pokerSounds = defineSounds('poker', {
  deal: { file: TABLE_FILES.deal, volume: 0.4, cooldownMs: 40 },
  board: { file: TABLE_FILES.place, volume: 0.45, cooldownMs: 40 },
  flip: { file: TABLE_FILES.flip, volume: 0.4 },
  /** The last hand's cards swept to the muck before a new deal: a soft swoosh. */
  sweep: { render: whoosh, volume: 0.2, cooldownMs: 300 },
  check: { file: TABLE_FILES.knock, volume: 0.5 },
  chips: { file: TABLE_FILES.chips, volume: 0.45 },
  allIn: { file: TABLE_FILES.pushAll, volume: 0.55 },
  fold: { file: TABLE_FILES.toss, volume: 0.45 },
  collect: { file: TABLE_FILES.collect, volume: 0.55 },
  win: { file: 'stings/win', volume: 0.7, cooldownMs: 2000, steady: true },
});
