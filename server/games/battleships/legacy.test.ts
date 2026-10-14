/** A Battleships room stored by the build before move or fire keeps running after the deploy. */
import { describe, expect, it } from 'vitest';
import { chatTexts, errorsOf, sim, startGame, type Sim } from '../../platform/engine/testHarness.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { upgradeData } from './legacy.js';
import { data, fire, placeAll, view } from './testHarness.js';
import type { BattleshipsData } from './module.js';

/** Rewrites the running game into the old stored shape: fleet by name, hit counts, dice and shotsTaken, no move-or-fire fields. */
function toOldShape(s: Sim, phase: Record<string, unknown>): void {
  const current = data(s);
  const old = {
    mode: current.mode,
    size: current.size,
    fleet: current.fleet.length === 4 ? 'small' : 'classic',
    sides: current.sides.map((side) => ({
      id: side.id,
      memberIds: side.memberIds,
      ships: side.ships.map(({ damage, ...ship }) => ({ ...ship, hits: damage.filter(Boolean).length })),
      ready: side.ready,
      shots: side.shots,
      alive: side.alive,
      lastShooterId: side.lastShooterId,
    })),
    phase,
    lastSide: current.lastSide,
    dice: 3,
    log: current.log,
    shotsTaken: 1,
  };
  s.data = { ...s.data, game: old as unknown as BattleshipsData };
}

function oldGame(): { s: Sim; alice: string; bob: string } {
  const s = sim('battleships');
  const [alice, bob] = startGame(s, ['Alice', 'Bob']);
  placeAll(s, [alice, bob]);
  // Alice hits Bob's first ship, so an old hit count is carried over.
  fire(s, alice, bob, 0, 0);
  return { s, alice, bob };
}

describe('Battleships: rooms stored by the old build', () => {
  it('upgrades a game mid-turn: the view renders, the shot goes in and the clock keeps ticking', () => {
    const { s, alice, bob } = oldGame();
    const fleet = [...data(s).fleet];
    toOldShape(s, { kind: 'turn', sideId: bob, shooterId: bob, endsAt: s.now + 10_000 });
    expect(() => view(s, alice)).not.toThrow();
    expect(view(s, bob)).toMatchObject({ fleet, moveOrFire: false, turn: { shooterId: bob, roll: null, canMove: false }, turnNumber: 2 });
    expect(view(s, bob).myBoard?.ships[0].damage).toEqual([true, ...Array<boolean>(fleet[0] - 1).fill(false)]);
    expect(nextDeadline(s.data)).toBe(s.now + 10_000);
    expect(chatTexts(fire(s, bob, alice, 9, 9))).toEqual(['Bob fires at Alice J10: miss.']);
    expect(view(s).turn).toMatchObject({ shooterId: alice, roll: null });
    s.now += 10_000;
    expect(errorsOf(s.tick())).toEqual([]);
    expect(view(s).lastShot).toMatchObject({ shooterId: alice, auto: true });
    expect(data(s).fleet).toEqual(fleet);
    expect(data(s).sides.every((side) => side.movedLastTurn === false && side.pendingRoll === null)).toBe(true);
  });

  it('ends an old move window (the side had fired) at its deadline and passes the turn on', () => {
    const { s, alice, bob } = oldGame();
    toOldShape(s, { kind: 'moving', sideId: alice, shooterId: alice, endsAt: s.now + 5_000 });
    expect(view(s, alice).phase).toBe('playing');
    expect(nextDeadline(s.data)).toBe(s.now + 5_000);
    s.now += 5_000;
    s.tick();
    expect(view(s).turn).toMatchObject({ shooterId: bob });
  });

  it('leaves current data alone', () => {
    const { s } = oldGame();
    const current = data(s);
    expect(upgradeData(current)).toBe(current);
  });
});
