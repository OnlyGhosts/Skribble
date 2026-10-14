/** Per-recipient projection of BattleshipsData: a side's ships reach its own members only; everyone else sees shots. */
import { fleetLengths, isComplete, isSunk, movableShips } from '../../../shared/games/battleships/fleet.js';
import type { BattleshipsSettings, BattleshipsView, OwnBoardView, SideView, TargetGridView } from '../../../shared/games/battleships/protocol.js';
import type { GameViewCtx } from '../../platform/game.js';
import { captainOf, shipsLeft, sideOf, type BattleshipsData, type SideData } from './state.js';

function sideView(side: SideData): SideView {
  return { id: side.id, memberIds: [...side.memberIds], captainId: captainOf(side), alive: side.alive, ready: side.ready, shipsLeft: shipsLeft(side) };
}

function ownBoard(data: BattleshipsData, side: SideData, viewerId: string): OwnBoardView {
  const moving = data.phase.kind === 'moving' && data.phase.shooterId === viewerId;
  return {
    sideId: side.id,
    ships: side.ships.map((s) => ({ id: s.id, x: s.x, y: s.y, length: s.length, horizontal: s.horizontal, hits: s.hits, sunk: isSunk(s) })),
    shots: { ...side.shots },
    placed: isComplete(side.ships, data.fleet),
    ready: side.ready,
    movable: moving ? movableShips(side.ships, data.size, side.shots) : [],
  };
}

function targetGrid(data: BattleshipsData, side: SideData): TargetGridView {
  return {
    sideId: side.id,
    shots: { ...side.shots },
    shipsLeft: shipsLeft(side),
    shipsTotal: fleetLengths(data.fleet).length,
    sunkLengths: side.ships.filter(isSunk).map((s) => s.length),
  };
}

export function viewFor(data: BattleshipsData, viewerId: string | null, ctx: GameViewCtx<BattleshipsSettings>): BattleshipsView {
  const { phase } = data;
  const mine = viewerId === null ? undefined : sideOf(data, viewerId);
  const turn = phase.kind === 'turn' || phase.kind === 'moving' ? { sideId: phase.sideId, shooterId: phase.shooterId } : null;
  return {
    phase: phase.kind === 'turn' || phase.kind === 'held' ? 'playing' : phase.kind,
    mode: data.mode,
    boardSize: data.size,
    fleet: fleetLengths(data.fleet),
    sides: data.sides.map(sideView),
    mySideId: mine?.id ?? null,
    myBoard: mine && viewerId !== null ? ownBoard(data, mine, viewerId) : null,
    targets: data.sides.filter((s) => s !== mine).map((s) => targetGrid(data, s)),
    turn,
    endsAt: phase.kind === 'placing' || phase.kind === 'turn' || phase.kind === 'moving' ? phase.endsAt : null,
    paused: phase.kind === 'held',
    dice: data.dice,
    lastShot: data.log.length > 0 ? { ...data.log[data.log.length - 1] } : null,
    log: data.log.map((e) => ({ ...e })),
    winnerSideId: phase.kind === 'gameOver' ? phase.winnerSideId : null,
    turnNumber: data.shotsTaken + 1,
  };
}
