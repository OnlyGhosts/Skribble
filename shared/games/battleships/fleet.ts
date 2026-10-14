/**
 * Battleships geometry, pure and shared by both sides: fleets and ship ids, cell keys and labels,
 * layout validation, random layouts, shot resolution and the secret slide after a lucky roll.
 * Nothing here reads a clock or the global random source; randomness is passed in.
 */
import { BATTLESHIPS_FLEETS, type BattleshipsFleet, type CellMark, type MoveDirection, type ShipPlacement, type ShotResult } from './protocol.js';

export interface Ship extends ShipPlacement {
  length: number;
  /** Damaged segments so far. */
  hits: number;
}

export interface Cell {
  x: number;
  y: number;
}

export function fleetLengths(fleet: BattleshipsFleet): number[] {
  return [...BATTLESHIPS_FLEETS[fleet]];
}

/** Ship ids are positional ('s0' is the longest ship), so a layout message can name them. */
export function shipId(index: number): string {
  return `s${index}`;
}

export function fleetShipIds(fleet: BattleshipsFleet): string[] {
  return fleetLengths(fleet).map((_, i) => shipId(i));
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** 'A1' style: a column letter and a 1-based row. */
export function cellLabel(x: number, y: number): string {
  return `${String.fromCharCode(65 + x)}${y + 1}`;
}

export function shipCells(ship: Pick<Ship, 'x' | 'y' | 'length' | 'horizontal'>): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < ship.length; i++) cells.push(ship.horizontal ? { x: ship.x + i, y: ship.y } : { x: ship.x, y: ship.y + i });
  return cells;
}

export function inBounds(ship: Pick<Ship, 'x' | 'y' | 'length' | 'horizontal'>, size: number): boolean {
  if (ship.x < 0 || ship.y < 0) return false;
  return ship.horizontal ? ship.x + ship.length <= size && ship.y < size : ship.y + ship.length <= size && ship.x < size;
}

function overlaps(a: Pick<Ship, 'x' | 'y' | 'length' | 'horizontal'>, b: Pick<Ship, 'x' | 'y' | 'length' | 'horizontal'>): boolean {
  const taken = new Set(shipCells(a).map((c) => cellKey(c.x, c.y)));
  return shipCells(b).some((c) => taken.has(cellKey(c.x, c.y)));
}

/** True when `ship` sits in bounds and on no other ship of `fleet` (its own entry, by id, is ignored). */
export function fits(ship: Ship, fleet: readonly Ship[], size: number): boolean {
  return inBounds(ship, size) && fleet.every((other) => other.id === ship.id || !overlaps(ship, other));
}

export type LayoutCheck = { ok: true; ships: Ship[]; complete: boolean } | { ok: false; reason: string };

/** True once every ship of `fleet` is in `ships`. */
export function isComplete(ships: readonly Pick<Ship, 'id'>[], fleet: BattleshipsFleet): boolean {
  return fleetShipIds(fleet).every((id) => ships.some((s) => s.id === id));
}

/**
 * Turns a layout message into a fleet: any ships of the fleet, each at most once, in bounds, no
 * two overlapping (touching is fine), in ship-id order. A partial layout is a layout in progress
 * (`complete` says whether every ship has a spot). Fresh ships carry no damage.
 */
export function validateLayout(placements: readonly ShipPlacement[], fleet: BattleshipsFleet, size: number): LayoutCheck {
  const lengths = fleetLengths(fleet);
  const ships: Ship[] = [];
  for (let i = 0; i < lengths.length; i++) {
    const found = placements.filter((p) => p.id === shipId(i));
    if (found.length > 1) return { ok: false, reason: `Ship ${shipId(i)} must be placed exactly once.` };
    if (found.length === 0) continue;
    const ship: Ship = { ...found[0], length: lengths[i], hits: 0 };
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
        const ship: Ship = { id, x, y, length, horizontal, hits: 0 };
        if (fits(ship, placed, size)) out.push(ship);
      }
    }
  }
  return out;
}

/**
 * Fills in the ships of `fleet` missing from `placed` (a layout in progress, or nothing at all),
 * longest first, each picking uniformly among the positions still free. Room always exists on an
 * 8x8 board for either fleet, so no retries are needed. The result is in ship-id order.
 */
export function completeLayout(placed: readonly Ship[], fleet: BattleshipsFleet, size: number, rng: () => number): Ship[] {
  const ships: Ship[] = [...placed];
  fleetLengths(fleet).forEach((length, i) => {
    if (ships.some((s) => s.id === shipId(i))) return;
    const options = candidates(length, shipId(i), ships, size);
    if (options.length === 0) throw new Error(`no room for a ship of length ${length} on a ${size}x${size} board`);
    ships.push(options[Math.min(options.length - 1, Math.floor(rng() * options.length))]);
  });
  return ships.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

/** A random valid layout. */
export function randomLayout(fleet: BattleshipsFleet, size: number, rng: () => number): Ship[] {
  return completeLayout([], fleet, size, rng);
}

export interface ShotOutcome {
  result: ShotResult;
  ships: Ship[];
  /** The ship hit or sunk. */
  ship: Ship | null;
}

/** Resolves a shot against a fleet without touching it: the damaged fleet comes back as a new array. */
export function resolveShot(ships: readonly Ship[], x: number, y: number): ShotOutcome {
  const index = ships.findIndex((ship) => shipCells(ship).some((c) => c.x === x && c.y === y));
  if (index < 0) return { result: 'miss', ships: [...ships], ship: null };
  const ship: Ship = { ...ships[index], hits: ships[index].hits + 1 };
  const next = ships.map((s, i) => (i === index ? ship : s));
  return { result: ship.hits >= ship.length ? 'sunk' : 'hit', ships: next, ship };
}

export function isSunk(ship: Ship): boolean {
  return ship.hits >= ship.length;
}

export function allSunk(ships: readonly Ship[]): boolean {
  return ships.length > 0 && ships.every(isSunk);
}

export function shipsAfloat(ships: readonly Ship[]): number {
  return ships.filter((s) => !isSunk(s)).length;
}

/** The ship one cell further along its own axis ('forward' is right / down). */
export function slid(ship: Ship, direction: MoveDirection): Ship {
  const step = direction === 'forward' ? 1 : -1;
  return ship.horizontal ? { ...ship, x: ship.x + step } : { ...ship, y: ship.y + step };
}

/**
 * An undamaged ship may slide into free, in-bounds cells that nobody has shot at: a cell already
 * marked is never shot again, so a ship under one could never be sunk.
 */
export function canSlide(ships: readonly Ship[], ship: Ship, direction: MoveDirection, size: number, shots: Readonly<Record<string, CellMark>>): boolean {
  if (ship.hits > 0) return false;
  const next = slid(ship, direction);
  return fits(next, ships, size) && shipCells(next).every((c) => !shots[cellKey(c.x, c.y)]);
}

export function movableShips(ships: readonly Ship[], size: number, shots: Readonly<Record<string, CellMark>>): Array<{ id: string; forward: boolean; back: boolean }> {
  return ships
    .map((ship) => ({ id: ship.id, forward: canSlide(ships, ship, 'forward', size, shots), back: canSlide(ships, ship, 'back', size, shots) }))
    .filter((m) => m.forward || m.back);
}

export type MoveCheck = { ok: true; ships: Ship[] } | { ok: false; reason: string };

export function moveShip(ships: readonly Ship[], shipId: string, direction: MoveDirection, size: number, shots: Readonly<Record<string, CellMark>>): MoveCheck {
  const ship = ships.find((s) => s.id === shipId);
  if (!ship) return { ok: false, reason: 'No such ship.' };
  if (ship.hits > 0) return { ok: false, reason: 'A damaged ship cannot move.' };
  if (!canSlide(ships, ship, direction, size, shots)) return { ok: false, reason: 'There is no room that way.' };
  return { ok: true, ships: ships.map((s) => (s.id === shipId ? slid(s, direction) : s)) };
}

/** Cells of every ship, keyed, for a quick membership test. */
export function occupiedCells(ships: readonly Ship[]): Set<string> {
  return new Set(ships.flatMap((ship) => shipCells(ship).map((c) => cellKey(c.x, c.y))));
}
