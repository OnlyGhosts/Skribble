/**
 * Rooms stored by an older build keep running after a deploy: their Battleships state is brought
 * up to the current shape before the module reads it. The old shape had the fleet as a name
 * ('classic' / 'small'), ships with a hit count instead of per-segment damage, a 'moving' window
 * after a lucky roll, `dice` and `shotsTaken`, and no move-or-fire fields. An upgraded game plays on
 * as classic shots (the old roll-after-a-shot rule is gone). Pure: current data comes back as is.
 */
import { BATTLESHIPS_FLEETS, type BattleshipsFleet, type MovePlan, type TurnAction } from '../../../shared/games/battleships/protocol.js';
import { cellKey, fleetFor, shipCells, type Ship } from '../../../shared/games/battleships/fleet.js';
import type { BattleshipsData, PhaseData, SideData } from './state.js';

interface LegacyShip extends Omit<Ship, 'damage'> {
  damage?: boolean[];
  /** The old damage count. */
  hits?: number;
}

interface LegacySide extends Omit<SideData, 'ships' | 'movedLastTurn' | 'pendingRoll'> {
  ships: LegacyShip[];
  movedLastTurn?: boolean;
  pendingRoll?: number | null;
}

type LegacyPhase =
  | Exclude<PhaseData, { kind: 'turn' }>
  | { kind: 'turn'; sideId: string; shooterId: string; endsAt: number; roll?: number | null; plan?: MovePlan | null }
  /** The old move window after a lucky roll: the side had already fired. */
  | { kind: 'moving'; sideId: string; shooterId: string; endsAt: number };

interface LegacyData extends Omit<BattleshipsData, 'fleet' | 'sides' | 'phase' | 'moveOrFire' | 'lastAction' | 'turnsTaken'> {
  fleet: number[] | string;
  sides: LegacySide[];
  phase: LegacyPhase;
  moveOrFire?: boolean;
  lastAction?: TurnAction | null;
  turnsTaken?: number;
  shotsTaken?: number;
  dice?: number | null;
}

function isCurrent(data: LegacyData): boolean {
  const { phase } = data;
  return (
    Array.isArray(data.fleet) &&
    typeof data.moveOrFire === 'boolean' &&
    typeof data.turnsTaken === 'number' &&
    data.lastAction !== undefined &&
    phase.kind !== 'moving' &&
    (phase.kind !== 'turn' || (phase.roll !== undefined && phase.plan !== undefined)) &&
    data.sides.every((s) => typeof s.movedLastTurn === 'boolean' && s.pendingRoll !== undefined && s.ships.every((ship) => Array.isArray(ship.damage)))
  );
}

/** The old fleet name as ship lengths; an unknown name falls back to the ships on the boards. */
function fleetLengths(data: LegacyData): number[] {
  if (Array.isArray(data.fleet)) return [...data.fleet];
  if (data.fleet in BATTLESHIPS_FLEETS) return fleetFor(data.fleet as BattleshipsFleet, 1);
  const ships = data.sides.find((s) => s.ships.length > 0)?.ships ?? [];
  return [...ships].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })).map((s) => s.length);
}

/** Per-segment damage from the shots on the ship's squares, topped up to the old hit count. */
function upgradeShip(ship: LegacyShip, shots: SideData['shots']): Ship {
  const { hits, damage: stored, ...shape } = ship;
  if (Array.isArray(stored)) return { ...shape, damage: [...stored] };
  const damage = shipCells(shape).map(({ x, y }) => {
    const mark = shots[cellKey(x, y)];
    return mark === 'hit' || mark === 'sunk';
  });
  let missing = (hits ?? 0) - damage.filter(Boolean).length;
  for (let i = 0; i < damage.length && missing > 0; i++) {
    if (damage[i]) continue;
    damage[i] = true;
    missing -= 1;
  }
  return { ...shape, damage };
}

function upgradeSide(side: LegacySide): SideData {
  return { ...side, ships: side.ships.map((ship) => upgradeShip(ship, side.shots)), movedLastTurn: side.movedLastTurn ?? false, pendingRoll: side.pendingRoll ?? null };
}

/**
 * The old move window came after the side's shot, so its turn is over: a short hold that ends at
 * the window's deadline starts the next side's turn (the rotation goes on from `lastSide`).
 */
function upgradePhase(phase: LegacyPhase): PhaseData {
  if (phase.kind === 'moving') return { kind: 'held', resumeAt: phase.endsAt };
  if (phase.kind === 'turn') return { ...phase, roll: phase.roll ?? null, plan: phase.plan ?? null };
  return phase;
}

export function upgradeData(stored: BattleshipsData): BattleshipsData {
  const data = stored as unknown as LegacyData;
  if (isCurrent(data)) return stored;
  const { dice: _dice, shotsTaken, ...rest } = data;
  const moveOrFire = data.moveOrFire ?? false;
  const sides = data.sides.map(upgradeSide);
  // An old game in progress plays on without dice: no roll is waiting on any side.
  if (!moveOrFire) for (const side of sides) side.pendingRoll = null;
  const phase = upgradePhase(data.phase);
  return {
    ...rest,
    fleet: fleetLengths(data),
    sides,
    phase: phase.kind === 'turn' && !moveOrFire ? { ...phase, roll: null, plan: null } : phase,
    moveOrFire,
    lastAction: data.lastAction ?? null,
    turnsTaken: data.turnsTaken ?? shotsTaken ?? 0,
  };
}
