/**
 * Battleships geometry, pure and shared by both sides: board sizes and fleets by crew, ship ids,
 * cell keys and labels, layout validation, random layouts and shot resolution. Moving a ship lives
 * in moves.ts. Nothing here reads a clock or the global random source; randomness is passed in.
 */
import {
  BATTLESHIPS_BOARD_SIZES,
  BATTLESHIPS_EXTRA_SHIP_LENGTH,
  BATTLESHIPS_FLEETS,
  type BattleshipsFleet,
  type CellMark,
  type ShipPlacement,
  type ShotResult,
} from './protocol.js';

export interface Ship extends ShipPlacement {
  length: number;
  /** Per segment, counted from (x, y) along the ship: damaged or not. */
  damage: boolean[];
}

export interface Cell {
  x: number;
  y: number;
}

export type ShipShape = Pick<Ship, 'x' | 'y' | 'length' | 'horizontal'>;
export type Shots = Readonly<Record<string, CellMark>>;

/** The board side for a crew of players sharing it: 10, 12, 13, then 14 for four or more. */
export function boardSizeFor(crew: number): number {
  const index = Math.min(BATTLESHIPS_BOARD_SIZES.length, Math.max(1, crew)) - 1;
  return BATTLESHIPS_BOARD_SIZES[index];
}

/** The fleet's ship lengths for a crew, longest first: every member beyond the first adds a 3-ship. */
export function fleetFor(fleet: BattleshipsFleet, crew: number): number[] {
  const extra = new Array<number>(Math.max(0, crew - 1)).fill(BATTLESHIPS_EXTRA_SHIP_LENGTH);
  return [...BATTLESHIPS_FLEETS[fleet], ...extra].sort((a, b) => b - a);
}

/** Ship ids are positional ('s0' is the longest ship), so a layout message can name them. */
export function shipId(index: number): string {
  return `s${index}`;
}

export function fleetShipIds(lengths: readonly number[]): string[] {
  return lengths.map((_, i) => shipId(i));
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** 'A1' style: a column letter and a 1-based row. */
export function cellLabel(x: number, y: number): string {
  return `${String.fromCharCode(65 + x)}${y + 1}`;
}

export function shipCells(ship: ShipShape): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < ship.length; i++) cells.push(ship.horizontal ? { x: ship.x + i, y: ship.y } : { x: ship.x, y: ship.y + i });
  return cells;
}

/** The segment of `ship` on (x, y), or -1. */
export function segmentAt(ship: ShipShape, x: number, y: number): number {
  const i = ship.horizontal ? x - ship.x : y - ship.y;
  const across = ship.horizontal ? y === ship.y : x === ship.x;
  return across && i >= 0 && i < ship.length ? i : -1;
}

export function inBounds(ship: ShipShape, size: number): boolean {
  if (ship.x < 0 || ship.y < 0) return false;
  return ship.horizontal ? ship.x + ship.length <= size && ship.y < size : ship.y + ship.length <= size && ship.x < size;
}

export function overlaps(a: ShipShape, b: ShipShape): boolean {
  const taken = new Set(shipCells(a).map((c) => cellKey(c.x, c.y)));
  return shipCells(b).some((c) => taken.has(cellKey(c.x, c.y)));
}

/** True when `ship` sits in bounds and on no other ship of `fleet` (its own entry, by id, is ignored). */
export function fits(ship: Ship, fleet: readonly Ship[], size: number): boolean {
  return inBounds(ship, size) && fleet.every((other) => other.id === ship.id || !overlaps(ship, other));
}

export function newShip(placement: ShipPlacement, length: number): Ship {
  return { id: placement.id, x: placement.x, y: placement.y, horizontal: placement.horizontal, length, damage: new Array<boolean>(length).fill(false) };
}

export type LayoutCheck = { ok: true; ships: Ship[]; complete: boolean } | { ok: false; reason: string };

/** True once every ship of the fleet is in `ships`. */
export function isComplete(ships: readonly Pick<Ship, 'id'>[], lengths: readonly number[]): boolean {
  return fleetShipIds(lengths).every((id) => ships.some((s) => s.id === id));
}

/**
 * Turns a layout message into a fleet: any ships of the fleet, each at most once, in bounds, no
 * two overlapping (touching is fine), in ship-id order. A partial layout is a layout in progress
 * (`complete` says whether every ship has a spot). Fresh ships carry no damage.
 */
export function validateLayout(placements: readonly ShipPlacement[], lengths: readonly number[], size: number): LayoutCheck {
  const ships: Ship[] = [];
  for (let i = 0; i < lengths.length; i++) {
    const found = placements.filter((p) => p.id === shipId(i));
    if (found.length > 1) return { ok: false, reason: `Ship ${shipId(i)} must be placed exactly once.` };
    if (found.length === 0) continue;
    const ship = newShip(found[0], lengths[i]);
    if (!inBounds(ship, size)) return { ok: false, reason: `Ship ${ship.id} is off the board.` };
    if (ships.some((other) => overlaps(ship, other))) return { ok: false, reason: `Ship ${ship.id} overlaps another ship.` };
    ships.push(ship);
  }
  if (placements.length !== ships.length) return { ok: false, reason: 'Unknown ship in the layout.' };
  return { ok: true, ships, complete: ships.length === lengths.length };
}

/** Every position a ship of `length` could take on an otherwise `placed` board, in scan order. */
function candidates(length: number, id: string, placed: readonly Ship[], size: number): Ship[] {
  const out: Ship[] = [];
  for (const horizontal of [true, false]) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ship = newShip({ id, x, y, horizontal }, length);
        if (fits(ship, placed, size)) out.push(ship);
      }
    }
  }
  return out;
}

/**
 * Fills in the ships of the fleet missing from `placed` (a layout in progress, or nothing at all),
 * longest first, each picking uniformly among the positions still free. Every fleet covers well
 * under a fifth of its board, so room always exists and no retries are needed. The result is in
 * ship-id order.
 */
export function completeLayout(placed: readonly Ship[], lengths: readonly number[], size: number, rng: () => number): Ship[] {
  const ships: Ship[] = [...placed];
  lengths.forEach((length, i) => {
    if (ships.some((s) => s.id === shipId(i))) return;
    const options = candidates(length, shipId(i), ships, size);
    if (options.length === 0) throw new Error(`no room for a ship of length ${length} on a ${size}x${size} board`);
    ships.push(options[Math.min(options.length - 1, Math.floor(rng() * options.length))]);
  });
  return ships.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

/** A random valid layout. */
export function randomLayout(lengths: readonly number[], size: number, rng: () => number): Ship[] {
  return completeLayout([], lengths, size, rng);
}

export interface ShotOutcome {
  result: ShotResult;
  ships: Ship[];
  /** The ship hit or sunk. */
  ship: Ship | null;
}

/**
 * Resolves a shot against a fleet without touching it: the damaged fleet comes back as a new
 * array. A segment damaged before its ship moved onto an unshot square reads as a hit again but
 * takes no new damage.
 */
export function resolveShot(ships: readonly Ship[], x: number, y: number): ShotOutcome {
  const index = ships.findIndex((ship) => segmentAt(ship, x, y) >= 0);
  if (index < 0) return { result: 'miss', ships: [...ships], ship: null };
  const before = ships[index];
  const segment = segmentAt(before, x, y);
  const ship: Ship = { ...before, damage: before.damage.map((d, i) => d || i === segment) };
  const next = ships.map((s, i) => (i === index ? ship : s));
  return { result: isSunk(ship) ? 'sunk' : 'hit', ships: next, ship };
}

export function hitCount(ship: Pick<Ship, 'damage'>): number {
  return ship.damage.filter(Boolean).length;
}

export function isSunk(ship: Pick<Ship, 'damage'>): boolean {
  return ship.damage.length > 0 && ship.damage.every(Boolean);
}

export function allSunk(ships: readonly Ship[]): boolean {
  return ships.length > 0 && ships.every(isSunk);
}

export function shipsAfloat(ships: readonly Ship[]): number {
  return ships.filter((s) => !isSunk(s)).length;
}

/** Cells of every ship, keyed, for a quick membership test. */
export function occupiedCells(ships: readonly Ship[]): Set<string> {
  return new Set(ships.flatMap((ship) => shipCells(ship).map((c) => cellKey(c.x, c.y))));
}
