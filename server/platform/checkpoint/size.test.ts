/**
 * What a checkpoint costs on the wire: a mid-game room of 2, 8 and 50 players in every game. Each
 * one must fit well inside what the server accepts back; the sizes are printed for the record.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHECKPOINT_MAX_CHARS } from '../../../shared/platform/constants.js';
import { GAME_IDS, gameById } from '../../../shared/platform/games.js';
import { GAME_TEST_FIXTURES } from '../../games/testFixtures.js';
import { sim, startGame } from '../engine/testHarness.js';
import { checkpointOf } from './checkpointer.js';
import { sealCheckpoint } from './seal.js';

const KEY = randomBytes(32);
const SIZES = [2, 8, 50];

/** The room with the test's counter ids and tokens swapped for real ones (UUIDs, 32 hex digits), which compress far worse. */
function withRealIds<T>(data: T): T {
  const real = new Map<string, string>();
  const json = JSON.stringify(data).replace(/"(id|token)-(\d+)"/g, (match: string, kind: string) => {
    let swap = real.get(match);
    if (swap === undefined) {
      swap = `"${kind === 'id' ? randomUUID() : randomBytes(16).toString('hex')}"`;
      real.set(match, swap);
    }
    return swap;
  });
  return JSON.parse(json) as T;
}

describe('checkpoint size', () => {
  it.each(GAME_IDS)('%s fits for 2, 8 and 50 players', (gameId) => {
    const sizes: string[] = [];
    for (const n of SIZES) {
      const count = Math.max(n, gameById(gameId).minPlayers);
      const s = sim(gameId);
      const ids = startGame(s, Array.from({ length: count }, (_, i) => `Player ${i + 1}`));
      // A move into the game, so its state is past the start.
      s.game(ids[0], GAME_TEST_FIXTURES[gameId].validMessage);
      const data = checkpointOf(withRealIds(s.data));
      const text = sealCheckpoint(KEY, data.code, s.now, data);
      const json = JSON.stringify(data).length;
      sizes.push(`${count}p ${text.length} chars (JSON ${json})`);
      expect(text.length).toBeLessThan(CHECKPOINT_MAX_CHARS / 2);
    }
    console.log(`checkpoint ${gameId}: ${sizes.join(', ')}`);
  });
});
