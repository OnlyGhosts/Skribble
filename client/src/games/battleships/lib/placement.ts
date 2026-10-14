/**
 * The placement draft: the ships a captain has laid out so far, kept locally until every ship
 * of the fleet has a spot. Pure helpers over the shared geometry, so the store and the tests
 * share one rule book with the server.
 */
import { cellKey, cellLabel, fits, inBounds, shipCells, shipId, type Ship } from '@shared/games/battleships/fleet';
import type { ShipPlacement, ShipView } from '@shared/games/battleships/protocol';

export interface DraftShip {
  id: string;
  length: number;
  x: number;
  y: number;
  horizontal: boolean;
}

export type Draft = Record<string, DraftShip>;

function asShip(ship: DraftShip): Ship {
  return { ...ship, damage: new Array<boolean>(ship.length).fill(false) };
}

/** The draft the server's layout describes (an auto-place, a rejoin, the captain's own echo). */
export function draftFrom(ships: readonly ShipView[]): Draft {
  const draft: Draft = {};
  for (const s of ships) draft[s.id] = { id: s.id, length: s.length, x: s.x, y: s.y, horizontal: s.horizontal };
  return draft;
}

/** A stable fingerprint of a layout, for telling a server echo from a change. */
export function layoutKey(ships: readonly Pick<DraftShip, 'id' | 'x' | 'y' | 'horizontal'>[]): string {
  return [...ships]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => `${s.id}:${s.x},${s.y},${s.horizontal ? 'h' : 'v'}`)
    .join(' ');
}

export type PlaceResult = { ok: true; draft: Draft } | { ok: false; cells: string[] };

/** Cells of a ship that exist on the board, for painting a rejected spot red. */
function visibleCells(ship: DraftShip, size: number): string[] {
  return shipCells(ship)
    .filter((c) => c.x >= 0 && c.y >= 0 && c.x < size && c.y < size)
    .map((c) => cellKey(c.x, c.y));
}

/** Puts `ship` down where it says (replacing its own earlier spot), or names the cells that would not do. */
export function placeShip(draft: Draft, ship: DraftShip, size: number): PlaceResult {
  const others = Object.values(draft)
    .filter((s) => s.id !== ship.id)
    .map(asShip);
  if (!inBounds(ship, size) || !fits(asShip(ship), others, size)) return { ok: false, cells: visibleCells(ship, size) };
  return { ok: true, draft: { ...draft, [ship.id]: ship } };
}

export function shipAt(draft: Draft, x: number, y: number): DraftShip | undefined {
  return Object.values(draft).find((s) => shipCells(s).some((c) => c.x === x && c.y === y));
}

/** The ships with a spot so far, in ship-id order: what the server is told after every drop. */
export function layoutSoFar(draft: Draft, lengths: readonly number[]): ShipPlacement[] {
  const ships: ShipPlacement[] = [];
  for (let i = 0; i < lengths.length; i++) {
    const s = draft[shipId(i)];
    if (s) ships.push({ id: s.id, x: s.x, y: s.y, horizontal: s.horizontal });
  }
  return ships;
}

/** The whole fleet, in ship-id order, once every ship has a spot; null while some are still in the tray. */
export function layoutOf(draft: Draft, lengths: readonly number[]): ShipPlacement[] | null {
  const ships = layoutSoFar(draft, lengths);
  return ships.length === lengths.length ? ships : null;
}

/** 'B2–D2' style: the cells a ship covers, for naming it where "3 across" would not do. */
export function shipSpan(ship: Pick<DraftShip, 'x' | 'y' | 'length' | 'horizontal'>): string {
  const cells = shipCells(ship);
  const last = cells[cells.length - 1];
  return `${cellLabel(ship.x, ship.y)}–${cellLabel(last.x, last.y)}`;
}

/** The fleet's ships still in the tray, in ship-id order. */
export function unplaced(draft: Draft, lengths: readonly number[]): Array<{ id: string; length: number }> {
  return lengths.map((length, i) => ({ id: shipId(i), length })).filter((s) => !draft[s.id]);
}

