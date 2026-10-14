/** Firing: a called shot, the clock's shot on a shooter's behalf, scoring, the log and elimination. */
import { allSunk, cellKey, cellLabel, resolveShot, shipCells } from '../../../shared/games/battleships/fleet.js';
import { BATTLESHIPS_LOG_LENGTH, BATTLESHIPS_POINTS, type ShotEvent } from '../../../shared/games/battleships/protocol.js';
import { aliveSides, award, fail, nameOf, pick, sideById, sideName, systemMessage, type Gx, type SideData } from './state.js';
import { beginTurn, finishGame, recordTurn, shooterSide } from './turns.js';

export function fire(gx: Gx, playerId: string, targetId: string, x: number, y: number): void {
  const { data } = gx;
  const side = shooterSide(gx, playerId);
  if (!side) return;
  const target = sideById(data, targetId);
  if (!target || !target.alive || target.id === side.id) return fail(gx, playerId, 'Pick an opponent\'s grid.');
  if (x >= data.size || y >= data.size) return fail(gx, playerId, 'That cell is off the board.');
  if (target.shots[cellKey(x, y)]) return fail(gx, playerId, 'That cell was already shot.');
  applyShot(gx, side, playerId, target, x, y, false);
}

/** Cells of `target` nobody has shot yet, in scan order. */
function openCells(gx: Gx, target: SideData): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < gx.data.size; y++) for (let x = 0; x < gx.data.size; x++) if (!target.shots[cellKey(x, y)]) cells.push({ x, y });
  return cells;
}

/**
 * The turn clock ran out before a shot or a move: a random shot at a random opponent on the
 * shooter's behalf. A ship never stops on a shot cell, so an afloat opponent always has an open
 * cell; should none be left all the same, the battle is called a draw rather than dealt turn after
 * empty turn.
 */
export function fireTimedOut(gx: Gx): void {
  const { ctx, data } = gx;
  if (data.phase.kind !== 'turn') return;
  const { shooterId, sideId } = data.phase;
  const side = sideById(data, sideId);
  if (!side) return beginTurn(gx);
  const targets = aliveSides(data).filter((s) => s.id !== side.id && openCells(gx, s).length > 0);
  if (targets.length === 0) {
    systemMessage(gx, 'No cell is left to shoot at. The battle is a draw.');
    return finishGame(gx, null);
  }
  const target = pick(ctx, targets);
  const cell = pick(ctx, openCells(gx, target));
  systemMessage(gx, `${nameOf(ctx, shooterId)} ran out of time. A shot is fired for them.`);
  applyShot(gx, side, shooterId, target, cell.x, cell.y, true);
}

function applyShot(gx: Gx, side: SideData, shooterId: string, target: SideData, x: number, y: number, auto: boolean): void {
  const { ctx, data } = gx;
  const dice = data.phase.kind === 'turn' ? data.phase.roll : null;
  const outcome = resolveShot(target.ships, x, y);
  target.ships = outcome.ships;
  target.shots[cellKey(x, y)] = outcome.result;
  if (outcome.result === 'sunk' && outcome.ship) for (const c of shipCells(outcome.ship)) target.shots[cellKey(c.x, c.y)] = 'sunk';

  const shooter = nameOf(ctx, shooterId);
  const where = `${sideName(ctx, data, target)} ${cellLabel(x, y)}`;
  // Only a sink names its ship: a hit must not tell the room which length it found.
  const length = outcome.result === 'sunk' ? outcome.ship?.length ?? null : null;
  if (outcome.result === 'miss') systemMessage(gx, `${shooter} fires at ${where}: miss.`);
  else if (outcome.result === 'hit') gx.effects.push({ type: 'chat', to: 'all', kind: 'close', text: `${shooter} fires at ${where}: hit!` });
  else gx.effects.push({ type: 'chat', to: 'all', kind: 'correct', text: `${shooter} fires at ${where}: sunk a ${length}-ship!` });
  if (outcome.result !== 'miss') award(gx, shooterId, BATTLESHIPS_POINTS.hit + (outcome.result === 'sunk' ? BATTLESHIPS_POINTS.sink : 0));

  const event: ShotEvent = { shooterId, targetId: target.id, x, y, result: outcome.result, length, dice, auto };
  data.log.push(event);
  if (data.log.length > BATTLESHIPS_LOG_LENGTH) data.log.splice(0, data.log.length - BATTLESHIPS_LOG_LENGTH);
  recordTurn(gx, side, shooterId, { kind: 'fire', shot: { ...event } });

  if (allSunk(target.ships)) {
    target.alive = false;
    systemMessage(gx, `${sideName(ctx, data, target)}'s fleet is sunk. ${data.mode === 'teams' ? `Team ${target.id} is` : 'They are'} out!`);
  }
  beginTurn(gx);
}
