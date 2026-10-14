/** Battleships geometry: layouts, random fleets, shots and slides, all pure. */
import { describe, expect, it } from 'vitest';
import {
  allSunk,
  canSlide,
  cellKey,
  completeLayout,
  cellLabel,
  fits,
  fleetLengths,
  fleetShipIds,
  inBounds,
  isComplete,
  isSunk,
  movableShips,
  moveShip,
  occupiedCells,
  randomLayout,
  resolveShot,
  shipCells,
  shipsAfloat,
  slid,
  validateLayout,
  type Ship,
} from './fleet.js';
import type { ShipPlacement } from './protocol.js';

/** The small fleet laid out in rows: s0 at A1-D1, s1 at A2-C2, s2 at A3-C3, s3 at A4-B4. */
const ROWS: ShipPlacement[] = [
  { id: 's0', x: 0, y: 0, horizontal: true },
  { id: 's1', x: 0, y: 1, horizontal: true },
  { id: 's2', x: 0, y: 2, horizontal: true },
  { id: 's3', x: 0, y: 3, horizontal: true },
];

function fleet(placements: ShipPlacement[] = ROWS): Ship[] {
  const check = validateLayout(placements, 'small', 8);
  if (!check.ok) throw new Error(check.reason);
  return check.ships;
}

/** A counter rng that walks through [0, 1) in `steps`, so successive picks differ. */
function sequence(steps: number): () => number {
  let i = 0;
  return () => ((i++ % steps) + 0.5) / steps;
}

describe('fleets and cells', () => {
  it('lists the fleets longest first with positional ids', () => {
    expect(fleetLengths('small')).toEqual([4, 3, 3, 2]);
    expect(fleetLengths('classic')).toEqual([5, 4, 3, 3, 2]);
    expect(fleetShipIds('small')).toEqual(['s0', 's1', 's2', 's3']);
    expect(fleetShipIds('classic')).toEqual(['s0', 's1', 's2', 's3', 's4']);
    // A copy: callers may not mutate the shared constant through it.
    const lengths = fleetLengths('small');
    lengths.push(9);
    expect(fleetLengths('small')).toEqual([4, 3, 3, 2]);
  });

  it('keys and labels cells', () => {
    expect(cellKey(3, 4)).toBe('3,4');
    expect(cellLabel(0, 0)).toBe('A1');
    expect(cellLabel(9, 9)).toBe('J10');
    expect(cellLabel(2, 3)).toBe('C4');
  });

  it('walks a ship\'s cells along its axis', () => {
    expect(shipCells({ x: 1, y: 2, length: 3, horizontal: true })).toEqual([{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }]);
    expect(shipCells({ x: 1, y: 2, length: 2, horizontal: false })).toEqual([{ x: 1, y: 2 }, { x: 1, y: 3 }]);
    expect([...occupiedCells(fleet())].sort()).toEqual(['0,0', '0,1', '0,2', '0,3', '1,0', '1,1', '1,2', '1,3', '2,0', '2,1', '2,2', '3,0'].sort());
  });

  it('checks bounds on both axes', () => {
    expect(inBounds({ x: 5, y: 0, length: 3, horizontal: true }, 8)).toBe(true);
    expect(inBounds({ x: 6, y: 0, length: 3, horizontal: true }, 8)).toBe(false);
    expect(inBounds({ x: 0, y: 6, length: 3, horizontal: false }, 8)).toBe(false);
    expect(inBounds({ x: 0, y: 5, length: 3, horizontal: false }, 8)).toBe(true);
    expect(inBounds({ x: -1, y: 0, length: 2, horizontal: true }, 8)).toBe(false);
    expect(inBounds({ x: 8, y: 0, length: 1, horizontal: false }, 8)).toBe(false);
    expect(inBounds({ x: 7, y: 9, length: 1, horizontal: true }, 10)).toBe(true);
  });
});

describe('validateLayout', () => {
  it('accepts a complete fleet in bounds without overlaps and resets damage', () => {
    const check = validateLayout(ROWS, 'small', 8);
    expect(check).toMatchObject({ ok: true, complete: true });
    if (!check.ok) throw new Error('unreachable');
    expect(check.ships).toEqual([
      { id: 's0', x: 0, y: 0, horizontal: true, length: 4, hits: 0 },
      { id: 's1', x: 0, y: 1, horizontal: true, length: 3, hits: 0 },
      { id: 's2', x: 0, y: 2, horizontal: true, length: 3, hits: 0 },
      { id: 's3', x: 0, y: 3, horizontal: true, length: 2, hits: 0 },
    ]);
  });

  it('allows ships to touch', () => {
    const touching: ShipPlacement[] = [
      { id: 's0', x: 0, y: 0, horizontal: true },
      { id: 's1', x: 4, y: 0, horizontal: true },
      { id: 's2', x: 0, y: 1, horizontal: false },
      { id: 's3', x: 1, y: 1, horizontal: false },
    ];
    expect(validateLayout(touching, 'small', 8).ok).toBe(true);
  });

  it('refuses overlaps, ships off the board, duplicated and unknown ships', () => {
    const overlap = [...ROWS.slice(0, 3), { id: 's3', x: 2, y: 0, horizontal: false }];
    expect(validateLayout(overlap, 'small', 8)).toEqual({ ok: false, reason: 'Ship s3 overlaps another ship.' });
    const off = [...ROWS.slice(0, 3), { id: 's3', x: 7, y: 7, horizontal: true }];
    expect(validateLayout(off, 'small', 8)).toEqual({ ok: false, reason: 'Ship s3 is off the board.' });
    expect(validateLayout([...ROWS, { id: 's0', x: 0, y: 5, horizontal: true }], 'small', 8)).toEqual({ ok: false, reason: 'Ship s0 must be placed exactly once.' });
    expect(validateLayout([...ROWS, { id: 's9', x: 0, y: 5, horizontal: true }], 'small', 8)).toEqual({ ok: false, reason: 'Unknown ship in the layout.' });
  });

  it('takes a layout in progress: any ships of the fleet, in id order, and says whether it is complete', () => {
    const partial = validateLayout([ROWS[2], ROWS[0]], 'small', 8);
    expect(partial).toMatchObject({ ok: true, complete: false });
    if (!partial.ok) throw new Error('unreachable');
    expect(partial.ships.map((s) => s.id)).toEqual(['s0', 's2']);
    expect(isComplete(partial.ships, 'small')).toBe(false);
    expect(validateLayout([], 'small', 8)).toEqual({ ok: true, ships: [], complete: false });
    // The classic fleet has five ships: a small layout is one short of complete.
    expect(validateLayout(ROWS, 'classic', 10)).toMatchObject({ ok: true, complete: false });
    expect(isComplete(fleet(), 'small')).toBe(true);
  });

  it('applies the board size: a layout legal on 10x10 may hang off an 8x8', () => {
    const wide: ShipPlacement[] = [{ id: 's0', x: 6, y: 0, horizontal: true }, ...ROWS.slice(1)];
    expect(validateLayout(wide, 'small', 10).ok).toBe(true);
    expect(validateLayout(wide, 'small', 8).ok).toBe(false);
  });
});

describe('completeLayout', () => {
  it('fills in the ships still missing around the ones already placed, in id order', () => {
    const placed = validateLayout([ROWS[1], ROWS[3]], 'small', 8);
    if (!placed.ok) throw new Error('unreachable');
    const ships = completeLayout(placed.ships, 'small', 8, () => 0);
    expect(ships.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3']);
    expect(ships[1]).toMatchObject({ x: 0, y: 1, horizontal: true });
    expect(ships[3]).toMatchObject({ x: 0, y: 3, horizontal: true });
    expect(validateLayout(ships, 'small', 8)).toMatchObject({ ok: true, complete: true });
    // The first free spots with rng () => 0: s0 along the top row, s2 right after it.
    expect(ships[0]).toMatchObject({ x: 0, y: 0, horizontal: true });
    expect(ships[2]).toMatchObject({ x: 4, y: 0, horizontal: true });
    expect(completeLayout(fleet(), 'small', 8, () => 0)).toEqual(fleet());
  });
});

describe('randomLayout', () => {
  it('is valid for every fleet and board size and deterministic for a given rng', () => {
    for (const size of [8, 10] as const) {
      for (const kind of ['small', 'classic'] as const) {
        for (let seed = 1; seed <= 25; seed++) {
          const ships = randomLayout(kind, size, sequence(seed));
          expect(ships.map((s) => s.length)).toEqual(fleetLengths(kind));
          expect(ships.map((s) => s.id)).toEqual(fleetShipIds(kind));
          expect(validateLayout(ships, kind, size).ok).toBe(true);
          expect(ships.every((s) => s.hits === 0)).toBe(true);
          expect(randomLayout(kind, size, sequence(seed))).toEqual(ships);
        }
      }
    }
  });

  it('packs the fleet into the first free positions with rng () => 0 and spreads it otherwise', () => {
    const packed = randomLayout('small', 8, () => 0);
    expect(packed.map((s) => [s.x, s.y, s.horizontal])).toEqual([
      [0, 0, true],
      [4, 0, true],
      [0, 1, true],
      [3, 1, true],
    ]);
    const spread = randomLayout('small', 8, () => 0.999);
    expect(spread[0]).toMatchObject({ x: 7, y: 4, horizontal: false });
    expect(spread).not.toEqual(packed);
  });
});

describe('shots', () => {
  it('reports a miss without changing the fleet', () => {
    const ships = fleet();
    const shot = resolveShot(ships, 7, 7);
    expect(shot).toEqual({ result: 'miss', ships, ship: null });
    expect(shot.ships).not.toBe(ships);
    expect(ships[0].hits).toBe(0);
  });

  it('counts a hit, then a sink on the last segment, never mutating the input', () => {
    const ships = fleet();
    const first = resolveShot(ships, 0, 3);
    expect(first.result).toBe('hit');
    expect(first.ship).toMatchObject({ id: 's3', hits: 1 });
    expect(ships[3].hits).toBe(0);
    expect(isSunk(first.ships[3])).toBe(false);
    const second = resolveShot(first.ships, 1, 3);
    expect(second.result).toBe('sunk');
    expect(second.ship).toMatchObject({ id: 's3', hits: 2, length: 2 });
    expect(isSunk(second.ships[3])).toBe(true);
    expect(shipsAfloat(second.ships)).toBe(3);
    expect(allSunk(second.ships)).toBe(false);
  });

  it('knows when every ship is down', () => {
    let ships = fleet();
    for (const ship of fleet()) for (const c of shipCells(ship)) ships = resolveShot(ships, c.x, c.y).ships;
    expect(allSunk(ships)).toBe(true);
    expect(shipsAfloat(ships)).toBe(0);
    expect(allSunk([])).toBe(false);
  });
});

describe('slides', () => {
  it('moves a ship one cell along its own axis', () => {
    const ship: Ship = { id: 's0', x: 2, y: 3, length: 3, horizontal: true, hits: 0 };
    expect(slid(ship, 'forward')).toMatchObject({ x: 3, y: 3 });
    expect(slid(ship, 'back')).toMatchObject({ x: 1, y: 3 });
    const upright: Ship = { ...ship, horizontal: false };
    expect(slid(upright, 'forward')).toMatchObject({ x: 2, y: 4 });
    expect(slid(upright, 'back')).toMatchObject({ x: 2, y: 2 });
  });

  it('allows a slide only for an undamaged ship into free, unshot cells in bounds', () => {
    const ships = fleet();
    // s0 (A1-D1) can slide right into E1, not left off the board.
    expect(canSlide(ships, ships[0], 'forward', 8, {})).toBe(true);
    expect(canSlide(ships, ships[0], 'back', 8, {})).toBe(false);
    expect(fits(slid(ships[0], 'forward'), ships, 8)).toBe(true);
    // A damaged ship stays put.
    const damaged = resolveShot(ships, 0, 0).ships;
    expect(canSlide(damaged, damaged[0], 'forward', 8, { '0,0': 'hit' })).toBe(false);
    // A miss at E1 closes that way: a ship under a shot cell could never be sunk.
    expect(canSlide(ships, ships[0], 'forward', 8, { '4,0': 'miss' })).toBe(false);
    expect(canSlide(ships, ships[0], 'forward', 8, { '4,1': 'miss' })).toBe(true);
    // Ships boxed in by each other and the edge have nowhere to go.
    const blocked = fleet([
      { id: 's0', x: 0, y: 0, horizontal: true },
      { id: 's1', x: 4, y: 0, horizontal: true },
      { id: 's2', x: 0, y: 2, horizontal: true },
      { id: 's3', x: 0, y: 4, horizontal: true },
    ]);
    expect(canSlide(blocked, blocked[0], 'forward', 8, {})).toBe(false);
    expect(canSlide(blocked, blocked[1], 'back', 8, {})).toBe(false);
    expect(canSlide(blocked, blocked[1], 'forward', 8, {})).toBe(true);
  });

  it('lists the ships that have room, with the directions open to them, shot cells excluded', () => {
    const ships = fleet();
    expect(movableShips(ships, 8, {})).toEqual([
      { id: 's0', forward: true, back: false },
      { id: 's1', forward: true, back: false },
      { id: 's2', forward: true, back: false },
      { id: 's3', forward: true, back: false },
    ]);
    const damaged = resolveShot(ships, 0, 0).ships;
    expect(movableShips(damaged, 8, { '0,0': 'hit' }).map((m) => m.id)).toEqual(['s1', 's2', 's3']);
    expect(movableShips(ships, 8, { '4,0': 'miss', '3,1': 'miss' }).map((m) => m.id)).toEqual(['s2', 's3']);
  });

  it('moveShip applies a legal slide and explains a refused one', () => {
    const ships = fleet();
    const moved = moveShip(ships, 's0', 'forward', 8, {});
    expect(moved).toMatchObject({ ok: true });
    if (!moved.ok) throw new Error('unreachable');
    expect(moved.ships[0]).toMatchObject({ x: 1, y: 0 });
    expect(ships[0].x).toBe(0);
    expect(moveShip(ships, 's0', 'back', 8, {})).toEqual({ ok: false, reason: 'There is no room that way.' });
    expect(moveShip(ships, 'nope', 'back', 8, {})).toEqual({ ok: false, reason: 'No such ship.' });
    expect(moveShip(resolveShot(ships, 0, 0).ships, 's0', 'forward', 8, { '0,0': 'hit' })).toEqual({ ok: false, reason: 'A damaged ship cannot move.' });
  });

  it('never slides a ship under an earlier miss, so every afloat ship keeps an unshot cell', () => {
    const ships = fleet();
    // A miss at E1: s0 (A1-D1) may not take B1-E1, where E1 could never be shot again.
    expect(resolveShot(ships, 4, 0).result).toBe('miss');
    expect(moveShip(ships, 's0', 'forward', 8, { '4,0': 'miss' })).toEqual({ ok: false, reason: 'There is no room that way.' });
    // With the miss elsewhere the slide goes through and the fleet stays valid.
    const moved = moveShip(ships, 's0', 'forward', 8, { '7,7': 'miss' });
    if (!moved.ok) throw new Error('unreachable');
    expect(resolveShot(moved.ships, 4, 0).result).toBe('hit');
    expect(validateLayout(moved.ships, 'small', 8).ok).toBe(true);
  });
});
