/**
 * The shooter's move in the making under move or fire: a picked ship and a ghost that steps one
 * square at a time in one straight line, or turns a quarter. Pure helpers over the shared move
 * rules, so the panel, the store and the tests agree with the server.
 */
import { inBounds, isSunk, type Ship, type Shots } from '@shared/games/battleships/fleet';
import { applyShipMove, checkShipMove, movableShipIds } from '@shared/games/battleships/moves';
import type { MoveDirection, ShipMove } from '@shared/games/battleships/protocol';

export const OPPOSITE: Readonly<Record<MoveDirection, MoveDirection>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export type Step = { ok: true; move: ShipMove | null } | { ok: false; reason: string };

/** Squares still to spend: the whole roll before any step, none after a quarter turn. */
export function movesLeft(move: ShipMove | null, roll: number): number {
  if (!move) return roll;
  return move.kind === 'rotate' ? 0 : roll - move.steps;
}

/** One square in `direction`: further along the line, back towards the start, or why not. */
export function stepGhost(ship: Ship, move: ShipMove | null, direction: MoveDirection, roll: number, size: number): Step {
  let next: ShipMove | null;
  if (!move) next = { kind: 'shift', direction, steps: 1 };
  else if (move.kind === 'rotate') return { ok: false, reason: 'Turning uses the whole move. Reset to slide instead.' };
  else if (move.direction === OPPOSITE[direction]) next = move.steps > 1 ? { ...move, steps: move.steps - 1 } : null;
  else if (move.direction !== direction) return { ok: false, reason: 'A ship moves in a straight line. Reset to change direction.' };
  else if (move.steps >= roll) return { ok: false, reason: 'No moves left.' };
  else next = { ...move, steps: move.steps + 1 };
  if (next && !inBounds(applyShipMove(ship, next), size)) return { ok: false, reason: 'That is off the board.' };
  return { ok: true, move: next };
}

/** A quarter turn about the centre square, or back again; never on top of a slide. */
export function turnGhost(ship: Ship, move: ShipMove | null, size: number): Step {
  if (move?.kind === 'rotate') return { ok: true, move: null };
  if (move) return { ok: false, reason: 'Turning uses the whole move. Reset first.' };
  if (!inBounds(applyShipMove(ship, { kind: 'rotate' }), size)) return { ok: false, reason: 'No room to turn here.' };
  return { ok: true, move: { kind: 'rotate' } };
}

/** Why the ghost may not stop where it is (or has not moved yet), or null when Confirm may go. */
export function confirmProblem(ships: readonly Ship[], shipId: string, move: ShipMove | null, size: number, shots: Shots, roll: number): string | null {
  if (!move) return 'Move the ship first.';
  const check = checkShipMove(ships, shipId, move, size, shots, roll);
  return check.ok ? null : check.reason;
}

/** Why a tap on this ship cannot pick it, or null when it can. */
export function pickProblem(ships: readonly Ship[], shipId: string, size: number, shots: Shots, roll: number): string | null {
  const ship = ships.find((s) => s.id === shipId);
  if (!ship) return 'No such ship.';
  if (isSunk(ship)) return 'That ship is sunk.';
  if (!movableShipIds(ships, size, shots, roll).includes(shipId)) return 'That ship has no room to move.';
  return null;
}

/** Why Move is not on offer this turn, or null when it is. */
export function moveUnavailable(canMove: boolean, movedLastTurn: boolean, ships: readonly Ship[], size: number, shots: Shots, roll: number): string | null {
  if (movedLastTurn) return 'You moved last turn. Fire this time.';
  if (!canMove) return 'Moving is off in this game.';
  if (movableShipIds(ships, size, shots, roll).length === 0) return 'None of your ships has room to move.';
  return null;
}

/** Where the ghost sits: the picked ship with the move so far applied. */
export function ghostOf<T extends Ship>(ship: T, move: ShipMove | null): T {
  return move ? applyShipMove(ship, move) : ship;
}
