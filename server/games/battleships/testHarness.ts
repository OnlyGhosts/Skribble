/** Battleships' test harness, shared by its test files: reading the state and views, steering the rng, placing fleets. */
import { expect } from 'vitest';
import { shipCells, type Cell, type Ship } from '../../../shared/games/battleships/fleet.js';
import type { BattleshipsView, ShipPlacement } from '../../../shared/games/battleships/protocol.js';
import type { Effect } from '../../platform/engine/effects.js';
import { START, sim, type Sim } from '../../platform/engine/testHarness.js';
import { viewFor } from '../../platform/engine/view.js';
import type { BattleshipsData } from './module.js';

export const PLACE_MS = 30_000; // the fixture's placeSeconds
export const TURN_MS = 10_000; // the fixture's turnSeconds
/** The fixture's board: solo, so the classic 10x10. */
export const SIZE = 10;

/** A fleet laid out one ship per row from A1 down, in ship-id order. */
export function rowsLayout(lengths: readonly number[]): ShipPlacement[] {
  return lengths.map((_, i) => ({ id: `s${i}`, x: 0, y: i, horizontal: true }));
}

/** Every cell of a rows layout, ship by ship. */
export function rowsCells(lengths: readonly number[]): Cell[] {
  return rowsLayout(lengths).flatMap((p, i) => shipCells({ ...p, length: lengths[i] }));
}

/** The small fleet in rows: s0 A1-D1, s1 A2-C2, s2 A3-C3, s3 A4-B4. */
export const ROWS: ShipPlacement[] = rowsLayout([4, 3, 3, 2]);
/** Every cell of ROWS, ship by ship. */
export const ROW_CELLS = rowsCells([4, 3, 3, 2]);

export const view = (s: Sim, viewer: string | null = null): BattleshipsView => {
  const game = viewFor(s.data, viewer, s.now).game;
  if (!game) throw new Error('no game');
  return game as BattleshipsView;
};
export const data = (s: Sim): BattleshipsData => s.data.game as BattleshipsData;
export const score = (s: Sim, id: string): number => s.data.players.find((p) => p.id === id)?.score ?? -1;
export const token = (s: Sim, id: string): string => s.data.players.find((p) => p.id === id)?.token ?? '';
export const waiting = (s: Sim): string[] | null => viewFor(s.data, null, s.now).waiting?.missing ?? null;
/** Drops the player's socket: the original one, or the one a rejoin opened (`suffix` '-2'). */
export const disconnect = (s: Sim, id: string, name: string, suffix = ''): Effect[] => s.apply({ type: 'connectionClosed', playerId: id, connectionId: `conn-${name}${suffix}` });
export const reconnect = (s: Sim, id: string, name: string): Effect[] => s.apply({ type: 'rejoin', token: token(s, id), connectionId: `conn-${name}-2` });
export const fire = (s: Sim, shooter: string, targetId: string, x: number, y: number): Effect[] => s.game(shooter, { t: 'fire', targetId, x, y });
export const shipsOf = (s: Sim, sideId: string): Ship[] => data(s).sides.find((x) => x.id === sideId)?.ships ?? [];

/** A sim whose rng can be steered mid-game (die rolls, auto shots, random layouts). */
export function steerable(): { s: Sim; set(r: number): void } {
  let r = 0;
  return { s: sim('battleships', 'ABCD', START, () => r), set: (next) => void (r = next) };
}

/** The rng value that rolls `face` on the die. */
export const rollOf = (face: number): number => (face - 0.5) / 6;

/** Every side's captain lays out `layout` (the game's fleet in rows by default) and locks it in, so the shooting starts at once. */
export function placeAll(s: Sim, captains: string[], layout: ShipPlacement[] = rowsLayout(data(s).fleet)): void {
  for (const id of captains) {
    s.game(id, { t: 'place', ships: layout });
    s.game(id, { t: 'placeReady' });
  }
  expect(view(s).phase).toBe('playing');
}

/** Cells of the game's board below a rows layout, bottom row first: safe misses. */
export function* openCells(s: Sim): Generator<[number, number]> {
  const { size, fleet } = data(s);
  for (let y = size - 1; y >= fleet.length; y--) for (let x = 0; x < size; x++) yield [x, y];
}
