/** Battleships' rules through the pure engine: placing, turn order, shots, dice moves, elimination, holds and the edges. */
import { describe, expect, it } from 'vitest';
import { cellKey, shipCells, type Ship } from '../../../shared/games/battleships/fleet.js';
import { BATTLESHIPS_MOVE_SECONDS, BATTLESHIPS_POINTS, type BattleshipsView, type ShipPlacement } from '../../../shared/games/battleships/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defaultPlatformSettings } from '../../../shared/platform/settings.js';
import type { Effect } from '../../platform/engine/effects.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { viewFor } from '../../platform/engine/view.js';
import { AVATAR, START, chatTexts, errorsOf, sim, startGame, type Sim } from '../../platform/engine/testHarness.js';
import { RESUME_SETTLE_MS } from '../waiting.js';
import { battleshipsModule, type BattleshipsData } from './module.js';

const PLACE_MS = 30_000; // the fixture's placeSeconds
const TURN_MS = 10_000; // the fixture's turnSeconds
const MOVE_MS = BATTLESHIPS_MOVE_SECONDS * 1000;

/** The small fleet in rows: s0 A1-D1, s1 A2-C2, s2 A3-C3, s3 A4-B4. */
const ROWS: ShipPlacement[] = [
  { id: 's0', x: 0, y: 0, horizontal: true },
  { id: 's1', x: 0, y: 1, horizontal: true },
  { id: 's2', x: 0, y: 2, horizontal: true },
  { id: 's3', x: 0, y: 3, horizontal: true },
];
const ROW_LENGTHS = [4, 3, 3, 2];
/** Every cell of ROWS, ship by ship. */
const ROW_CELLS = ROWS.flatMap((p, i) => shipCells({ ...p, length: ROW_LENGTHS[i] }));
/** A fleet boxed in so that no ship can slide anywhere. */
const BLOCKED: ShipPlacement[] = [
  { id: 's0', x: 0, y: 0, horizontal: true },
  { id: 's1', x: 4, y: 0, horizontal: false },
  { id: 's2', x: 4, y: 3, horizontal: false },
  { id: 's3', x: 4, y: 6, horizontal: false },
];

const view = (s: Sim, viewer: string | null = null): BattleshipsView => {
  const game = viewFor(s.data, viewer, s.now).game;
  if (!game) throw new Error('no game');
  return game as BattleshipsView;
};
const data = (s: Sim): BattleshipsData => s.data.game as BattleshipsData;
const score = (s: Sim, id: string): number => s.data.players.find((p) => p.id === id)?.score ?? -1;
const token = (s: Sim, id: string): string => s.data.players.find((p) => p.id === id)?.token ?? '';
const waiting = (s: Sim): string[] | null => viewFor(s.data, null, s.now).waiting?.missing ?? null;
/** Drops the player's socket: the original one, or the one a rejoin opened (`suffix` '-2'). */
const disconnect = (s: Sim, id: string, name: string, suffix = ''): Effect[] => s.apply({ type: 'connectionClosed', playerId: id, connectionId: `conn-${name}${suffix}` });
const reconnect = (s: Sim, id: string, name: string): Effect[] => s.apply({ type: 'rejoin', token: token(s, id), connectionId: `conn-${name}-2` });
const fire = (s: Sim, shooter: string, targetId: string, x: number, y: number): Effect[] => s.game(shooter, { t: 'fire', targetId, x, y });
const gameDeadline = (s: Sim): number | null => battleshipsModule.nextDeadline(data(s));
const shipsOf = (s: Sim, sideId: string): Ship[] => data(s).sides.find((x) => x.id === sideId)?.ships ?? [];

/** A sim whose rng can be steered mid-game (die rolls, auto shots, random layouts). */
function steerable(): { s: Sim; set(r: number): void } {
  let r = 0;
  return { s: sim('battleships', 'ABCD', START, () => r), set: (next) => void (r = next) };
}

/** Every side's captain lays out `layout` and locks it in, so the shooting starts at once. */
function placeAll(s: Sim, captains: string[], layout: ShipPlacement[] = ROWS): void {
  for (const id of captains) {
    s.game(id, { t: 'place', ships: layout });
    s.game(id, { t: 'placeReady' });
  }
  expect(view(s).phase).toBe('playing');
}

/** Cells of an 8x8 board no ROWS ship covers, bottom row first: safe misses. */
function* openCells(): Generator<[number, number]> {
  for (let y = 7; y >= 4; y--) for (let x = 0; x < 8; x++) yield [x, y];
}

describe('Battleships: setup and placing', () => {
  it('starts solo with a fleet per player in join order, the placing clock, a line and secret boards', () => {
    const s = sim('battleships');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    expect(s.data.phase).toBe('playing');
    expect(data(s)).toMatchObject({ mode: 'solo', size: 8, fleet: 'small', lastSide: -1, dice: null, log: [], shotsTaken: 0 });
    expect(data(s).sides.map((x) => x.id)).toEqual([alice, bob, carol]);
    expect(data(s).sides[0]).toEqual({ id: alice, memberIds: [alice], ships: [], ready: false, shots: {}, alive: true, lastShooterId: null });
    expect(chatTexts(s.effects)).toContain('Place your ships! You have 30 seconds.');
    expect(nextDeadline(s.data)).toBe(START + PLACE_MS);

    const mine = view(s, alice);
    expect(mine).toMatchObject({ phase: 'placing', mode: 'solo', boardSize: 8, fleet: [4, 3, 3, 2], mySideId: alice, turn: null, endsAt: START + PLACE_MS, paused: false, dice: null, lastShot: null, log: [], winnerSideId: null, turnNumber: 1 });
    expect(mine.sides).toEqual([
      { id: alice, memberIds: [alice], captainId: alice, alive: true, ready: false, shipsLeft: 0 },
      { id: bob, memberIds: [bob], captainId: bob, alive: true, ready: false, shipsLeft: 0 },
      { id: carol, memberIds: [carol], captainId: carol, alive: true, ready: false, shipsLeft: 0 },
    ]);
    expect(mine.myBoard).toEqual({ sideId: alice, ships: [], shots: {}, placed: false, ready: false, movable: [] });
    expect(mine.targets.map((t) => t.sideId)).toEqual([bob, carol]);
    // A spectator has no side and sees every grid.
    expect(view(s)).toMatchObject({ mySideId: null, myBoard: null });
    expect(view(s).targets.map((t) => t.sideId)).toEqual([alice, bob, carol]);
  });

  it('accepts a whole valid layout and refuses overlaps, ships off the board and anyone but the captain', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    const effects = s.game(alice, { t: 'place', ships: ROWS });
    expect(errorsOf(effects)).toEqual([]);
    expect(view(s, alice).myBoard).toMatchObject({ placed: true, ready: false });
    expect(view(s, alice).myBoard?.ships).toEqual([
      { id: 's0', x: 0, y: 0, length: 4, horizontal: true, hits: 0, sunk: false },
      { id: 's1', x: 0, y: 1, length: 3, horizontal: true, hits: 0, sunk: false },
      { id: 's2', x: 0, y: 2, length: 3, horizontal: true, hits: 0, sunk: false },
      { id: 's3', x: 0, y: 3, length: 2, horizontal: true, hits: 0, sunk: false },
    ]);
    // Bob learns nothing of it: his target grid for Alice is bare.
    expect(view(s, bob).targets).toEqual([{ sideId: alice, shots: {}, shipsLeft: 4, shipsTotal: 4, sunkLengths: [] }]);
    expect(view(s, bob).myBoard?.ships).toEqual([]);

    const overlap = [...ROWS.slice(0, 3), { id: 's3', x: 2, y: 0, horizontal: false }];
    expect(errorsOf(s.game(alice, { t: 'place', ships: overlap }))).toEqual(['Ship s3 overlaps another ship.']);
    const off = [...ROWS.slice(0, 3), { id: 's3', x: 7, y: 7, horizontal: true }];
    expect(errorsOf(s.game(alice, { t: 'place', ships: off }))).toEqual(['Ship s3 is off the board.']);
    expect(errorsOf(s.game(alice, { t: 'place', ships: [...ROWS, { id: 's0', x: 0, y: 5, horizontal: true }] }))).toEqual(['Ship s0 must be placed exactly once.']);
    // A refused layout leaves the accepted one in place.
    expect(view(s, alice).myBoard?.ships[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('takes the layout in progress ship by ship, is not placed until the fleet is whole, and fills the rest in at the deadline', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    expect(errorsOf(s.game(alice, { t: 'place', ships: [ROWS[2]] }))).toEqual([]);
    expect(view(s, alice).myBoard).toMatchObject({ placed: false, ready: false });
    expect(view(s, alice).myBoard?.ships.map((x) => x.id)).toEqual(['s2']);
    expect(view(s, bob).targets[0]).toMatchObject({ shipsLeft: 1, shipsTotal: 4 });
    expect(errorsOf(s.game(alice, { t: 'placeReady' }))).toEqual(['Place your ships first.']);
    s.game(alice, { t: 'place', ships: [ROWS[2], ROWS[0], ROWS[3]] });
    expect(view(s, alice).myBoard?.ships.map((x) => x.id)).toEqual(['s0', 's2', 's3']);
    expect(view(s, alice).myBoard?.placed).toBe(false);
    s.game(alice, { t: 'place', ships: ROWS });
    expect(view(s, alice).myBoard?.placed).toBe(true);
    // Bob's three ships keep their spots at the deadline; s1 takes the first free one.
    s.game(bob, { t: 'place', ships: [ROWS[0], ROWS[2], ROWS[3]] });
    s.now += PLACE_MS;
    s.tick();
    expect(view(s).phase).toBe('playing');
    expect(shipsOf(s, bob).map((x) => [x.id, x.x, x.y])).toEqual([['s0', 0, 0], ['s1', 4, 0], ['s2', 0, 2], ['s3', 0, 3]]);
  });

  it('auto-places a random valid layout on request, needs a layout before ready and locks a ready fleet', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    expect(errorsOf(s.game(alice, { t: 'placeReady' }))).toEqual(['Place your ships first.']);
    s.game(alice, { t: 'autoPlace' });
    // rng () => 0 packs the fleet into the top rows.
    expect(view(s, alice).myBoard?.ships.map((x) => [x.x, x.y, x.horizontal])).toEqual([
      [0, 0, true],
      [4, 0, true],
      [0, 1, true],
      [3, 1, true],
    ]);
    const effects = s.game(alice, { t: 'placeReady' });
    expect(chatTexts(effects)).toEqual(["Alice's fleet is in position."]);
    expect(view(s, bob).sides[0]).toMatchObject({ id: alice, ready: true });
    expect(view(s).phase).toBe('placing');
    expect(errorsOf(s.game(alice, { t: 'place', ships: ROWS }))).toEqual(['Your fleet is already locked in.']);
    expect(errorsOf(s.game(alice, { t: 'autoPlace' }))).toEqual(['Your fleet is already locked in.']);
    expect(errorsOf(s.game(alice, { t: 'placeReady' }))).toEqual(['Your fleet is already locked in.']);
  });

  it('starts the shooting as soon as every fleet is ready, with the first player in join order up', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    s.game(bob, { t: 'place', ships: ROWS });
    s.game(bob, { t: 'placeReady' });
    s.game(alice, { t: 'place', ships: ROWS });
    const effects = s.game(alice, { t: 'placeReady' });
    expect(chatTexts(effects)).toEqual(["Alice's fleet is in position.", 'All fleets are in position. Fire at will!']);
    expect(view(s)).toMatchObject({ phase: 'playing', turn: { sideId: alice, shooterId: alice }, endsAt: s.now + TURN_MS, turnNumber: 1 });
    expect(nextDeadline(s.data)).toBe(s.now + TURN_MS);
    expect(errorsOf(s.game(alice, { t: 'place', ships: ROWS }))).toEqual(['The fleets are already placed.']);
  });

  it('gives everyone not ready a random layout when the placing clock runs out', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'place', ships: ROWS });
    s.game(alice, { t: 'placeReady' });
    s.game(bob, { t: 'place', ships: BLOCKED });
    s.now += PLACE_MS;
    const effects = s.tick();
    expect(chatTexts(effects)).toEqual(["Time's up — the remaining fleets took their positions.", 'All fleets are in position. Fire at will!']);
    expect(view(s).phase).toBe('playing');
    expect(view(s).sides.every((x) => x.ready && x.shipsLeft === 4)).toBe(true);
    // Alice kept her layout, Bob his unlocked one, Carol got a random fleet.
    expect(shipsOf(s, alice).map((x) => [x.x, x.y])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    expect(shipsOf(s, bob).map((x) => [x.x, x.y])).toEqual([[0, 0], [4, 0], [4, 3], [4, 6]]);
    expect(shipsOf(s, s.playerId('Carol')).map((x) => [x.x, x.y])).toEqual([[0, 0], [4, 0], [0, 1], [3, 1]]);
  });

  it('splits teams alternately by join order with a captain each, and teammates watch the captain place', () => {
    const s = sim('battleships');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { mode: 'teams' });
    expect(chatTexts(s.effects)).toContain("Captains, place your team's ships! You have 30 seconds.");
    expect(chatTexts(s.effects)).toContain('Team A: Alice, Carol.');
    expect(chatTexts(s.effects)).toContain('Team B: Bob.');
    expect(view(s).sides).toEqual([
      { id: 'A', memberIds: [alice, carol], captainId: alice, alive: true, ready: false, shipsLeft: 0 },
      { id: 'B', memberIds: [bob], captainId: bob, alive: true, ready: false, shipsLeft: 0 },
    ]);
    expect(view(s, carol)).toMatchObject({ mySideId: 'A' });
    expect(errorsOf(s.game(carol, { t: 'place', ships: ROWS }))).toEqual(["Only your team's captain places the ships."]);
    s.game(alice, { t: 'place', ships: ROWS });
    // Carol sees the fleet live; Bob sees nothing of it.
    expect(view(s, carol).myBoard?.ships.map((x) => x.id)).toEqual(['s0', 's1', 's2', 's3']);
    expect(view(s, carol).targets.map((t) => t.sideId)).toEqual(['B']);
    expect(view(s, bob).targets).toEqual([{ sideId: 'A', shots: {}, shipsLeft: 4, shipsTotal: 4, sunkLengths: [] }]);
    // The captain is the lowest join order, away or not: a stand-in may not lock the layout in.
    disconnect(s, alice, 'Alice');
    expect(view(s).sides[0].captainId).toBe(alice);
    expect(errorsOf(s.game(carol, { t: 'placeReady' }))).toEqual(["Only your team's captain places the ships."]);
    expect(errorsOf(s.game(carol, { t: 'place', ships: ROWS }))).toEqual(["Only your team's captain places the ships."]);
    reconnect(s, alice, 'Alice');
    expect(errorsOf(s.game(alice, { t: 'placeReady' }))).toEqual([]);
    expect(chatTexts(s.effects)).toContain("Team A's fleet is in position.");
  });

  it('passes the captaincy on only when the captain leaves for good', () => {
    const s = sim('battleships');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { mode: 'teams' });
    expect(view(s).sides[0]).toMatchObject({ memberIds: [alice, carol], captainId: alice });
    s.apply({ type: 'leave', playerId: alice });
    expect(view(s).sides[0]).toMatchObject({ memberIds: [carol], captainId: carol });
    expect(errorsOf(s.game(carol, { t: 'place', ships: ROWS }))).toEqual([]);
    expect(bob).toBeTruthy();
  });
});

describe('Battleships: shooting', () => {
  it('resolves misses, hits and sinks with lines, points, the log and marks everyone can see', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    placeAll(s, [alice, bob]);
    expect(errorsOf(fire(s, bob, alice, 7, 7))).toEqual(['It is not your turn.']);
    expect(errorsOf(fire(s, alice, alice, 7, 7))).toEqual(["Pick an opponent's grid."]);
    expect(errorsOf(fire(s, alice, 'nope', 7, 7))).toEqual(["Pick an opponent's grid."]);
    expect(errorsOf(fire(s, alice, bob, 8, 0))).toEqual(['That cell is off the board.']);

    const miss = fire(s, alice, bob, 7, 7);
    expect(chatTexts(miss)).toEqual(['Alice fires at Bob H8: miss.']);
    expect(score(s, alice)).toBe(0);
    expect(view(s)).toMatchObject({ turn: { sideId: bob, shooterId: bob }, turnNumber: 2, dice: null });
    expect(view(s).lastShot).toEqual({ shooterId: alice, targetId: bob, x: 7, y: 7, result: 'miss', length: null, dice: null, auto: false });
    expect(view(s, bob).myBoard?.shots).toEqual({ '7,7': 'miss' });
    expect(view(s, alice).targets[0].shots).toEqual({ '7,7': 'miss' });

    const hit = fire(s, bob, alice, 0, 3);
    expect(chatTexts(hit)).toEqual(['Bob fires at Alice A4: hit!']);
    expect(score(s, bob)).toBe(10);
    // A hit never says which ship it found: the length is for sinks only.
    expect(view(s).lastShot).toMatchObject({ result: 'hit', length: null });
    expect(view(s, alice).lastShot?.length).toBeNull();
    expect(view(s).log.every((e) => e.result === 'sunk' || e.length === null)).toBe(true);
    expect(view(s, alice).myBoard?.ships[3]).toMatchObject({ id: 's3', hits: 1, sunk: false });
    expect(errorsOf(fire(s, alice, bob, 7, 7))).toEqual(['That cell was already shot.']);
    fire(s, alice, bob, 7, 6);
    const sunk = fire(s, bob, alice, 1, 3);
    expect(chatTexts(sunk)).toEqual(['Bob fires at Alice B4: sunk a 2-ship!']);
    expect(score(s, bob)).toBe(50);
    expect(view(s, bob).targets[0]).toEqual({ sideId: alice, shots: { '0,3': 'sunk', '1,3': 'sunk' }, shipsLeft: 3, shipsTotal: 4, sunkLengths: [2] });
    expect(view(s).sides[0].shipsLeft).toBe(3);
    expect(view(s).log.map((e) => e.result)).toEqual(['miss', 'hit', 'miss', 'sunk']);
    expect(view(s).lastShot).toMatchObject({ result: 'sunk', length: 2 });
  });

  it('keeps only the last twelve shots in the log', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    placeAll(s, [alice, bob]);
    const cells = openCells();
    for (let i = 0; i < 15; i++) {
      const [x, y] = cells.next().value as [number, number];
      fire(s, i % 2 === 0 ? alice : bob, i % 2 === 0 ? bob : alice, x, y);
    }
    expect(view(s).log).toHaveLength(12);
    expect(view(s).turnNumber).toBe(16);
    expect(data(s).shotsTaken).toBe(15);
  });

  it('fires a random valid shot for a shooter whose clock ran out', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    placeAll(s, [alice, bob]);
    s.now += TURN_MS;
    const effects = s.tick();
    // rng () => 0: the first open cell of the first opponent, A1, which ROWS covers.
    expect(chatTexts(effects)).toEqual(['Alice ran out of time — a shot is fired for them.', 'Alice fires at Bob A1: hit!']);
    expect(view(s).lastShot).toMatchObject({ shooterId: alice, targetId: bob, x: 0, y: 0, result: 'hit', auto: true });
    expect(view(s)).toMatchObject({ turn: { shooterId: bob }, endsAt: s.now + TURN_MS });
    expect(nextDeadline(s.data)).toBe(s.now + TURN_MS);
    s.now += TURN_MS;
    s.tick();
    expect(view(s).lastShot).toMatchObject({ shooterId: bob, x: 0, y: 0, result: 'hit', auto: true });
    // The next auto shot skips the cell already shot.
    s.now += TURN_MS;
    s.tick();
    expect(view(s).lastShot).toMatchObject({ shooterId: alice, x: 1, y: 0, result: 'hit' });
  });

  it('rotates solo turns through the alive players by join order, skipping sides that are out', () => {
    const s = sim('battleships');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    placeAll(s, [alice, bob, carol]);
    const cells = openCells();
    const shoot = (shooter: string, target: string): void => {
      const [x, y] = cells.next().value as [number, number];
      fire(s, shooter, target, x, y);
    };
    expect(view(s).turn?.shooterId).toBe(alice);
    shoot(alice, bob);
    expect(view(s).turn?.shooterId).toBe(bob);
    shoot(bob, carol);
    expect(view(s).turn?.shooterId).toBe(carol);
    shoot(carol, alice);
    expect(view(s).turn?.shooterId).toBe(alice);
    // Alice and Carol sink Bob between them (shots at a board are shared by everyone shooting at it).
    for (let i = 0; i < ROW_CELLS.length; i++) {
      const c = ROW_CELLS[i];
      const shooter = view(s).turn?.shooterId;
      if (shooter === bob) shoot(bob, alice);
      const who = view(s).turn?.shooterId ?? '';
      fire(s, who, bob, c.x, c.y);
    }
    expect(view(s).sides[1]).toMatchObject({ id: bob, alive: false, shipsLeft: 0 });
    expect(chatTexts(s.effects)).toContain("Bob's fleet is sunk — they are out!");
    expect(view(s).phase).toBe('playing');
    // Bob is out: the turns go Alice, Carol, Alice...
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const who = view(s).turn?.shooterId ?? '';
      order.push(who);
      shoot(who, who === alice ? carol : alice);
    }
    expect(order.filter((id) => id === bob)).toEqual([]);
    expect(new Set(order)).toEqual(new Set([alice, carol]));
    expect(errorsOf(fire(s, bob, alice, 7, 0))).toEqual(['It is not your turn.']);
    expect(errorsOf(fire(s, view(s).turn?.shooterId ?? '', bob, 7, 0))).toEqual(["Pick an opponent's grid."]);
  });

  it('ends the game when one fleet is left: the win bonus for the winner, a line and the podium', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    placeAll(s, [alice, bob]);
    const cells = openCells();
    let last: Effect[] = [];
    for (const c of ROW_CELLS) {
      last = fire(s, alice, bob, c.x, c.y);
      if (s.data.phase === 'playing') {
        const [x, y] = cells.next().value as [number, number];
        fire(s, bob, alice, x, y);
      }
    }
    expect(s.data.phase).toBe('ended');
    expect(chatTexts(last)).toEqual(['Alice fires at Bob B4: sunk a 2-ship!', "Bob's fleet is sunk — they are out!", 'Alice wins — the last fleet afloat!', 'Game over! Alice wins with 340 points.']);
    // 12 hits, 4 sinks, the win.
    expect(score(s, alice)).toBe(12 * BATTLESHIPS_POINTS.hit + 4 * BATTLESHIPS_POINTS.sink + BATTLESHIPS_POINTS.win);
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 340, rank: 1 },
      { playerId: bob, score: 0, rank: 2 },
    ]);
    expect(view(s)).toMatchObject({ phase: 'gameOver', winnerSideId: alice, turn: null, endsAt: null });
    expect(nextDeadline(s.data)).toBeNull();
    expect(errorsOf(fire(s, bob, alice, 7, 7))).toEqual(['The game is not running.']);
  });
});

describe('Battleships: dice and moves', () => {
  /** Two fleets placed and Alice's first shot a miss with a high roll: her move window is open. */
  function openWindow(layout: ShipPlacement[] = ROWS): { s: Sim; alice: string; bob: string; set(r: number): void } {
    const { s, set } = steerable();
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { diceMoves: true });
    placeAll(s, [alice, bob], layout);
    set(0.99);
    return { s, alice, bob, set };
  }

  it('rolls after every shot; a low roll goes straight on, a 5 or 6 opens a timed move window', () => {
    const { s, set } = steerable();
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { diceMoves: true });
    placeAll(s, [alice, bob]);
    const low = fire(s, alice, bob, 7, 7);
    expect(chatTexts(low)).toEqual(['Alice fires at Bob H8: miss.']);
    expect(view(s)).toMatchObject({ phase: 'playing', dice: 1, turn: { shooterId: bob } });
    expect(view(s).lastShot?.dice).toBe(1);
    set(0.99);
    const high = fire(s, bob, alice, 7, 7);
    expect(chatTexts(high)).toEqual(['Bob fires at Alice H8: miss.', 'Bob rolls a 6 — a ship may slip away!']);
    expect(view(s)).toMatchObject({ phase: 'moving', dice: 6, turn: { sideId: bob, shooterId: bob }, endsAt: s.now + MOVE_MS });
    expect(nextDeadline(s.data)).toBe(s.now + MOVE_MS);
    expect(view(s, bob).myBoard?.movable).toEqual([
      { id: 's0', forward: true, back: false },
      { id: 's1', forward: true, back: false },
      { id: 's2', forward: true, back: false },
      { id: 's3', forward: true, back: false },
    ]);
    expect(view(s, alice).myBoard?.movable).toEqual([]);
    expect(errorsOf(fire(s, alice, bob, 6, 7))).toEqual(['It is not your turn.']);
    expect(errorsOf(fire(s, bob, alice, 6, 7))).toEqual(['It is not your turn.']);
  });

  it('slides an undamaged ship one cell along its axis in secret: recorded shots stay put', () => {
    const { s, alice, bob } = openWindow();
    expect(chatTexts(fire(s, alice, bob, 4, 0))).toEqual(['Alice fires at Bob E1: miss.', 'Alice rolls a 6 — a ship may slip away!']);
    // Alice's window: her own fleet moves, Bob's view of her grid stays as it was.
    expect(errorsOf(s.game(bob, { t: 'move', shipId: 's0', direction: 'forward' }))).toEqual(['You have no move right now.']);
    expect(errorsOf(s.game(alice, { t: 'move', shipId: 's0', direction: 'back' }))).toEqual(['There is no room that way.']);
    expect(errorsOf(s.game(alice, { t: 'move', shipId: 's9', direction: 'forward' }))).toEqual(['No such ship.']);
    const before = view(s, bob).targets[0];
    const effects = s.game(alice, { t: 'move', shipId: 's0', direction: 'forward' });
    expect(chatTexts(effects)).toEqual([]);
    expect(view(s, alice).myBoard?.ships[0]).toMatchObject({ id: 's0', x: 1, y: 0 });
    expect(view(s, bob).targets[0]).toEqual(before);
    expect(view(s)).toMatchObject({ phase: 'playing', turn: { shooterId: bob } });
    // Alice's earlier miss at Bob's E1 stays a miss; Bob's turn now.
    expect(view(s, alice).targets[0].shots).toEqual({ '4,0': 'miss' });
  });

  it('never lets a ship hide under an old miss, which nobody may shoot twice', () => {
    const { s, alice, bob, set } = openWindow();
    set(0);
    fire(s, alice, bob, 7, 7);
    // Bob misses Alice at E1 (A1-D1 is her s0), then rolls high and slides nothing; Alice rolls high next.
    set(0.99);
    fire(s, bob, alice, 4, 0);
    expect(view(s).phase).toBe('moving');
    s.game(bob, { t: 'skipMove' });
    fire(s, alice, bob, 6, 7);
    expect(view(s).phase).toBe('moving');
    // E1 is marked: s0 may not slide under it, so the move list leaves s0 out and the slide is refused.
    expect(view(s, alice).myBoard?.movable.map((m) => m.id)).toEqual(['s1', 's2', 's3']);
    expect(errorsOf(s.game(alice, { t: 'move', shipId: 's0', direction: 'forward' }))).toEqual(['There is no room that way.']);
    expect(view(s, alice).myBoard?.ships[0]).toMatchObject({ x: 0, y: 0, hits: 0 });
    expect(view(s).phase).toBe('moving');
    s.game(alice, { t: 'move', shipId: 's1', direction: 'forward' });
    expect(view(s, alice).myBoard?.ships[1]).toMatchObject({ x: 1, y: 1 });
    // Every afloat ship keeps an unshot cell: Bob can still sink s0 outright.
    for (const x of [0, 1, 2, 3]) {
      fire(s, bob, alice, x, 0);
      if (view(s).phase === 'moving') s.game(bob, { t: 'skipMove' });
      fire(s, alice, bob, x, 7);
      if (view(s).phase === 'moving') s.game(alice, { t: 'skipMove' });
    }
    expect(view(s, alice).myBoard?.ships[0]).toMatchObject({ hits: 4, sunk: true });
  });

  it('calls a draw instead of dealing empty turns should no open cell be left anywhere', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    placeAll(s, [alice, bob]);
    // A state the rules no longer reach: every cell of Bob's grid marked while his fleet floats.
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) data(s).sides[1].shots[cellKey(x, y)] = 'miss';
    s.now += TURN_MS;
    const effects = s.tick();
    expect(chatTexts(effects)).toEqual(['No cell is left to shoot at — the battle is a draw.', 'Game over! Alice and Bob tie with 0 points.']);
    expect(s.data.phase).toBe('ended');
    expect(view(s)).toMatchObject({ phase: 'gameOver', winnerSideId: null });
    expect(score(s, alice)).toBe(0);
    expect(score(s, bob)).toBe(0);
  });

  it('refuses to move a damaged ship and closes the window on skip or on its clock', () => {
    const { s, alice, bob } = openWindow();
    fire(s, alice, bob, 0, 0);
    expect(view(s).phase).toBe('moving');
    s.game(alice, { t: 'skipMove' });
    expect(view(s)).toMatchObject({ phase: 'playing', turn: { shooterId: bob } });
    fire(s, bob, alice, 7, 7);
    expect(view(s)).toMatchObject({ phase: 'moving', turn: { shooterId: bob } });
    s.now += MOVE_MS;
    s.tick();
    expect(view(s)).toMatchObject({ phase: 'playing', turn: { shooterId: alice }, endsAt: s.now + TURN_MS });
    fire(s, alice, bob, 1, 0);
    expect(view(s).phase).toBe('moving');
    // Bob's s0 took two hits: it stays where it is.
    expect(errorsOf(s.game(alice, { t: 'move', shipId: 's0', direction: 'forward' }))).toEqual([]);
    expect(view(s)).toMatchObject({ phase: 'playing', turn: { shooterId: bob } });
    fire(s, bob, alice, 7, 6);
    expect(errorsOf(s.game(bob, { t: 'move', shipId: 's0', direction: 'forward' }))).toEqual(['A damaged ship cannot move.']);
    expect(view(s, bob).myBoard?.movable.map((m) => m.id)).toEqual(['s1', 's2', 's3']);
    expect(errorsOf(s.game(bob, { t: 'skipMove' }))).toEqual([]);
    expect(errorsOf(s.game(bob, { t: 'skipMove' }))).toEqual(['You have no move right now.']);
  });

  it('opens the window with the same line even when no ship has room (the shooter alone sees an empty list), and never rolls with dice off', () => {
    const { s, alice, bob } = openWindow(BLOCKED);
    const effects = fire(s, alice, bob, 7, 7);
    expect(chatTexts(effects)).toEqual(['Alice fires at Bob H8: miss.', 'Alice rolls a 6 — a ship may slip away!']);
    expect(view(s)).toMatchObject({ phase: 'moving', dice: 6, turn: { shooterId: alice }, endsAt: s.now + MOVE_MS });
    expect(view(s, alice).myBoard?.movable).toEqual([]);
    expect(view(s, bob).myBoard?.movable).toEqual([]);
    expect(errorsOf(s.game(alice, { t: 'move', shipId: 's0', direction: 'forward' }))).toEqual(['There is no room that way.']);
    s.game(alice, { t: 'skipMove' });
    expect(view(s)).toMatchObject({ phase: 'playing', turn: { shooterId: bob } });

    const quiet = sim('battleships', 'ABCD', START, () => 0.99);
    const [carol, dave] = startGame(quiet, ['Carol', 'Dave']);
    placeAll(quiet, [carol, dave]);
    expect(chatTexts(fire(quiet, carol, dave, 7, 7))).toEqual(['Carol fires at Dave H8: miss.']);
    expect(view(quiet)).toMatchObject({ phase: 'playing', dice: null });
    expect(view(quiet).lastShot?.dice).toBeNull();
  });

  it('opens the window for the team shooter, whose slide moves the shared board', () => {
    const { s, set } = steerable();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { mode: 'teams', diceMoves: true });
    placeAll(s, [alice, bob]);
    set(0.99);
    fire(s, alice, 'B', 7, 7);
    s.game(alice, { t: 'skipMove' });
    fire(s, bob, 'A', 7, 7);
    s.game(bob, { t: 'skipMove' });
    expect(view(s).turn).toEqual({ sideId: 'A', shooterId: carol });
    fire(s, carol, 'B', 6, 7);
    expect(view(s)).toMatchObject({ phase: 'moving', turn: { sideId: 'A', shooterId: carol } });
    expect(view(s, carol).myBoard?.movable.length).toBe(4);
    expect(view(s, alice).myBoard?.movable).toEqual([]);
    expect(errorsOf(s.game(alice, { t: 'move', shipId: 's0', direction: 'forward' }))).toEqual(['You have no move right now.']);
    s.game(carol, { t: 'move', shipId: 's3', direction: 'forward' });
    expect(view(s, alice).myBoard?.ships[3]).toMatchObject({ x: 1, y: 3 });
    expect(view(s, bob).targets[0].shots).toEqual({ '7,7': 'miss' });
  });
});

describe('Battleships: teams', () => {
  it('alternates teams and rotates members within each, skipping disconnected members', () => {
    const s = sim('battleships');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { mode: 'teams' });
    expect(view(s).sides.map((x) => x.memberIds)).toEqual([[alice, carol], [bob, dave]]);
    placeAll(s, [alice, bob]);
    const cells = openCells();
    const order: string[] = [];
    const shoot = (): void => {
      const turn = view(s).turn;
      if (!turn) throw new Error('no turn');
      order.push(turn.shooterId);
      const [x, y] = cells.next().value as [number, number];
      fire(s, turn.shooterId, turn.sideId === 'A' ? 'B' : 'A', x, y);
    };
    for (let i = 0; i < 4; i++) shoot();
    expect(order).toEqual([alice, bob, carol, dave]);
    expect(errorsOf(fire(s, alice, 'A', 7, 0))).toEqual(["Pick an opponent's grid."]);
    expect(errorsOf(fire(s, alice, bob, 7, 0))).toEqual(["Pick an opponent's grid."]);
    disconnect(s, carol, 'Carol');
    for (let i = 0; i < 4; i++) shoot();
    expect(order.slice(4)).toEqual([alice, bob, alice, dave]);
    // Alice's turn was already assigned while Carol was away; Carol is back in the rotation after it.
    reconnect(s, carol, 'Carol');
    for (let i = 0; i < 3; i++) shoot();
    expect(order.slice(8)).toEqual([alice, bob, carol]);
  });

  it('shares the hits with the team and pays every member of the winning team the bonus', () => {
    const s = sim('battleships');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { mode: 'teams' });
    placeAll(s, [alice, bob]);
    const cells = openCells();
    let last: Effect[] = [];
    for (const c of ROW_CELLS) {
      const turn = view(s).turn;
      if (!turn) throw new Error('no turn');
      last = fire(s, turn.shooterId, 'B', c.x, c.y);
      if (s.data.phase === 'playing') {
        const [x, y] = cells.next().value as [number, number];
        fire(s, bob, 'A', x, y);
      }
    }
    expect(s.data.phase).toBe('ended');
    expect(chatTexts(last).slice(-3)).toEqual(["Team B's fleet is sunk — Team B is out!", 'Team A wins — the last fleet afloat!', 'Game over! Carol wins with 250 points.']);
    expect(view(s, alice).targets[0].shots['0,0']).toBe('sunk');
    // Alice fired 6 of the 12 shots (one sink), Carol the other 6 (three sinks), both took the bonus.
    expect(score(s, alice)).toBe(6 * BATTLESHIPS_POINTS.hit + BATTLESHIPS_POINTS.sink + BATTLESHIPS_POINTS.win);
    expect(score(s, carol)).toBe(6 * BATTLESHIPS_POINTS.hit + 3 * BATTLESHIPS_POINTS.sink + BATTLESHIPS_POINTS.win);
    expect(score(s, alice) + score(s, carol)).toBe(12 * BATTLESHIPS_POINTS.hit + 4 * BATTLESHIPS_POINTS.sink + 2 * BATTLESHIPS_POINTS.win);
    expect(score(s, bob)).toBe(0);
    expect(s.data.podium?.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(view(s).winnerSideId).toBe('A');
  });

  it('holds while a whole team is away and goes on when one of them is back', () => {
    const s = sim('battleships');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { mode: 'teams' });
    placeAll(s, [alice, bob]);
    disconnect(s, bob, 'Bob');
    expect(view(s).phase).toBe('playing');
    expect(waiting(s)).toBeNull();
    const effects = disconnect(s, dave, 'Dave');
    expect(chatTexts(effects)).toContain('Waiting for Bob, Dave to reconnect…');
    expect(view(s)).toMatchObject({ phase: 'playing', paused: true, turn: null, endsAt: null });
    expect(waiting(s)).toEqual([bob, dave]);
    expect(gameDeadline(s)).toBeNull();
    expect(errorsOf(fire(s, alice, 'B', 7, 7))).toEqual(['It is not your turn.']);
    reconnect(s, dave, 'Dave');
    expect(waiting(s)).toEqual([bob]);
    expect(gameDeadline(s)).toBe(s.now + RESUME_SETTLE_MS);
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(waiting(s)).toBeNull();
    expect(view(s)).toMatchObject({ paused: false, turn: { sideId: 'A', shooterId: alice } });
    expect(carol).toBeTruthy();
  });

  it('keeps the rotation in place when a teammate leaves: the member after the last shooter is still up', () => {
    const s = sim('battleships');
    const [alice, bob, carol, dave, eve] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'], { mode: 'teams' });
    placeAll(s, [alice, bob]);
    fire(s, alice, 'B', 7, 7);
    fire(s, bob, 'A', 7, 7);
    fire(s, carol, 'B', 6, 7);
    expect(view(s).turn?.shooterId).toBe(dave);
    // Alice sat before Carol, the last shooter of Team A: Eve, not Carol again, follows Dave.
    s.apply({ type: 'leave', playerId: alice });
    expect(view(s).sides[0].memberIds).toEqual([carol, eve]);
    fire(s, dave, 'A', 6, 7);
    expect(view(s).turn?.shooterId).toBe(eve);
    fire(s, eve, 'B', 5, 7);
    fire(s, bob, 'A', 5, 7);
    expect(view(s).turn?.shooterId).toBe(carol);
    // The last shooter leaving: the one after them is still up.
    fire(s, carol, 'B', 4, 7);
    s.apply({ type: 'leave', playerId: carol });
    fire(s, dave, 'A', 4, 7);
    expect(view(s).turn?.shooterId).toBe(eve);
  });

  it('aborts when a whole team has left, and plays on when a member leaves a team with others', () => {
    const s = sim('battleships');
    const [alice, bob, carol, dave, eve] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'], { mode: 'teams' });
    expect(view(s).sides.map((x) => x.memberIds)).toEqual([[alice, carol, eve], [bob, dave]]);
    placeAll(s, [alice, bob]);
    s.apply({ type: 'leave', playerId: dave });
    expect(s.data.phase).toBe('playing');
    expect(view(s).sides[1]).toMatchObject({ memberIds: [bob], alive: true });
    fire(s, alice, 'B', 7, 7);
    expect(view(s).turn?.shooterId).toBe(bob);
    fire(s, bob, 'A', 7, 7);
    expect(view(s).turn?.shooterId).toBe(carol);
    const effects = s.apply({ type: 'leave', playerId: bob });
    expect(chatTexts(effects)).toContain('Team B has nobody left — back to the lobby.');
    expect(s.data.phase).toBe('lobby');
    expect(s.data.game).toBeNull();
  });
});

describe('Battleships: holds, leaves and joiners', () => {
  it('holds at the start of play while a side has nobody connected, then resumes after a settle', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    disconnect(s, bob, 'Bob');
    s.game(alice, { t: 'place', ships: ROWS });
    s.game(alice, { t: 'placeReady' });
    expect(view(s).phase).toBe('placing');
    s.now += PLACE_MS;
    const effects = s.tick();
    expect(chatTexts(effects)).toEqual(["Time's up — the remaining fleets took their positions.", 'All fleets are in position. Fire at will!', 'Waiting for Bob to reconnect…']);
    expect(view(s)).toMatchObject({ phase: 'playing', paused: true, turn: null, endsAt: null });
    expect(waiting(s)).toEqual([bob]);
    expect(gameDeadline(s)).toBeNull();
    expect(shipsOf(s, bob)).toHaveLength(4);
    s.now += 60_000;
    expect(s.tick()).toEqual([]);
    reconnect(s, bob, 'Bob');
    expect(gameDeadline(s)).toBe(s.now + RESUME_SETTLE_MS);
    // A disconnect during the settle holds again.
    disconnect(s, bob, 'Bob', '-2');
    expect(gameDeadline(s)).toBeNull();
    reconnect(s, bob, 'Bob');
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(waiting(s)).toBeNull();
    expect(view(s)).toMatchObject({ phase: 'playing', paused: false, turn: { sideId: alice, shooterId: alice }, endsAt: s.now + TURN_MS });
  });

  it('holds mid-turn when the last opponent drops and gives the same side its turn back afterwards', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    placeAll(s, [alice, bob]);
    fire(s, alice, bob, 7, 7);
    expect(view(s).turn?.shooterId).toBe(bob);
    // Bob's turn; Alice drops: nobody to shoot at, so the game holds and Bob's clock is gone.
    const effects = disconnect(s, alice, 'Alice');
    expect(chatTexts(effects)).toContain('Waiting for Alice to reconnect…');
    expect(view(s)).toMatchObject({ paused: true, turn: null });
    expect(gameDeadline(s)).toBeNull();
    reconnect(s, alice, 'Alice');
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(view(s)).toMatchObject({ paused: false, turn: { shooterId: bob } });
  });

  it('lets a move window run while the only opponent is away, and holds at the boundary after it', () => {
    const { s, set } = steerable();
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { diceMoves: true });
    placeAll(s, [alice, bob]);
    set(0.99);
    fire(s, alice, bob, 7, 7);
    expect(view(s)).toMatchObject({ phase: 'moving', turn: { shooterId: alice } });
    const effects = disconnect(s, bob, 'Bob');
    expect(chatTexts(effects)).toEqual([]);
    expect(view(s)).toMatchObject({ phase: 'moving', paused: false, turn: { shooterId: alice }, endsAt: s.now + MOVE_MS });
    expect(waiting(s)).toBeNull();
    expect(errorsOf(s.game(alice, { t: 'move', shipId: 's0', direction: 'forward' }))).toEqual([]);
    expect(view(s, alice).myBoard?.ships[0]).toMatchObject({ x: 1, y: 0 });
    // The slide done, the turn boundary holds for Bob; his return gives him the turn.
    expect(view(s)).toMatchObject({ phase: 'playing', paused: true, turn: null });
    expect(waiting(s)).toEqual([bob]);
    reconnect(s, bob, 'Bob');
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(view(s)).toMatchObject({ paused: false, turn: { shooterId: bob } });
    // The window's own clock closes it while the opponent is away too.
    set(0.99);
    fire(s, bob, alice, 7, 7);
    disconnect(s, alice, 'Alice');
    expect(view(s).phase).toBe('moving');
    s.now += MOVE_MS;
    s.tick();
    expect(view(s)).toMatchObject({ phase: 'playing', paused: true, turn: null });
  });

  it('skips the shooter who drops mid-turn, and the shooter whose move window is open', () => {
    const { s, set } = steerable();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { diceMoves: true });
    placeAll(s, [alice, bob, carol]);
    const effects = disconnect(s, alice, 'Alice');
    expect(chatTexts(effects)).toContain('Alice is away — skipping their turn.');
    expect(view(s)).toMatchObject({ paused: false, turn: { shooterId: bob } });
    expect(waiting(s)).toBeNull();
    set(0.99);
    fire(s, bob, carol, 7, 7);
    expect(view(s).phase).toBe('moving');
    const away = disconnect(s, bob, 'Bob');
    // The window closes with the fleet where it was; Carol alone means a hold, which Bob's return ends.
    expect(chatTexts(away)).toContain('Bob is away — skipping their turn.');
    expect(view(s)).toMatchObject({ phase: 'playing', paused: true, turn: null });
    expect(waiting(s)).toEqual([alice, bob]);
    set(0);
    reconnect(s, bob, 'Bob');
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(view(s).turn?.shooterId).toBe(carol);
    fire(s, carol, bob, 7, 7);
    expect(view(s).turn?.shooterId).toBe(bob);
    reconnect(s, alice, 'Alice');
    fire(s, bob, carol, 6, 7);
    expect(view(s).turn?.shooterId).toBe(carol);
    fire(s, carol, bob, 6, 7);
    expect(view(s).turn?.shooterId).toBe(alice);
  });

  it('lets a solo fleet drift away when its player leaves, and the last one floating wins', () => {
    const s = sim('battleships');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    placeAll(s, [alice, bob, carol]);
    // Dave joins mid-play as a watcher: a seat without a fleet, which keeps the party above the minimum.
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' });
    const effects = s.apply({ type: 'leave', playerId: bob });
    expect(chatTexts(effects)).toEqual(['Bob left', 'Their fleet drifts away.']);
    expect(s.data.phase).toBe('playing');
    expect(view(s).sides[1]).toMatchObject({ id: bob, memberIds: [], captainId: '', alive: false });
    expect(view(s).turn?.shooterId).toBe(alice);
    expect(errorsOf(fire(s, alice, bob, 7, 7))).toEqual(["Pick an opponent's grid."]);
    fire(s, alice, carol, 7, 7);
    expect(view(s).turn?.shooterId).toBe(carol);
    // Carol leaves on her turn: Alice is the last fleet afloat.
    const last = s.apply({ type: 'leave', playerId: carol });
    expect(chatTexts(last)).toEqual(['Carol left', 'Their fleet drifts away.', 'Alice wins — the last fleet afloat!', 'Game over! Alice wins with 100 points.']);
    expect(s.data.phase).toBe('ended');
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 100, rank: 1 },
      { playerId: s.playerId('Dave'), score: 0, rank: 2 },
    ]);
  });

  it('is abandoned by the platform when a solo seat is lost below two players', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    placeAll(s, [alice, bob]);
    const effects = s.apply({ type: 'leave', playerId: bob });
    expect(chatTexts(effects)).toEqual(['Bob left', 'Not enough players — back to the lobby.']);
    expect(s.data.phase).toBe('lobby');
  });

  it('drops a leaver from the placing wait, so the others start without them', () => {
    const s = sim('battleships');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    s.game(alice, { t: 'place', ships: ROWS });
    s.game(alice, { t: 'placeReady' });
    s.game(carol, { t: 'place', ships: ROWS });
    s.game(carol, { t: 'placeReady' });
    expect(view(s).phase).toBe('placing');
    s.apply({ type: 'leave', playerId: bob });
    expect(view(s)).toMatchObject({ phase: 'playing', turn: { shooterId: alice } });
    expect(view(s).sides[1]).toMatchObject({ id: bob, alive: false });
  });

  it('seats a joiner with a fleet while placing, as a watcher during play, and on the smaller team in teams', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expect(view(s, carol)).toMatchObject({ mySideId: carol });
    expect(view(s).sides.map((x) => x.id)).toEqual([alice, bob, carol]);
    placeAll(s, [alice, bob, carol]);
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' });
    const dave = s.playerId('Dave');
    expect(view(s, dave)).toMatchObject({ mySideId: null, myBoard: null });
    expect(view(s, dave).targets.map((t) => t.sideId)).toEqual([alice, bob, carol]);
    expect(errorsOf(fire(s, dave, alice, 7, 7))).toEqual(['It is not your turn.']);
    expect(view(s).turn?.shooterId).toBe(alice);
    fire(s, alice, bob, 7, 7);
    fire(s, bob, carol, 7, 7);
    fire(s, carol, alice, 7, 7);
    expect(view(s).turn?.shooterId).toBe(alice);

    const t = sim('battleships');
    const [erin] = startGame(t, ['Erin', 'Finn', 'Gina'], { mode: 'teams' });
    placeAll(t, [erin, t.playerId('Finn')]);
    const effects = t.apply({ type: 'join', name: 'Hugo', avatar: AVATAR, connectionId: 'h' });
    const hugo = t.playerId('Hugo');
    expect(chatTexts(effects)).toContain('Hugo joins Team B.');
    expect(view(t, hugo)).toMatchObject({ mySideId: 'B' });
    expect(view(t, hugo).myBoard?.ships).toHaveLength(4);
  });

  it('never shows another side\'s ships to anyone, spectators included', () => {
    const { s, set } = steerable();
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { mode: 'teams', diceMoves: true });
    s.apply({ type: 'join', name: 'Eve', avatar: AVATAR, connectionId: 'e' });
    const eve = s.playerId('Eve');
    const check = (): void => {
      for (const viewer of [alice, bob, carol, dave, eve, null]) {
        const v = view(s, viewer);
        for (const target of v.targets) {
          expect(target.sideId).not.toBe(v.mySideId);
          expect(Object.keys(target)).toEqual(['sideId', 'shots', 'shipsLeft', 'shipsTotal', 'sunkLengths']);
          const theirs = shipsOf(s, target.sideId);
          for (const mark of Object.values(target.shots)) expect(['miss', 'hit', 'sunk']).toContain(mark);
          // A miss never sits on a ship cell and nothing but shots describes the grid.
          for (const [key, mark] of Object.entries(target.shots)) if (mark === 'miss') expect(theirs.flatMap((ship) => shipCells(ship).map((c) => cellKey(c.x, c.y)))).not.toContain(key);
        }
        if (v.myBoard) expect(v.myBoard.sideId).toBe(v.mySideId);
        else expect(v.mySideId).toBeNull();
      }
    };
    check();
    placeAll(s, [alice, bob]);
    check();
    const cells = openCells();
    for (let i = 0; i < 8; i++) {
      const turn = view(s).turn;
      if (!turn) throw new Error('no turn');
      set(i % 3 === 0 ? 0.99 : 0);
      const [x, y] = cells.next().value as [number, number];
      fire(s, turn.shooterId, turn.sideId === 'A' ? 'B' : 'A', x, y);
      if (view(s).phase === 'moving') s.game(turn.shooterId, { t: 'move', shipId: 's3', direction: 'forward' });
      check();
    }
    expect(view(s, eve).mySideId).toBe('A');
  });
});

describe('Battleships: the module as a function', () => {
  it('is pure: the same object comes back when nothing changed, and its data survives JSON', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    placeAll(s, [alice, bob]);
    const state = data(s);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    const ctx = {
      now: s.now,
      rng: () => 0,
      newId: () => 'x',
      settings: { ...defaultPlatformSettings(gameById('battleships')), ...battleshipsModule.settings.defaults, turnSeconds: 10 },
      players: s.data.players.map((p) => ({ id: p.id, name: p.name, joinOrder: p.joinOrder, connected: true, score: 0 })),
      spectators: [],
      hostId: alice,
    };
    expect(battleshipsModule.handle(ctx, state, { type: 'tick' }).data).toBe(state);
    expect(battleshipsModule.handle(ctx, state, { type: 'chat', playerId: alice, text: 'hi' }).data).toBe(state);
    expect(battleshipsModule.handle(ctx, state, { type: 'message', playerId: bob, msg: { t: 'fire', targetId: alice, x: 0, y: 0 } }).data).toBe(state);
    const shot = battleshipsModule.handle(ctx, state, { type: 'message', playerId: alice, msg: { t: 'fire', targetId: bob, x: 0, y: 0 } });
    expect(shot.data).not.toBe(state);
    expect(state.sides[1].shots).toEqual({});
    expect(shot.data.sides[1].shots).toEqual({ '0,0': 'hit' });
    expect(battleshipsModule.nextDeadline(state)).toBe(s.now + TURN_MS);
    expect(battleshipsModule.view(state, null, ctx).myBoard).toBeNull();
  });
});
