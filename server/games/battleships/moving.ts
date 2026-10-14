/**
 * Moving instead of firing: one afloat ship up to the turn's roll in a straight line, or a quarter
 * turn. The move is secret: the room hears that a ship moved, never which or where, and only the
 * mover's side sees the plan take shape.
 */
import { inBounds, isSunk } from '../../../shared/games/battleships/fleet.js';
import { applyShipMove, checkShipMove } from '../../../shared/games/battleships/moves.js';
import type { MovePlan, ShipMove } from '../../../shared/games/battleships/protocol.js';
import { fail, nameOf, snapshot, systemMessage, type Gx, type SideData } from './state.js';
import { beginTurn, recordTurn, shooterSide } from './turns.js';

/** The shooter's side and the turn's roll when a move is open to them, or null (with the reason sent). */
function moverSide(gx: Gx, playerId: string): { side: SideData; roll: number } | null {
  const side = shooterSide(gx, playerId);
  if (!side) return null;
  const { phase } = gx.data;
  if (!gx.data.moveOrFire || phase.kind !== 'turn' || phase.roll === null) {
    fail(gx, playerId, 'Moving is off in this game. Take your shot.');
    return null;
  }
  if (side.movedLastTurn) {
    fail(gx, playerId, 'You moved last turn. Fire this time.');
    return null;
  }
  return { side, roll: phase.roll };
}

export function move(gx: Gx, playerId: string, shipId: string, shipMove: ShipMove): void {
  const mover = moverSide(gx, playerId);
  if (!mover) return;
  const { side, roll } = mover;
  const check = checkShipMove(side.ships, shipId, shipMove, gx.data.size, side.shots, roll);
  if (!check.ok) return fail(gx, playerId, check.reason);
  side.ships = check.ships;
  recordTurn(gx, side, playerId, { kind: 'move', playerId, sideId: side.id, dice: roll });
  systemMessage(gx, `${nameOf(gx.ctx, playerId)} moved a ship.`);
  beginTurn(gx);
}

/**
 * The shooter's move in the making, for their teammates' eyes. The ghost may pass over squares it
 * could not stop on, so only the ship, the roll and the board edge are checked here.
 */
export function plan(gx: Gx, playerId: string, next: MovePlan | null): void {
  const mover = moverSide(gx, playerId);
  if (!mover || gx.data.phase.kind !== 'turn') return;
  if (next) {
    const ship = mover.side.ships.find((s) => s.id === next.shipId);
    if (!ship) return fail(gx, playerId, 'No such ship.');
    if (isSunk(ship)) return fail(gx, playerId, 'That ship is sunk.');
    if (next.move?.kind === 'shift' && next.move.steps > mover.roll) return fail(gx, playerId, `You rolled a ${mover.roll}.`);
    if (next.move && !inBounds(applyShipMove(ship, next.move), gx.data.size)) return fail(gx, playerId, 'That is off the board.');
  }
  gx.data.phase.plan = next;
  snapshot(gx);
}
