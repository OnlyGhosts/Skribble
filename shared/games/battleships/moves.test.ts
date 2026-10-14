/** Move or fire geometry: shifts up to the roll, quarter turns, and where a ship may stop. */
import { describe, expect, it } from 'vitest';
import { resolveShot, shipCells, validateLayout, type Ship } from './fleet.js';
import { applyShipMove, centreIndex, checkShipMove, endProblem, hasOptions, movableShipIds, rotated, shifted, shipOptions } from './moves.js';
import type { ShipPlacement } from './protocol.js';

const SMALL = [4, 3, 3, 2];

function fleet(placements: ShipPlacement[]): Ship[] {
  const check = validateLayout(placements, SMALL, 10);
  if (!check.ok) throw new Error(check.reason);
  return check.ships;
}

/** s0 D4-G4 across the middle, the others out of the way along the bottom rows. */
const MIDDLE = fleet([
  { id: 's0', x: 3, y: 3, horizontal: true },
  { id: 's1', x: 0, y: 9, horizontal: true },
  { id: 's2', x: 4, y: 9, horizontal: true },
  { id: 's3', x: 8, y: 9, horizontal: true },
]);

const keys = (ship: Ship): string[] => shipCells(ship).map((c) => `${c.x},${c.y}`);

describe('shifts', () => {
  it('moves a ship 1..N squares in any of the four directions, whatever its axis', () => {
    const s0 = MIDDLE[0];
    expect(shifted(s0, 'right', 1)).toMatchObject({ x: 4, y: 3, horizontal: true });
    expect(shifted(s0, 'left', 3)).toMatchObject({ x: 0, y: 3 });
    expect(shifted(s0, 'up', 2)).toMatchObject({ x: 3, y: 1 });
    expect(shifted(s0, 'down', 6)).toMatchObject({ x: 3, y: 9 });
    for (const direction of ['up', 'down', 'left', 'right'] as const) {
      for (let n = 1; n <= 3; n++) expect(checkShipMove(MIDDLE, 's0', { kind: 'shift', direction, steps: n }, 10, {}, 3).ok).toBe(true);
    }
  });

  it('refuses more than the roll, a sunk ship and an unknown ship', () => {
    expect(checkShipMove(MIDDLE, 's0', { kind: 'shift', direction: 'up', steps: 4 }, 10, {}, 3)).toEqual({ ok: false, reason: 'You rolled a 3. Move up to 3 squares.' });
    expect(checkShipMove(MIDDLE, 's0', { kind: 'shift', direction: 'up', steps: 2 }, 10, {}, 1)).toEqual({ ok: false, reason: 'You rolled a 1. Move up to 1 square.' });
    expect(checkShipMove(MIDDLE, 's9', { kind: 'rotate' }, 10, {}, 3)).toEqual({ ok: false, reason: 'No such ship.' });
    let sunk = MIDDLE;
    for (const c of shipCells(MIDDLE[3])) sunk = resolveShot(sunk, c.x, c.y).ships;
    expect(checkShipMove(sunk, 's3', { kind: 'shift', direction: 'up', steps: 1 }, 10, {}, 3)).toEqual({ ok: false, reason: 'That ship is sunk.' });
  });

  it('refuses to stop off the board, on another ship or on any shot square, but passes over them freely', () => {
    expect(checkShipMove(MIDDLE, 's0', { kind: 'shift', direction: 'right', steps: 4 }, 10, {}, 6)).toEqual({ ok: false, reason: 'That is off the board.' });
    expect(checkShipMove(MIDDLE, 's0', { kind: 'shift', direction: 'up', steps: 4 }, 10, {}, 6)).toEqual({ ok: false, reason: 'That is off the board.' });
    // Down 6 lands on s1 and s2 along the bottom row.
    expect(checkShipMove(MIDDLE, 's0', { kind: 'shift', direction: 'down', steps: 6 }, 10, {}, 6)).toEqual({ ok: false, reason: 'Another ship is already there.' });
    for (const mark of ['miss', 'hit', 'sunk'] as const) {
      expect(checkShipMove(MIDDLE, 's0', { kind: 'shift', direction: 'down', steps: 1 }, 10, { '5,4': mark }, 6)).toEqual({ ok: false, reason: 'Ships cannot stop on a square that was already shot.' });
    }
    // Jumping the shot row: down 2 clears it, so the squares in between do not count.
    const jump = checkShipMove(MIDDLE, 's0', { kind: 'shift', direction: 'down', steps: 2 }, 10, { '5,4': 'miss' }, 6);
    expect(jump).toMatchObject({ ok: true, ship: { x: 3, y: 5 } });
    // Its own old squares are not in the way.
    expect(checkShipMove(MIDDLE, 's0', { kind: 'shift', direction: 'right', steps: 1 }, 10, {}, 1)).toMatchObject({ ok: true, ship: { x: 4, y: 3 } });
  });

  it('carries the damage with the ship, so a moved ship is sunk by hitting its undamaged segments', () => {
    const hit = resolveShot(MIDDLE, 4, 3).ships;
    expect(hit[0].damage).toEqual([false, true, false, false]);
    const shots = { '4,3': 'hit' as const };
    // Up 2 is fine (the hit square is left behind); staying across row 4 is not.
    expect(checkShipMove(hit, 's0', { kind: 'shift', direction: 'right', steps: 1 }, 10, shots, 6)).toEqual({ ok: false, reason: 'Ships cannot stop on a square that was already shot.' });
    const moved = checkShipMove(hit, 's0', { kind: 'shift', direction: 'up', steps: 2 }, 10, shots, 2);
    if (!moved.ok) throw new Error(moved.reason);
    expect(moved.ship).toMatchObject({ x: 3, y: 1, damage: [false, true, false, false] });
    expect(hit[0]).toMatchObject({ x: 3, y: 3 });
    let ships = moved.ships;
    for (const x of [3, 5]) ships = resolveShot(ships, x, 1).ships;
    expect(resolveShot(ships, 6, 1).result).toBe('sunk');
  });
});

describe('quarter turns', () => {
  it('turns about the centre square, keeps segment order, and turns back exactly', () => {
    expect([1, 2, 3, 4, 5].map(centreIndex)).toEqual([0, 0, 1, 1, 2]);
    const s0 = MIDDLE[0];
    const upright = rotated(s0);
    // D4-G4 turns about E4 (segment 1): E3-E6.
    expect(upright).toMatchObject({ x: 4, y: 2, horizontal: false });
    expect(keys(upright)).toEqual(['4,2', '4,3', '4,4', '4,5']);
    expect(keys(upright)[1]).toBe(keys(s0)[1]);
    expect(rotated(upright)).toEqual(s0);
    const five: Ship = { id: 's0', x: 2, y: 2, length: 5, horizontal: false, damage: [true, false, false, false, false] };
    expect(rotated(five)).toMatchObject({ x: 0, y: 4, horizontal: true, damage: [true, false, false, false, false] });
    expect(applyShipMove(five, { kind: 'rotate' })).toEqual(rotated(five));
  });

  it('counts as the whole move whatever the roll, under the same stopping rules', () => {
    expect(checkShipMove(MIDDLE, 's0', { kind: 'rotate' }, 10, {}, 1)).toMatchObject({ ok: true, ship: { x: 4, y: 2, horizontal: false } });
    expect(checkShipMove(MIDDLE, 's0', { kind: 'rotate' }, 10, { '4,5': 'miss' }, 6)).toEqual({ ok: false, reason: 'Ships cannot stop on a square that was already shot.' });
    // A ship on the edge cannot turn off the board.
    const edge = fleet([
      { id: 's0', x: 0, y: 0, horizontal: true },
      { id: 's1', x: 0, y: 9, horizontal: true },
      { id: 's2', x: 4, y: 9, horizontal: true },
      { id: 's3', x: 8, y: 9, horizontal: true },
    ]);
    expect(checkShipMove(edge, 's0', { kind: 'rotate' }, 10, {}, 6)).toEqual({ ok: false, reason: 'That is off the board.' });
    // The centre segment hit: its square is shot, so the ship cannot turn about it.
    expect(checkShipMove(resolveShot(MIDDLE, 4, 3).ships, 's0', { kind: 'rotate' }, 10, { '4,3': 'hit' }, 6).ok).toBe(false);
  });
});

describe('options', () => {
  it('lists the legal distances per direction, skipping squares it cannot stop on', () => {
    const options = shipOptions(MIDDLE, 's0', 10, { '5,4': 'miss' }, 3);
    expect(options).toEqual({ steps: { up: [1, 2, 3], down: [2, 3], left: [1, 2, 3], right: [1, 2, 3] }, rotate: true });
    expect(hasOptions(options)).toBe(true);
    expect(endProblem(MIDDLE, shifted(MIDDLE[0], 'down', 1), 10, { '5,4': 'miss' })).toBe('Ships cannot stop on a square that was already shot.');
  });

  it('knows which ships can move at all', () => {
    const boxed = fleet([
      { id: 's0', x: 0, y: 0, horizontal: true },
      { id: 's1', x: 0, y: 1, horizontal: true },
      { id: 's2', x: 3, y: 1, horizontal: true },
      { id: 's3', x: 4, y: 0, horizontal: true },
    ]);
    expect(movableShipIds(boxed, 10, {}, 6)).toEqual(['s0', 's1', 's2', 's3']);
    // Packed against each other and the edge, with shots all round the block: a roll of 1 moves nothing.
    const shots: Record<string, 'miss'> = {};
    for (let x = 0; x < 10; x++) for (const y of [2, 3]) shots[`${x},${y}`] = 'miss';
    for (let x = 6; x < 10; x++) for (const y of [0, 1]) shots[`${x},${y}`] = 'miss';
    expect(movableShipIds(boxed, 10, shots, 1)).toEqual([]);
    expect(hasOptions(shipOptions(boxed, 's3', 10, shots, 1))).toBe(false);
  });
});
