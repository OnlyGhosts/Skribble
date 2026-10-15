/** The placing phase: sides and boards are formed at start, captains lay out their fleets, the deadline fills in the rest. */
import { boardSizeFor, completeLayout, fleetFor, isComplete, validateLayout } from '../../../shared/games/battleships/fleet.js';
import { BATTLESHIPS_TEAM_IDS, type ShipPlacement } from '../../../shared/games/battleships/protocol.js';
import type { PlatformPlayer } from '../../platform/game.js';
import { aliveSides, captainOf, fail, sideName, sideOf, snapshot, systemMessage, type BattleshipsData, type Ctx, type Gx, type SideData } from './state.js';
import { beginTurn } from './turns.js';

function newSide(id: string, memberIds: string[]): SideData {
  return { id, memberIds, ships: [], ready: false, shots: {}, alive: true, lastShooterId: null, movedLastTurn: false, pendingRoll: null };
}

/** Solo: a side per participant in join order. Teams: A and B alternately by join order (an odd count gives A one more). */
export function formSides(ctx: Ctx): SideData[] {
  if (ctx.settings.mode === 'solo') return ctx.players.map((p) => newSide(p.id, [p.id]));
  return BATTLESHIPS_TEAM_IDS.map((id, team) => newSide(id, ctx.players.filter((_, i) => i % 2 === team).map((p) => p.id)));
}

/**
 * Every board is the classic 10x10 for one player. A team board grows with its crew (with an extra
 * 3-ship per extra member, up to 14x14 and three extra ships), and both teams play the larger team's board and fleet so neither side
 * hides in more water. Joiners after the start do not change it.
 */
export function initialData(ctx: Ctx): BattleshipsData {
  const sides = formSides(ctx);
  const crew = ctx.settings.mode === 'teams' ? Math.max(1, ...sides.map((s) => s.memberIds.length)) : 1;
  return {
    mode: ctx.settings.mode,
    size: boardSizeFor(crew),
    fleet: fleetFor(ctx.settings.fleet, crew),
    moveOrFire: ctx.settings.moveOrFire,
    sides,
    phase: { kind: 'placing', endsAt: ctx.now + ctx.settings.placeSeconds * 1000 },
    lastSide: -1,
    log: [],
    lastAction: null,
    turnsTaken: 0,
  };
}

export function announceStart(gx: Gx): void {
  const { ctx, data } = gx;
  const who = data.mode === 'teams' ? 'Captains, place your team\'s ships' : 'Place your ships';
  systemMessage(gx, `${who}! You have ${ctx.settings.placeSeconds} seconds.`);
  if (data.mode === 'teams') {
    for (const side of data.sides) systemMessage(gx, `Team ${side.id}: ${side.memberIds.map((id) => ctx.players.find((p) => p.id === id)?.name ?? 'Someone').join(', ')}.`);
  }
  snapshot(gx);
}

/**
 * A mid-game joiner: a fleet of their own while fleets are still being placed (solo), or a seat
 * on the smaller team at any time (teams, where the board is shared). Later solo joiners watch.
 */
export function seatJoiner(gx: Gx, player: PlatformPlayer): void {
  const { data } = gx;
  if (sideOf(data, player.id)) return;
  if (data.mode === 'teams') {
    const smaller = [...data.sides].sort((a, b) => a.memberIds.length - b.memberIds.length)[0];
    smaller.memberIds.push(player.id);
    systemMessage(gx, `${player.name} joins Team ${smaller.id}.`);
    return;
  }
  if (data.phase.kind === 'placing') data.sides.push(newSide(player.id, [player.id]));
}

/** The side `playerId` may lay out right now, or the reason they may not. */
function placingSide(gx: Gx, playerId: string): SideData | null {
  const { data } = gx;
  if (data.phase.kind !== 'placing') {
    fail(gx, playerId, 'The fleets are already placed.');
    return null;
  }
  const side = sideOf(data, playerId);
  if (!side) {
    fail(gx, playerId, 'You have no fleet to place.');
    return null;
  }
  if (captainOf(side) !== playerId) {
    fail(gx, playerId, 'Only your team\'s captain places the ships.');
    return null;
  }
  if (side.ready) {
    fail(gx, playerId, 'Your fleet is already locked in.');
    return null;
  }
  return side;
}

/** The layout so far, partial or whole: teammates see every drop as it lands. */
export function place(gx: Gx, playerId: string, placements: ShipPlacement[]): void {
  const side = placingSide(gx, playerId);
  if (!side) return;
  const check = validateLayout(placements, gx.data.fleet, gx.data.size);
  if (!check.ok) return fail(gx, playerId, check.reason);
  side.ships = check.ships;
  snapshot(gx);
}

export function autoPlace(gx: Gx, playerId: string): void {
  const side = placingSide(gx, playerId);
  if (!side) return;
  side.ships = completeLayout([], gx.data.fleet, gx.data.size, gx.ctx.rng);
  snapshot(gx);
}

export function placeReady(gx: Gx, playerId: string): void {
  const side = placingSide(gx, playerId);
  if (!side) return;
  if (!isComplete(side.ships, gx.data.fleet)) return fail(gx, playerId, 'Place your ships first.');
  side.ready = true;
  systemMessage(gx, `${sideName(gx.ctx, gx.data, side)}'s fleet is in position.`);
  if (aliveSides(gx.data).every((s) => s.ready)) return finishPlacing(gx);
  snapshot(gx);
}

/** Every fleet is in position or the clock ran out: the ships still unplaced take random spots and the shooting starts. */
export function finishPlacing(gx: Gx): void {
  const { ctx, data } = gx;
  if (data.phase.kind !== 'placing') return;
  const late = aliveSides(data).filter((s) => !s.ready);
  for (const side of late) {
    side.ships = completeLayout(side.ships, data.fleet, data.size, ctx.rng);
    side.ready = true;
  }
  if (late.length > 0) systemMessage(gx, 'Time\'s up. The remaining fleets took their positions.');
  systemMessage(gx, 'All fleets are in position. Fire at will!');
  beginTurn(gx);
}
