/** Battleships geometry: board sizes and fleets by crew, layouts, random fleets and shots, all pure. */
import { describe, expect, it } from 'vitest';
import {
  allSunk,
  boardSizeFor,
  cellKey,
  cellLabel,
  completeLayout,
  fleetFor,
  fleetShipIds,
  hitCount,
  inBounds,
  isComplete,
  isSunk,
  occupiedCells,
  randomLayout,
  resolveShot,
  segmentAt,
  shipCells,
  shipsAfloat,
  validateLayout,
  type Ship,
} from './fleet.js';
import { BATTLESHIPS_CLASSIC_SIZE, BATTLESHIPS_MAX_BOARD_SIZE, type ShipPlacement } from './protocol.js';

const SMALL = [4, 3, 3, 2];
const CLASSIC = [5, 4, 3, 3, 2];

/** The small fleet laid out in rows: s0 at A1-D1, s1 at A2-C2, s2 at A3-C3, s3 at A4-B4. */
const ROWS: ShipPlacement[] = [
  { id: 's0', x: 0, y: 0, horizontal: true },
  { id: 's1', x: 0, y: 1, horizontal: true },
  { id: 's2', x: 0, y: 2, horizontal: true },
  { id: 's3', x: 0, y: 3, horizontal: true },
];

function fleet(placements: ShipPlacement[] = ROWS): Ship[] {
  const check = validateLayout(placements, SMALL, 10);
  if (!check.ok) throw new Error(check.reason);
  return check.ships;
}

/** A counter rng that walks through [0, 1) in `steps`, so successive picks differ. */
function sequence(steps: number): () => number {
  let i = 0;
  return () => ((i++ % steps) + 0.5) / steps;
}

describe('board sizes and fleets by crew', () => {
  it('gives one player the classic 10x10 and grows a shared board to 12, 13 and at most 14', () => {
    expect(BATTLESHIPS_CLASSIC_SIZE).toBe(10);
    expect([0, 1, 2, 3, 4, 5, 8].map(boardSizeFor)).toEqual([10, 10, 12, 13, 14, 14, 14]);
    expect(BATTLESHIPS_MAX_BOARD_SIZE).toBe(14);
    // Never double the classic area.
    expect(14 * 14).toBeLessThan(2 * 10 * 10);
  });

  it('adds one 3-ship per crew member beyond the first, longest first', () => {
    expect(fleetFor('small', 1)).toEqual(SMALL);
    expect(fleetFor('classic', 1)).toEqual(CLASSIC);
    expect(fleetFor('classic', 2)).toEqual([5, 4, 3, 3, 3, 2]);
    expect(fleetFor('classic', 3)).toEqual([5, 4, 3, 3, 3, 3, 2]);
    expect(fleetFor('small', 4)).toEqual([4, 3, 3, 3, 3, 3, 2]);
    expect(fleetFor('classic', 0)).toEqual(CLASSIC);
    expect(fleetShipIds(fleetFor('classic', 3))).toEqual(['s0', 's1', 's2', 's3', 's4', 's5', 's6']);
    // A copy: callers may not mutate the shared constant through it.
    fleetFor('small', 1).push(9);
    expect(fleetFor('small', 1)).toEqual(SMALL);
  });
});

describe('cells', () => {
  it('keys and labels cells up to the biggest board', () => {
    expect(cellKey(3, 4)).toBe('3,4');
    expect(cellLabel(0, 0)).toBe('A1');
    expect(cellLabel(9, 9)).toBe('J10');
    expect(cellLabel(13, 13)).toBe('N14');
  });

  it('walks a ship\'s cells along its axis and finds the segment on a cell', () => {
    expect(shipCells({ x: 1, y: 2, length: 3, horizontal: true })).toEqual([{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }]);
    expect(shipCells({ x: 1, y: 2, length: 2, horizontal: false })).toEqual([{ x: 1, y: 2 }, { x: 1, y: 3 }]);
    expect(segmentAt({ x: 1, y: 2, length: 3, horizontal: true }, 3, 2)).toBe(2);
    expect(segmentAt({ x: 1, y: 2, length: 3, horizontal: true }, 3, 3)).toBe(-1);
    expect(segmentAt({ x: 1, y: 2, length: 3, horizontal: false }, 1, 2)).toBe(0);
    expect(segmentAt({ x: 1, y: 2, length: 3, horizontal: false }, 1, 5)).toBe(-1);
    expect([...occupiedCells(fleet())].sort()).toEqual(['0,0', '0,1', '0,2', '0,3', '1,0', '1,1', '1,2', '1,3', '2,0', '2,1', '2,2', '3,0'].sort());
  });

  it('checks bounds on both axes', () => {
    expect(inBounds({ x: 7, y: 0, length: 3, horizontal: true }, 10)).toBe(true);
    expect(inBounds({ x: 8, y: 0, length: 3, horizontal: true }, 10)).toBe(false);
    expect(inBounds({ x: 0, y: 8, length: 3, horizontal: false }, 10)).toBe(false);
    expect(inBounds({ x: -1, y: 0, length: 2, horizontal: true }, 10)).toBe(false);
    expect(inBounds({ x: 10, y: 0, length: 1, horizontal: false }, 10)).toBe(false);
    expect(inBounds({ x: 11, y: 13, length: 3, horizontal: true }, 14)).toBe(true);
  });
});

describe('validateLayout', () => {
  it('accepts a complete fleet in bounds without overlaps, with no damage', () => {
    const check = validateLayout(ROWS, SMALL, 10);
    expect(check).toMatchObject({ ok: true, complete: true });
    if (!check.ok) throw new Error('unreachable');
    expect(check.ships).toEqual([
      { id: 's0', x: 0, y: 0, horizontal: true, length: 4, damage: [false, false, false, false] },
      { id: 's1', x: 0, y: 1, horizontal: true, length: 3, damage: [false, false, false] },
      { id: 's2', x: 0, y: 2, horizontal: true, length: 3, damage: [false, false, false] },
      { id: 's3', x: 0, y: 3, horizontal: true, length: 2, damage: [false, false] },
    ]);
  });

  it('allows ships to touch', () => {
    const touching: ShipPlacement[] = [
      { id: 's0', x: 0, y: 0, horizontal: true },
      { id: 's1', x: 4, y: 0, horizontal: true },
      { id: 's2', x: 0, y: 1, horizontal: false },
      { id: 's3', x: 1, y: 1, horizontal: false },
    ];
    expect(validateLayout(touching, SMALL, 10).ok).toBe(true);
  });

  it('refuses overlaps, ships off the board, duplicated and unknown ships', () => {
    const overlap = [...ROWS.slice(0, 3), { id: 's3', x: 2, y: 0, horizontal: false }];
    expect(validateLayout(overlap, SMALL, 10)).toEqual({ ok: false, reason: 'Ship s3 overlaps another ship.' });
    const off = [...ROWS.slice(0, 3), { id: 's3', x: 9, y: 9, horizontal: true }];
    expect(validateLayout(off, SMALL, 10)).toEqual({ ok: false, reason: 'Ship s3 is off the board.' });
    expect(validateLayout([...ROWS, { id: 's0', x: 0, y: 5, horizontal: true }], SMALL, 10)).toEqual({ ok: false, reason: 'Ship s0 must be placed exactly once.' });
    expect(validateLayout([...ROWS, { id: 's9', x: 0, y: 5, horizontal: true }], SMALL, 10)).toEqual({ ok: false, reason: 'Unknown ship in the layout.' });
  });

  it('takes a layout in progress: any ships of the fleet, in id order, and says whether it is complete', () => {
    const partial = validateLayout([ROWS[2], ROWS[0]], SMALL, 10);
    expect(partial).toMatchObject({ ok: true, complete: false });
    if (!partial.ok) throw new Error('unreachable');
    expect(partial.ships.map((s) => s.id)).toEqual(['s0', 's2']);
    expect(isComplete(partial.ships, SMALL)).toBe(false);
    expect(validateLayout([], SMALL, 10)).toEqual({ ok: true, ships: [], complete: false });
    // The classic fleet has five ships: a small layout is one short of complete.
    expect(validateLayout(ROWS, CLASSIC, 10)).toMatchObject({ ok: true, complete: false });
    expect(isComplete(fleet(), SMALL)).toBe(true);
  });

  it('applies the board size: a layout legal on a crew\'s 14x14 may hang off a 10x10', () => {
    const wide: ShipPlacement[] = [{ id: 's0', x: 9, y: 0, horizontal: true }, ...ROWS.slice(1)];
    expect(validateLayout(wide, SMALL, 14).ok).toBe(true);
    expect(validateLayout(wide, SMALL, 10).ok).toBe(false);
  });
});

describe('completeLayout', () => {
  it('fills in the ships still missing around the ones already placed, in id order', () => {
    const placed = validateLayout([ROWS[1], ROWS[3]], SMALL, 10);
    if (!placed.ok) throw new Error('unreachable');
    const ships = completeLayout(placed.ships, SMALL, 10, () => 0);
    expect(ships.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3']);
    expect(ships[1]).toMatchObject({ x: 0, y: 1, horizontal: true });
    expect(ships[3]).toMatchObject({ x: 0, y: 3, horizontal: true });
    expect(validateLayout(ships, SMALL, 10)).toMatchObject({ ok: true, complete: true });
    // The first free spots with rng () => 0: s0 along the top row, s2 right after it.
    expect(ships[0]).toMatchObject({ x: 0, y: 0, horizontal: true });
    expect(ships[2]).toMatchObject({ x: 4, y: 0, horizontal: true });
    expect(completeLayout(fleet(), SMALL, 10, () => 0)).toEqual(fleet());
  });

  it('fits the extra ships of a big crew, whatever the rng', () => {
    for (let crew = 1; crew <= 6; crew++) {
      const lengths = fleetFor('classic', crew);
      const size = boardSizeFor(crew);
      for (const rng of [() => 0, () => 0.999, sequence(7)]) {
        const ships = completeLayout([], lengths, size, rng);
        expect(ships.map((s) => s.length)).toEqual(lengths);
        expect(validateLayout(ships, lengths, size)).toMatchObject({ ok: true, complete: true });
      }
    }
  });
});

describe('randomLayout', () => {
  it('is valid for every fleet and crew and deterministic for a given rng', () => {
    for (const crew of [1, 2, 3, 4]) {
      for (const kind of ['small', 'classic'] as const) {
        const lengths = fleetFor(kind, crew);
        const size = boardSizeFor(crew);
        for (let seed = 1; seed <= 15; seed++) {
          const ships = randomLayout(lengths, size, sequence(seed));
          expect(ships.map((s) => s.length)).toEqual(lengths);
          expect(ships.map((s) => s.id)).toEqual(fleetShipIds(lengths));
          expect(validateLayout(ships, lengths, size).ok).toBe(true);
          expect(ships.every((s) => hitCount(s) === 0)).toBe(true);
          expect(randomLayout(lengths, size, sequence(seed))).toEqual(ships);
        }
      }
    }
  });

  it('packs the fleet into the first free positions with rng () => 0 and spreads it otherwise', () => {
    const packed = randomLayout(SMALL, 10, () => 0);
    expect(packed.map((s) => [s.x, s.y, s.horizontal])).toEqual([
      [0, 0, true],
      [4, 0, true],
      [7, 0, true],
      [0, 1, true],
    ]);
    const spread = randomLayout(SMALL, 10, () => 0.999);
    expect(spread[0]).toMatchObject({ x: 9, y: 6, horizontal: false });
    expect(spread).not.toEqual(packed);
  });
});

describe('shots', () => {
  it('reports a miss without changing the fleet', () => {
    const ships = fleet();
    const shot = resolveShot(ships, 7, 7);
    expect(shot).toEqual({ result: 'miss', ships, ship: null });
    expect(shot.ships).not.toBe(ships);
  });

  it('damages the segment hit, then sinks on the last one, never mutating the input', () => {
    const ships = fleet();
    const first = resolveShot(ships, 1, 3);
    expect(first.result).toBe('hit');
    expect(first.ship).toMatchObject({ id: 's3', damage: [false, true] });
    expect(ships[3].damage).toEqual([false, false]);
    expect(isSunk(first.ships[3])).toBe(false);
    expect(hitCount(first.ships[3])).toBe(1);
    const second = resolveShot(first.ships, 0, 3);
    expect(second.result).toBe('sunk');
    expect(second.ship).toMatchObject({ id: 's3', damage: [true, true], length: 2 });
    expect(isSunk(second.ships[3])).toBe(true);
    expect(shipsAfloat(second.ships)).toBe(3);
    expect(allSunk(second.ships)).toBe(false);
  });

  it('reads a damaged segment that moved onto an unshot square as a hit with no new damage', () => {
    const moved: Ship = { id: 's3', x: 5, y: 5, horizontal: true, length: 2, damage: [true, false] };
    const again = resolveShot([moved], 5, 5);
    expect(again.result).toBe('hit');
    expect(again.ship?.damage).toEqual([true, false]);
    expect(resolveShot(again.ships, 6, 5).result).toBe('sunk');
  });

  it('knows when every ship is down', () => {
    let ships = fleet();
    for (const ship of fleet()) for (const c of shipCells(ship)) ships = resolveShot(ships, c.x, c.y).ships;
    expect(allSunk(ships)).toBe(true);
    expect(shipsAfloat(ships)).toBe(0);
    expect(allSunk([])).toBe(false);
  });
});
