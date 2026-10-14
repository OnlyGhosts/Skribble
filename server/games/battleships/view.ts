/** Per-recipient projection of BattleshipsData: a side's ships and plans reach its own members only; everyone else sees shots. */
import { hitCount, isComplete, isSunk } from '../../../shared/games/battleships/fleet.js';
import type { BattleshipsSettings, BattleshipsView, OwnBoardView, SideView, TargetGridView, TurnView } from '../../../shared/games/battleships/protocol.js';
import type { GameViewCtx } from '../../platform/game.js';
import { captainOf, shipsLeft, sideById, sideOf, type BattleshipsData, type SideData } from './state.js';

function sideView(side: SideData): SideView {
  return {
    id: side.id,
    memberIds: [...side.memberIds],
    captainId: captainOf(side),
    alive: side.alive,
    ready: side.ready,
    shipsLeft: shipsLeft(side),
    movedLastTurn: side.movedLastTurn,
  };
}

function ownBoard(data: BattleshipsData, side: SideData): OwnBoardView {
  const { phase } = data;
  const plan = phase.kind === 'turn' && phase.sideId === side.id && phase.plan ? structuredClone(phase.plan) : null;
  return {
    sideId: side.id,
    ships: side.ships.map((s) => ({ id: s.id, x: s.x, y: s.y, length: s.length, horizontal: s.horizontal, damage: [...s.damage], hits: hitCount(s), sunk: isSunk(s) })),
    shots: { ...side.shots },
    placed: isComplete(side.ships, data.fleet),
    ready: side.ready,
    plan,
  };
}

function targetGrid(data: BattleshipsData, side: SideData): TargetGridView {
  return {
    sideId: side.id,
    shots: { ...side.shots },
    shipsLeft: shipsLeft(side),
    shipsTotal: data.fleet.length,
    sunkLengths: side.ships.filter(isSunk).map((s) => s.length),
  };
}

function turnView(data: BattleshipsData): TurnView | null {
  const { phase } = data;
  if (phase.kind !== 'turn') return null;
  const side = sideById(data, phase.sideId);
  return { sideId: phase.sideId, shooterId: phase.shooterId, roll: phase.roll, canMove: data.moveOrFire && side !== undefined && !side.movedLastTurn };
}

export function viewFor(data: BattleshipsData, viewerId: string | null, _ctx: GameViewCtx<BattleshipsSettings>): BattleshipsView {
  const { phase } = data;
  const mine = viewerId === null ? undefined : sideOf(data, viewerId);
  return {
    phase: phase.kind === 'turn' || phase.kind === 'held' ? 'playing' : phase.kind,
    mode: data.mode,
    moveOrFire: data.moveOrFire,
    boardSize: data.size,
    fleet: [...data.fleet],
    sides: data.sides.map(sideView),
    mySideId: mine?.id ?? null,
    myBoard: mine ? ownBoard(data, mine) : null,
    targets: data.sides.filter((s) => s !== mine).map((s) => targetGrid(data, s)),
    turn: turnView(data),
    endsAt: phase.kind === 'placing' || phase.kind === 'turn' ? phase.endsAt : null,
    paused: phase.kind === 'held',
    lastShot: data.log.length > 0 ? { ...data.log[data.log.length - 1] } : null,
    lastAction: data.lastAction ? structuredClone(data.lastAction) : null,
    log: data.log.map((e) => ({ ...e })),
    winnerSideId: phase.kind === 'gameOver' ? phase.winnerSideId : null,
    turnNumber: data.turnsTaken + 1,
  };
}
