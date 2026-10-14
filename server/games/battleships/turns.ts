/** The shooting: turn order, shots and their scoring, the dice and the secret slide, elimination, holds and the win. */
import { cellKey, cellLabel, moveShip, resolveShot, shipCells } from '../../../shared/games/battleships/fleet.js';
import {
  BATTLESHIPS_LOG_LENGTH,
  BATTLESHIPS_MOVE_ROLL,
  BATTLESHIPS_MOVE_SECONDS,
  BATTLESHIPS_POINTS,
  type MoveDirection,
  type ShotEvent,
} from '../../../shared/games/battleships/protocol.js';
import { RESUME_SETTLE_MS, holdEffects, resumeEffect } from '../waiting.js';
import {
  aliveSides,
  award,
  connectedAliveSides,
  connectedMembers,
  fail,
  nameOf,
  pick,
  playersInPlay,
  rollDie,
  sideById,
  sideName,
  sideOf,
  snapshot,
  systemMessage,
  type Gx,
  type SideData,
} from './state.js';

/** The alive side after `lastSide` with somebody connected, wrapping; its first connected member after the last shooter is up. */
function nextShooter(gx: Gx): { sideIndex: number; shooterId: string } | null {
  const { ctx, data } = gx;
  const n = data.sides.length;
  for (let step = 1; step <= n; step++) {
    const sideIndex = (data.lastSide + step) % n;
    const side = data.sides[sideIndex];
    if (!side.alive) continue;
    const connected = connectedMembers(ctx, side);
    if (connected.length === 0) continue;
    const members = side.memberIds;
    const last = side.lastShooterId === null ? -1 : members.indexOf(side.lastShooterId);
    for (let m = 1; m <= members.length; m++) {
      const id = members[(last + m) % members.length];
      if (connected.some((p) => p.id === id)) return { sideIndex, shooterId: id };
    }
  }
  return null;
}

/**
 * The turn boundary: the next shooter, a hold while fewer than two sides have anybody connected,
 * or the end of the game once a single fleet is left afloat.
 */
export function beginTurn(gx: Gx): void {
  const { ctx, data } = gx;
  if (data.phase.kind === 'gameOver') return;
  const alive = aliveSides(data);
  if (alive.length < 2) return finishGame(gx, alive[0] ?? null);
  if (connectedAliveSides(ctx, data).length < 2) return hold(gx);
  const next = nextShooter(gx);
  if (!next) return hold(gx);
  if (data.phase.kind === 'held') gx.effects.push(resumeEffect());
  const side = data.sides[next.sideIndex];
  data.phase = { kind: 'turn', sideId: side.id, shooterId: next.shooterId, endsAt: ctx.now + ctx.settings.turnSeconds * 1000 };
  snapshot(gx);
}

/** Holds at the boundary; called again while held whenever the player list changes so the missing list stays current. */
function hold(gx: Gx): void {
  const { ctx, data } = gx;
  const fresh = data.phase.kind !== 'held';
  data.phase = { kind: 'held', resumeAt: null };
  gx.effects.push(...holdEffects(playersInPlay(ctx, data), fresh));
}

/** Re-evaluates a hold after the player list changed: a settle before the next turn once enough are back. */
export function resumeIfHeld(gx: Gx): void {
  const { ctx, data } = gx;
  if (data.phase.kind !== 'held') return;
  if (aliveSides(data).length < 2 || connectedAliveSides(ctx, data).length < 2) return beginTurn(gx);
  data.phase.resumeAt = ctx.now + RESUME_SETTLE_MS;
  gx.effects.push(...holdEffects(playersInPlay(ctx, data), false));
}

export function settleDue(gx: Gx): void {
  const { ctx, data } = gx;
  if (data.phase.kind !== 'held' || data.phase.resumeAt === null || ctx.now < data.phase.resumeAt) return;
  beginTurn(gx);
}

/** The shooter's side, or the reason `playerId` may not act. */
function shooterSide(gx: Gx, playerId: string, kind: 'turn' | 'moving'): SideData | null {
  const { data } = gx;
  if (data.phase.kind !== kind || data.phase.shooterId !== playerId) {
    fail(gx, playerId, kind === 'turn' ? 'It is not your turn.' : 'You have no move right now.');
    return null;
  }
  return sideById(data, data.phase.sideId) ?? null;
}

export function fire(gx: Gx, playerId: string, targetId: string, x: number, y: number): void {
  const { data } = gx;
  const side = shooterSide(gx, playerId, 'turn');
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
 * The turn clock ran out: a random shot at a random opponent on the shooter's behalf. A ship
 * never sits on a shot cell, so an afloat opponent always has an open cell; should none be left
 * all the same, the battle is called a draw rather than dealt turn after empty turn.
 */
export function fireTimedOut(gx: Gx): void {
  const { ctx, data } = gx;
  if (data.phase.kind !== 'turn') return;
  const { shooterId, sideId } = data.phase;
  const side = sideById(data, sideId);
  if (!side) return beginTurn(gx);
  const targets = aliveSides(data).filter((s) => s.id !== side.id && openCells(gx, s).length > 0);
  if (targets.length === 0) {
    systemMessage(gx, 'No cell is left to shoot at — the battle is a draw.');
    return finishGame(gx, null);
  }
  const target = pick(ctx, targets);
  const cell = pick(ctx, openCells(gx, target));
  systemMessage(gx, `${nameOf(ctx, shooterId)} ran out of time — a shot is fired for them.`);
  applyShot(gx, side, shooterId, target, cell.x, cell.y, true);
}

function applyShot(gx: Gx, side: SideData, shooterId: string, target: SideData, x: number, y: number, auto: boolean): void {
  const { ctx, data } = gx;
  const outcome = resolveShot(target.ships, x, y);
  target.ships = outcome.ships;
  target.shots[cellKey(x, y)] = outcome.result;
  if (outcome.result === 'sunk' && outcome.ship) for (const c of shipCells(outcome.ship)) target.shots[cellKey(c.x, c.y)] = 'sunk';
  side.lastShooterId = shooterId;
  data.lastSide = data.sides.indexOf(side);
  data.shotsTaken += 1;
  data.dice = null;

  const shooter = nameOf(ctx, shooterId);
  const where = `${sideName(ctx, data, target)} ${cellLabel(x, y)}`;
  // Only a sink names its ship: a hit must not tell the room which length it found.
  const length = outcome.result === 'sunk' ? outcome.ship?.length ?? null : null;
  if (outcome.result === 'miss') systemMessage(gx, `${shooter} fires at ${where}: miss.`);
  else if (outcome.result === 'hit') gx.effects.push({ type: 'chat', to: 'all', kind: 'close', text: `${shooter} fires at ${where}: hit!` });
  else gx.effects.push({ type: 'chat', to: 'all', kind: 'correct', text: `${shooter} fires at ${where}: sunk a ${length}-ship!` });
  if (outcome.result !== 'miss') award(gx, shooterId, BATTLESHIPS_POINTS.hit + (outcome.result === 'sunk' ? BATTLESHIPS_POINTS.sink : 0));

  const event: ShotEvent = { shooterId, targetId: target.id, x, y, result: outcome.result, length, dice: null, auto };
  data.log.push(event);
  if (data.log.length > BATTLESHIPS_LOG_LENGTH) data.log.splice(0, data.log.length - BATTLESHIPS_LOG_LENGTH);

  if (target.ships.every((s) => s.hits >= s.length)) {
    target.alive = false;
    systemMessage(gx, `${sideName(ctx, data, target)}'s fleet is sunk — ${data.mode === 'teams' ? `Team ${target.id} is` : 'they are'} out!`);
    if (aliveSides(data).length < 2) return beginTurn(gx);
  }

  if (ctx.settings.diceMoves) {
    const roll = rollDie(ctx);
    data.dice = roll;
    event.dice = roll;
    // The window opens whether or not a ship can slide: saying "no ship can move" would tell the
    // room that every afloat ship is damaged or boxed in. The shooter's own view lists what can go.
    if (roll >= BATTLESHIPS_MOVE_ROLL) {
      data.phase = { kind: 'moving', sideId: side.id, shooterId, endsAt: ctx.now + BATTLESHIPS_MOVE_SECONDS * 1000 };
      gx.effects.push({ type: 'chat', to: 'all', kind: 'hint', text: `${shooter} rolls a ${roll} — a ship may slip away!` });
      return snapshot(gx);
    }
  }
  beginTurn(gx);
}

/** The secret slide: nobody but the shooter's side learns whether, or what, moved. */
export function move(gx: Gx, playerId: string, shipId: string, direction: MoveDirection): void {
  const side = shooterSide(gx, playerId, 'moving');
  if (!side) return;
  const moved = moveShip(side.ships, shipId, direction, gx.data.size, side.shots);
  if (!moved.ok) return fail(gx, playerId, moved.reason);
  side.ships = moved.ships;
  beginTurn(gx);
}

export function skipMove(gx: Gx, playerId: string): void {
  if (!shooterSide(gx, playerId, 'moving')) return;
  beginTurn(gx);
}

/** The move window closed on its own (or its shooter dropped): the fleet stays where it is. */
export function endMove(gx: Gx): void {
  if (gx.data.phase.kind !== 'moving') return;
  beginTurn(gx);
}

/** The current shooter's socket dropped: their turn is skipped (the side goes on with another member in teams). */
export function shooterAway(gx: Gx, playerId: string): void {
  const { ctx, data } = gx;
  if ((data.phase.kind !== 'turn' && data.phase.kind !== 'moving') || data.phase.shooterId !== playerId) return;
  systemMessage(gx, `${nameOf(ctx, playerId)} is away — skipping their turn.`);
  beginTurn(gx);
}

/** A seat left for good: a solo fleet drifts away; a team keeps playing while it has anybody. */
export function memberLeft(gx: Gx, playerId: string): void {
  const { data } = gx;
  const side = sideOf(data, playerId);
  if (!side) return;
  // The rotation goes on from the leaver's predecessor when the leaver fired last, so the member after them is still up.
  if (side.lastShooterId === playerId) {
    const at = side.memberIds.indexOf(playerId);
    side.lastShooterId = at > 0 ? side.memberIds[at - 1] : null;
  }
  side.memberIds = side.memberIds.filter((id) => id !== playerId);
  if (side.memberIds.length === 0 && data.mode === 'teams') {
    gx.effects.push({ type: 'abort', reason: `Team ${side.id} has nobody left — back to the lobby.` });
    return;
  }
  if (side.memberIds.length === 0 && side.alive) {
    side.alive = false;
    side.ready = true;
    // The platform has just posted "<name> left"; the seat is gone from ctx.players by now.
    if (data.phase.kind !== 'placing') systemMessage(gx, 'Their fleet drifts away.');
  }
}

function finishGame(gx: Gx, winner: SideData | null): void {
  const { ctx, data } = gx;
  if (data.phase.kind === 'held') gx.effects.push(resumeEffect());
  data.phase = { kind: 'gameOver', winnerSideId: winner?.id ?? null };
  if (winner) {
    for (const id of winner.memberIds) award(gx, id, BATTLESHIPS_POINTS.win);
    systemMessage(gx, `${sideName(ctx, data, winner)} wins — the last fleet afloat!`);
  }
  gx.effects.push({ type: 'gameOver' });
}
