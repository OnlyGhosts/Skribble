/** Board sizes and fleets: classic 10x10 for one player, team boards that grow with the bigger crew, and the settings around them. */
import { describe, expect, it } from 'vitest';
import { validateLayout } from '../../../shared/games/battleships/fleet.js';
import { DEFAULT_BATTLESHIPS_SETTINGS } from '../../../shared/games/battleships/protocol.js';
import { AVATAR, chatTexts, errorsOf, readyUp, sim, startGame } from '../../platform/engine/testHarness.js';
import { viewFor } from '../../platform/engine/view.js';
import { PLACE_MS, data, placeAll, rowsLayout, shipsOf, view } from './testHarness.js';

const NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Finn', 'Gina', 'Hugo'];

describe('Battleships boards', () => {
  it('defaults to the classic fleet with move or fire on, and has no board size setting', () => {
    expect(DEFAULT_BATTLESHIPS_SETTINGS).toEqual({ mode: 'solo', fleet: 'classic', placeSeconds: 60, turnSeconds: 30, moveOrFire: true });
    const s = sim('battleships');
    const [alice] = startGame(s, ['Alice', 'Bob']);
    expect(Object.keys(s.data.settings)).not.toContain('boardSize');
    expect(alice).toBeTruthy();
  });

  it('plays every solo board at the classic 10x10 with the chosen fleet, however many players', () => {
    for (const fleet of ['small', 'classic'] as const) {
      const s = sim('battleships');
      startGame(s, NAMES.slice(0, 5), { fleet });
      const v = view(s);
      expect(v.boardSize).toBe(10);
      expect(v.fleet).toEqual(fleet === 'small' ? [4, 3, 3, 2] : [5, 4, 3, 3, 2]);
      expect(v.targets.map((t) => t.shipsTotal)).toEqual([v.fleet.length, v.fleet.length, v.fleet.length, v.fleet.length, v.fleet.length]);
    }
  });

  it('grows both team boards with the bigger crew (10, 12, 13, then 14) and adds a 3-ship per extra member', () => {
    const expected: Record<number, { size: number; fleet: number[] }> = {
      2: { size: 10, fleet: [5, 4, 3, 3, 2] },
      3: { size: 12, fleet: [5, 4, 3, 3, 3, 2] },
      4: { size: 12, fleet: [5, 4, 3, 3, 3, 2] },
      5: { size: 13, fleet: [5, 4, 3, 3, 3, 3, 2] },
      6: { size: 13, fleet: [5, 4, 3, 3, 3, 3, 2] },
      7: { size: 14, fleet: [5, 4, 3, 3, 3, 3, 3, 2] },
      8: { size: 14, fleet: [5, 4, 3, 3, 3, 3, 3, 2] },
    };
    for (let n = 2; n <= 8; n++) {
      const s = sim('battleships');
      startGame(s, NAMES.slice(0, n), { mode: 'teams', fleet: 'classic' });
      // The smaller team (B with an odd count) plays the larger team's board and fleet.
      expect(view(s).sides.map((x) => x.memberIds.length)).toEqual([Math.ceil(n / 2), Math.floor(n / 2)]);
      expect({ size: view(s).boardSize, fleet: view(s).fleet }).toEqual(expected[n]);
      expect(data(s)).toMatchObject({ size: expected[n].size, fleet: expected[n].fleet });
      expect(view(s).targets.map((t) => t.shipsTotal)).toEqual([expected[n].fleet.length, expected[n].fleet.length]);
    }
    // Four or more on a board stays at 14x14: just under double the classic area.
    expect(14 * 14).toBeLessThan(2 * 10 * 10);
  });

  it('places, auto-places and fills in the extra ships on a bigger board, up to its far edge', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, NAMES.slice(0, 5), { mode: 'teams', fleet: 'classic' });
    expect(view(s).boardSize).toBe(13);
    const far = [{ id: 's0', x: 8, y: 12, horizontal: true }];
    expect(errorsOf(s.game(alice, { t: 'place', ships: far }))).toEqual([]);
    expect(errorsOf(s.game(alice, { t: 'place', ships: [{ id: 's0', x: 9, y: 12, horizontal: true }] }))).toEqual(['Ship s0 is off the board.']);
    expect(errorsOf(s.game(alice, { t: 'place', ships: [{ id: 's6', x: 13, y: 0, horizontal: false }] }))).toEqual(['Ship s6 is off the board.']);
    expect(errorsOf(s.game(alice, { t: 'place', ships: rowsLayout(view(s).fleet) }))).toEqual([]);
    expect(view(s, alice).myBoard).toMatchObject({ placed: true });
    s.game(alice, { t: 'place', ships: far });
    s.game(bob, { t: 'autoPlace' });
    expect(view(s, bob).myBoard?.ships.map((x) => x.length)).toEqual([5, 4, 3, 3, 3, 3, 2]);
    s.now += PLACE_MS;
    expect(chatTexts(s.tick())).toContain("Time's up. The remaining fleets took their positions.");
    for (const side of ['A', 'B']) {
      const ships = shipsOf(s, side);
      expect(ships.map((x) => x.length)).toEqual([5, 4, 3, 3, 3, 3, 2]);
      expect(validateLayout(ships, data(s).fleet, 13)).toMatchObject({ ok: true, complete: true });
    }
    expect(shipsOf(s, 'A')[0]).toMatchObject({ x: 8, y: 12 });
    expect(view(s).phase).toBe('playing');
  });

  it('shoots up to the far edge of a bigger board and no further', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, NAMES.slice(0, 7), { mode: 'teams', fleet: 'small' });
    expect(view(s).boardSize).toBe(14);
    placeAll(s, [alice, bob]);
    expect(errorsOf(s.game(alice, { t: 'fire', targetId: 'B', x: 13, y: 13 }))).toEqual([]);
    expect(view(s).lastShot).toMatchObject({ x: 13, y: 13, result: 'miss' });
    expect(chatTexts(s.effects).at(-1)).toBe('Alice fires at Team B N14: miss.');
  });

  it('reads stored settings from before move or fire with the default, and ignores the retired board size and dice fields', () => {
    const s = sim('battleships');
    const [alice] = startGame(s, ['Alice', 'Bob']);
    s.apply({ type: 'leave', playerId: s.playerId('Bob') });
    expect(s.data.phase).toBe('lobby');
    const settings = { ...s.data.settings, boardSize: 8, diceMoves: false } as Record<string, unknown>;
    delete settings.moveOrFire;
    s.data = { ...s.data, settings: settings as typeof s.data.settings };
    expect((viewFor(s.data, null, s.now).settings as Record<string, unknown>).moveOrFire).toBe(true);
    // The next action stores the filled-in record; a patch naming the retired field is ignored.
    s.platform(alice, { t: 'updateSettings', settings: { placeSeconds: 45, boardSize: 10 } });
    expect(s.data.settings).toMatchObject({ moveOrFire: true, fleet: 'small', placeSeconds: 45, boardSize: 8 });
    s.apply({ type: 'join', name: 'Bob', avatar: AVATAR, connectionId: 'conn-Bob-2' });
    readyUp(s, [s.playerId('Bob')]);
    s.platform(alice, { t: 'start' });
    expect(view(s)).toMatchObject({ phase: 'placing', boardSize: 10, moveOrFire: true });
  });
});
