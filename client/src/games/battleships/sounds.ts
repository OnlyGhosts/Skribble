/** Battleships' sounds: the die, the guns and the sea. The splash and the whoosh are made in code. */
import { defineSounds, splash, whoosh } from '../../platform/lib/sound';

export const battleshipsSounds = defineSounds('battleships', {
  dice: { file: 'battleships/dice', volume: 0.5 },
  fire: { file: 'battleships/cannon', volume: 0.5 },
  miss: { render: splash, volume: 0.4 },
  hit: { file: 'battleships/hit', volume: 0.55 },
  sink: { file: 'battleships/sink', volume: 0.65 },
  sinkSting: { file: 'stings/sink', volume: 0.6, cooldownMs: 1500, steady: true },
  moved: { render: whoosh, volume: 0.4 },
  struck: { file: 'battleships/thud', volume: 0.6 },
});
