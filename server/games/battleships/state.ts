/** Battleships' JSON-safe game state (the module's `D`), its working context and the small queries over it. */
import { shipsAfloat, type Ship } from '../../../shared/games/battleships/fleet.js';
import { BATTLESHIPS_DIE_FACES, type BattleshipsMode, type BattleshipsServerMessage, type BattleshipsSettings, type CellMark, type MovePlan, type ShotEvent, type TurnAction } from '../../../shared/games/battleships/protocol.js';
import type { GameCtx, GameEffect, PlatformPlayer } from '../../platform/game.js';

/** A fleet and the players behind it: one player in solo, a team in teams. */
export interface SideData {
  /** The player's id in solo, 'A' or 'B' in teams. */
  id: string;
  /** Members in join order; a departed member is removed. */
  memberIds: string[];
  /** Empty until a layout was given. */
  ships: Ship[];
  /** The layout is locked in (placing). */
  ready: boolean;
  /** Every shot received, keyed by cell. */
  shots: Record<string, CellMark>;
  alive: boolean;
  /** The member who took the side's last turn (null before the first); the team rotates from here. */
  lastShooterId: string | null;
  /** The side's last turn was a move: its next one must be a shot. */
  movedLastTurn: boolean;
  /**
   * The die rolled for the side's turn that has not been taken yet: a turn that restarts (the
   * shooter dropped, the game held) keeps it, so a reload never re-rolls. Cleared by a shot or a move.
   */
  pendingRoll: number | null;
}

export type PhaseData =
  | { kind: 'placing'; endsAt: number }
  /** `roll` is the die rolled as the turn began (null with move or fire off); `plan` the shooter's move in the making. */
  | { kind: 'turn'; sideId: string; shooterId: string; endsAt: number; roll: number | null; plan: MovePlan | null }
  /** Holding at a turn boundary for disconnected players; `resumeAt` is the settle once enough are back. */
  | { kind: 'held'; resumeAt: number | null }
  | { kind: 'gameOver'; winnerSideId: string | null };

export interface BattleshipsData {
  mode: BattleshipsMode;
  /** Every board's side, fixed at the start from the biggest crew. */
  size: number;
  /** Every fleet's ship lengths in ship-id order, fixed at the start with the board. */
  fleet: number[];
  moveOrFire: boolean;
  sides: SideData[];
  phase: PhaseData;
  /** Index into `sides` of the side that took the last turn; the rotation continues after it. */
  lastSide: number;
  /** The last few shots, newest last. */
  log: ShotEvent[];
  lastAction: TurnAction | null;
  /** Turns taken so far, shots and moves. */
  turnsTaken: number;
}

export type Ctx = GameCtx<BattleshipsSettings>;
/** What the queries below need of a context: the seated participants (the view context has them too). */
export type Seats = Pick<Ctx, 'players'>;
export type Effect = GameEffect<BattleshipsServerMessage>;

/** The module's working context: a private copy of the state plus the effects produced so far. */
export interface Gx {
  ctx: Ctx;
  data: BattleshipsData;
  effects: Effect[];
}

export function findPlayer(ctx: Seats, id: string): PlatformPlayer | undefined {
  return ctx.players.find((p) => p.id === id);
}

export function nameOf(ctx: Seats, id: string): string {
  return findPlayer(ctx, id)?.name ?? 'Someone';
}

export function sideOf(data: BattleshipsData, playerId: string): SideData | undefined {
  return data.sides.find((s) => s.memberIds.includes(playerId));
}

export function sideById(data: BattleshipsData, sideId: string): SideData | undefined {
  return data.sides.find((s) => s.id === sideId);
}

/** How a side is named in chat: the player in solo, "Team A" in teams. */
export function sideName(ctx: Seats, data: BattleshipsData, side: SideData): string {
  if (data.mode === 'teams') return `Team ${side.id}`;
  return side.memberIds[0] !== undefined ? nameOf(ctx, side.memberIds[0]) : 'A departed fleet';
}

/** The member who places the fleet: the one with the lowest join order (memberIds is in join order). */
export function captainOf(side: SideData): string {
  return side.memberIds[0] ?? '';
}

export function connectedMembers(ctx: Seats, side: SideData): PlatformPlayer[] {
  return side.memberIds.flatMap((id) => {
    const p = findPlayer(ctx, id);
    return p && p.connected ? [p] : [];
  });
}

export function aliveSides(data: BattleshipsData): SideData[] {
  return data.sides.filter((s) => s.alive);
}

/** Sides still in the game with at least one member connected: a turn needs two of them. */
export function connectedAliveSides(ctx: Seats, data: BattleshipsData): SideData[] {
  return aliveSides(data).filter((s) => connectedMembers(ctx, s).length > 0);
}

/** Seated members of the sides still in the game, in join order: the players a hold waits for. */
export function playersInPlay(ctx: Seats, data: BattleshipsData): PlatformPlayer[] {
  return ctx.players.filter((p) => sideOf(data, p.id)?.alive);
}

export function shipsLeft(side: SideData): number {
  return shipsAfloat(side.ships);
}

export function isShooter(data: BattleshipsData, playerId: string): boolean {
  return data.phase.kind === 'turn' && data.phase.shooterId === playerId;
}

export function systemMessage(gx: Gx, text: string): void {
  gx.effects.push({ type: 'chat', to: 'all', kind: 'system', text });
}

export function snapshot(gx: Gx): void {
  gx.effects.push({ type: 'snapshot', to: 'all' });
}

export function fail(gx: Gx, playerId: string, message: string): void {
  gx.effects.push({ type: 'error', playerId, code: 'NOT_ALLOWED', message });
}

export function award(gx: Gx, playerId: string, delta: number): void {
  if (delta > 0) gx.effects.push({ type: 'score', playerId, delta });
}

/** A die roll from the injected rng: 1 to 6. */
export function rollDie(ctx: Ctx): number {
  return 1 + Math.min(BATTLESHIPS_DIE_FACES - 1, Math.floor(ctx.rng() * BATTLESHIPS_DIE_FACES));
}

/** A uniform pick from a non-empty list through the injected rng. */
export function pick<T>(ctx: Ctx, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(ctx.rng() * items.length))];
}
