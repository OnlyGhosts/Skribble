/** Battleships at a big party: no seat cap, so a solo game of 12 or 50 fleets and two teams of 25 all start and take turns in order. */
import { describe, expect, it } from 'vitest';
import { gameById } from '../../../shared/platform/games.js';
import { ROOM_HARD_CAP, seatLimit } from '../../../shared/platform/settings.js';
import { sim, startGame } from '../../platform/engine/testHarness.js';
import { PLACE_MS, data, view } from './testHarness.js';

const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `P${i}`);

/** Runs the clock out on the current turn (the clock fires an auto shot) and returns who was up. */
function timeOutTurn(s: ReturnType<typeof sim>): string {
  const phase = data(s).phase;
  if (phase.kind !== 'turn') throw new Error(`no turn: ${phase.kind}`);
  s.now = phase.endsAt;
  s.tick();
  return phase.shooterId;
}

describe('Battleships: a big party', () => {
  it('has no seat cap of its own: the room limit is the only one', () => {
    expect(gameById('battleships').maxPlayers).toBeNull();
    expect(seatLimit(gameById('battleships'))).toBe(ROOM_HARD_CAP);
    expect(ROOM_HARD_CAP).toBe(50);
  });

  for (const n of [12, ROOM_HARD_CAP]) {
    it(`starts a solo game of ${n}: a 10x10 fleet each, everyone seated, and the turns go round in join order`, () => {
      const s = sim('battleships');
      const ids = startGame(s, names(n));
      expect(s.data.players.filter((p) => p.participating)).toHaveLength(n);
      expect(data(s).sides.map((side) => side.id)).toEqual(ids);
      const mine = view(s, ids[n - 1]);
      expect(mine).toMatchObject({ phase: 'placing', boardSize: 10, mySideId: ids[n - 1] });
      expect(mine.targets).toHaveLength(n - 1);
      // Nobody placed: the deadline lays out every fleet and the first fleet fires first.
      s.now += PLACE_MS;
      s.tick();
      expect(view(s).phase).toBe('playing');
      // One full lap: the clock's auto shots (rng 0 aims at the first fleet afloat) keep the game going.
      const shooters = Array.from({ length: n }, () => timeOutTurn(s));
      expect(shooters).toEqual(ids);
      expect(view(s, ids[0])).toMatchObject({ phase: 'playing', turnNumber: n + 1 });
    });
  }

  it('starts a teams game of 50: two crews of 25 on 14x14 boards with the biggest fleet a board takes', () => {
    const s = sim('battleships');
    const ids = startGame(s, names(ROOM_HARD_CAP), { mode: 'teams', fleet: 'classic' });
    expect(view(s).sides.map((side) => side.memberIds.length)).toEqual([25, 25]);
    expect(view(s)).toMatchObject({ boardSize: 14, fleet: [5, 4, 3, 3, 3, 3, 3, 2] });
    s.now += PLACE_MS;
    s.tick();
    expect(view(s).phase).toBe('playing');
    // The teams alternate and each crew rotates through its members: A's first, B's first, A's second...
    const shooters = Array.from({ length: 4 }, () => timeOutTurn(s));
    expect(shooters).toEqual([ids[0], ids[1], ids[2], ids[3]]);
  });
});
