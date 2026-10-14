/** Turn order: the next shooter and the die, holds, skipped shooters, leavers and the win. */
import { BATTLESHIPS_POINTS, type TurnAction } from '../../../shared/games/battleships/protocol.js';
import { RESUME_SETTLE_MS, holdEffects, resumeEffect } from '../waiting.js';
import {
  aliveSides,
  award,
  connectedAliveSides,
  connectedMembers,
  fail,
  nameOf,
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
 * or the end of the game once a single fleet is left afloat. Under move or fire the turn opens
 * with the side's die roll, which everyone sees (rolled once per turn, see SideData.pendingRoll).
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
  // One roll per turn: a turn that restarts before anything was done keeps the side's roll.
  const roll = data.moveOrFire ? (side.pendingRoll ?? rollDie(ctx)) : null;
  side.pendingRoll = roll;
  data.phase = { kind: 'turn', sideId: side.id, shooterId: next.shooterId, endsAt: ctx.now + ctx.settings.turnSeconds * 1000, roll, plan: null };
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

/** The side whose turn `playerId` holds, or null (with the reason sent to them). */
export function shooterSide(gx: Gx, playerId: string): SideData | null {
  const { data } = gx;
  if (data.phase.kind !== 'turn' || data.phase.shooterId !== playerId) {
    fail(gx, playerId, 'It is not your turn.');
    return null;
  }
  return sideById(data, data.phase.sideId) ?? null;
}

/** Books a turn taken (a shot or a move) on `side`: the rotation goes on from here. */
export function recordTurn(gx: Gx, side: SideData, playerId: string, action: TurnAction): void {
  const { data } = gx;
  side.lastShooterId = playerId;
  side.movedLastTurn = action.kind === 'move';
  side.pendingRoll = null;
  data.lastSide = data.sides.indexOf(side);
  data.turnsTaken += 1;
  data.lastAction = action;
}

/** The current shooter's socket dropped: their turn is skipped (the side goes on with another member in teams). */
export function shooterAway(gx: Gx, playerId: string): void {
  const { ctx, data } = gx;
  if (data.phase.kind !== 'turn' || data.phase.shooterId !== playerId) return;
  systemMessage(gx, `${nameOf(ctx, playerId)} is away. Skipping their turn.`);
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
    gx.effects.push({ type: 'abort', reason: `Team ${side.id} has nobody left. Back to the lobby.` });
    return;
  }
  if (side.memberIds.length === 0 && side.alive) {
    side.alive = false;
    side.ready = true;
    // The platform has just posted "<name> left"; the seat is gone from ctx.players by now.
    if (data.phase.kind !== 'placing') systemMessage(gx, 'Their fleet drifts away.');
  }
}

export function finishGame(gx: Gx, winner: SideData | null): void {
  const { ctx, data } = gx;
  if (data.phase.kind === 'held') gx.effects.push(resumeEffect());
  data.phase = { kind: 'gameOver', winnerSideId: winner?.id ?? null };
  if (winner) {
    for (const id of winner.memberIds) award(gx, id, BATTLESHIPS_POINTS.win);
    systemMessage(gx, `${sideName(ctx, data, winner)} wins with the last fleet afloat!`);
  }
  gx.effects.push({ type: 'gameOver' });
}
