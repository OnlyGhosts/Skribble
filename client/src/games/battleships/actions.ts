import { segmentAt, type Ship, type Shots } from '@shared/games/battleships/fleet';
import type { MoveDirection, MovePlan } from '@shared/games/battleships/protocol';
import { socket } from '../../platform/net/socket';
import { confirmProblem, pickProblem, stepGhost, turnGhost, type Step } from './lib/moveDraft';
import { layoutKey, layoutSoFar } from './lib/placement';
import { useBattleshipsStore } from './store';

/** Sends the draft as the fleet's layout so far (teammates watch every drop) whenever it differs from what the server holds. */
export function commitDraft(lengths: readonly number[]): void {
  const store = useBattleshipsStore.getState();
  const ships = layoutSoFar(store.draft, lengths);
  if (ships.length === 0) return;
  const key = layoutKey(ships);
  if (key === store.adopted) return;
  if (socket.send({ t: 'place', ships })) useBattleshipsStore.setState({ adopted: key });
}

export function tapOwnCell(x: number, y: number, size: number, lengths: readonly number[]): void {
  useBattleshipsStore.getState().tapCell(x, y, size, lengths);
  commitDraft(lengths);
}

export function rotateShip(size: number, lengths: readonly number[]): void {
  useBattleshipsStore.getState().rotate(size);
  commitDraft(lengths);
}

export function autoPlace(): void {
  socket.send({ t: 'autoPlace' });
}

export function placeReady(lengths: readonly number[]): void {
  commitDraft(lengths);
  socket.send({ t: 'placeReady' });
}

export function fire(): void {
  const { aim } = useBattleshipsStore.getState();
  if (!aim) return;
  if (socket.send({ t: 'fire', targetId: aim.sideId, x: aim.x, y: aim.y })) useBattleshipsStore.getState().setAim(null);
}

/** A tap on a target cell: the first aims, the second (on the same cell) fires. */
export function tapTargetCell(sideId: string, x: number, y: number): void {
  const store = useBattleshipsStore.getState();
  const { aim } = store;
  if (aim && aim.sideId === sideId && aim.x === x && aim.y === y) return fire();
  store.setAim({ sideId, x, y });
}

/** What the move controls need to know about the shooter's board and turn. */
export interface MoveContext {
  ships: readonly Ship[];
  size: number;
  shots: Shots;
  roll: number;
  /** Teammates share the board: they watch the plan take shape. */
  share: boolean;
}

function sharePlan(ctx: MoveContext, plan: MovePlan | null): void {
  if (ctx.share) socket.send({ t: 'plan', plan });
}

export function chooseFire(targetId: string | null): void {
  const store = useBattleshipsStore.getState();
  store.setMode('fire');
  if (targetId !== null) store.selectTab(targetId);
}

export function chooseMove(): void {
  const store = useBattleshipsStore.getState();
  store.setMode('move');
  store.selectTab(null);
}

/** Back to Fire or Move: the aim or the ghost is dropped, and teammates stop watching a plan. */
export function backToChoice(ctx: Pick<MoveContext, 'share'>): void {
  const { turn } = useBattleshipsStore.getState();
  if (turn.mode === 'move' && turn.shipId !== null && ctx.share) socket.send({ t: 'plan', plan: null });
  useBattleshipsStore.getState().setMode('choose');
}

/** A tap on the own board while moving: picks the ship lying there (or says why it cannot move). */
export function pickShipToMove(x: number, y: number, ctx: MoveContext): void {
  const store = useBattleshipsStore.getState();
  const ship = ctx.ships.find((s) => segmentAt(s, x, y) >= 0);
  if (!ship) return store.setNote('Tap one of your ships.');
  const problem = pickProblem(ctx.ships, ship.id, ctx.size, ctx.shots, ctx.roll);
  if (problem) return store.setNote(problem);
  if (store.turn.shipId === ship.id) return;
  store.pickMoveShip(ship.id);
  sharePlan(ctx, { shipId: ship.id, move: null });
}

function applyStep(step: Step, shipId: string, ctx: MoveContext): void {
  const store = useBattleshipsStore.getState();
  if (!step.ok) return store.setNote(step.reason);
  store.setGhost(step.move);
  sharePlan(ctx, { shipId, move: step.move });
}

function pickedShip(ctx: MoveContext): Ship | null {
  const { shipId } = useBattleshipsStore.getState().turn;
  return ctx.ships.find((s) => s.id === shipId) ?? null;
}

export function stepShip(direction: MoveDirection, ctx: MoveContext): void {
  const ship = pickedShip(ctx);
  if (!ship) return useBattleshipsStore.getState().setNote('Tap one of your ships first.');
  applyStep(stepGhost(ship, useBattleshipsStore.getState().turn.move, direction, ctx.roll, ctx.size), ship.id, ctx);
}

export function turnShip(ctx: MoveContext): void {
  const ship = pickedShip(ctx);
  if (!ship) return useBattleshipsStore.getState().setNote('Tap one of your ships first.');
  applyStep(turnGhost(ship, useBattleshipsStore.getState().turn.move, ctx.size), ship.id, ctx);
}

export function resetMove(ctx: MoveContext): void {
  const ship = pickedShip(ctx);
  if (ship) applyStep({ ok: true, move: null }, ship.id, ctx);
}

export function confirmMove(ctx: MoveContext): void {
  const { shipId, move } = useBattleshipsStore.getState().turn;
  if (shipId === null || move === null) return;
  const problem = confirmProblem(ctx.ships, shipId, move, ctx.size, ctx.shots, ctx.roll);
  if (problem) return useBattleshipsStore.getState().setNote(problem);
  socket.send({ t: 'move', shipId, move });
}
