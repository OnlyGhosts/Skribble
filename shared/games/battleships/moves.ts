/**
 * Move or fire: moving one ship up to the roll in a straight line, or a quarter turn about its
 * centre square. Pure and shared: the server rules on a move, the client previews it.
 */
import { cellKey, inBounds, isSunk, overlaps, shipCells, type Ship, type ShipShape, type Shots } from './fleet.js';
import { BATTLESHIPS_DIRECTIONS, type MoveDirection, type ShipMove } from './protocol.js';

export const DIRECTION_STEP: Readonly<Record<MoveDirection, { dx: number; dy: number }>> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** The segment a ship turns about: the middle one, or the one before the middle for an even length. */
export function centreIndex(length: number): number {
  return Math.floor((length - 1) / 2);
}

export function shifted<T extends ShipShape>(ship: T, direction: MoveDirection, steps: number): T {
  const { dx, dy } = DIRECTION_STEP[direction];
  return { ...ship, x: ship.x + dx * steps, y: ship.y + dy * steps };
}

/**
 * The ship turned a quarter about its centre square. Segment order is kept (so damage stays on
 * the same segments) and turning twice puts it back exactly where it was.
 */
export function rotated<T extends ShipShape>(ship: T): T {
  const c = centreIndex(ship.length);
  const cx = ship.horizontal ? ship.x + c : ship.x;
  const cy = ship.horizontal ? ship.y : ship.y + c;
  return ship.horizontal ? { ...ship, x: cx, y: cy - c, horizontal: false } : { ...ship, x: cx - c, y: cy, horizontal: true };
}

export function applyShipMove<T extends ShipShape>(ship: T, move: ShipMove): T {
  return move.kind === 'rotate' ? rotated(ship) : shifted(ship, move.direction, move.steps);
}

/**
 * Why `next` (a moved copy of a ship in `ships`, same id) may not stop where it is, or null when
 * it may: on the board, on no other ship, and on no square already shot. The last rule keeps every
 * afloat ship sinkable: a shot square is never shot again, so an undamaged segment under one would
 * float for ever. The squares in between do not matter; a ship moves, it does not slide through.
 */
export function endProblem(ships: readonly Ship[], next: Ship, size: number, shots: Shots): string | null {
  if (!inBounds(next, size)) return 'That is off the board.';
  if (ships.some((other) => other.id !== next.id && overlaps(next, other))) return 'Another ship is already there.';
  if (shipCells(next).some((c) => shots[cellKey(c.x, c.y)])) return 'Ships cannot stop on a square that was already shot.';
  return null;
}

export type MoveCheck = { ok: true; ships: Ship[]; ship: Ship } | { ok: false; reason: string };

/** Rules on one move of `shipId` with `roll` on the die; a legal move comes back as the new fleet. */
export function checkShipMove(ships: readonly Ship[], shipId: string, move: ShipMove, size: number, shots: Shots, roll: number): MoveCheck {
  const ship = ships.find((s) => s.id === shipId);
  if (!ship) return { ok: false, reason: 'No such ship.' };
  if (isSunk(ship)) return { ok: false, reason: 'That ship is sunk.' };
  if (move.kind === 'shift' && move.steps > roll) return { ok: false, reason: `You rolled a ${roll}. Move up to ${roll} ${roll === 1 ? 'square' : 'squares'}.` };
  const next = applyShipMove(ship, move);
  const problem = endProblem(ships, next, size, shots);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, ship: next, ships: ships.map((s) => (s.id === shipId ? next : s)) };
}

export interface ShipOptions {
  /** Legal distances per direction, ascending (not always contiguous: a ship may jump a shot square). */
  steps: Record<MoveDirection, number[]>;
  rotate: boolean;
}

/** Every legal move of one ship with `roll` on the die. */
export function shipOptions(ships: readonly Ship[], shipId: string, size: number, shots: Shots, roll: number): ShipOptions {
  const steps: Record<MoveDirection, number[]> = { up: [], down: [], left: [], right: [] };
  for (const direction of BATTLESHIPS_DIRECTIONS) {
    for (let n = 1; n <= roll; n++) if (checkShipMove(ships, shipId, { kind: 'shift', direction, steps: n }, size, shots, roll).ok) steps[direction].push(n);
  }
  return { steps, rotate: checkShipMove(ships, shipId, { kind: 'rotate' }, size, shots, roll).ok };
}

export function hasOptions(options: ShipOptions): boolean {
  return options.rotate || BATTLESHIPS_DIRECTIONS.some((d) => options.steps[d].length > 0);
}

/** Ids of the ships with at least one legal move. */
export function movableShipIds(ships: readonly Ship[], size: number, shots: Shots, roll: number): string[] {
  return ships.filter((s) => !isSunk(s) && hasOptions(shipOptions(ships, s.id, size, shots, roll))).map((s) => s.id);
}
