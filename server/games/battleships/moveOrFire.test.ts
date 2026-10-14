/** Move or fire: the roll at every turn start, firing or a secret move up to the roll, its limits, the clock and teams. */
import { describe, expect, it } from 'vitest';
import { cellKey, isSunk, segmentAt, shipCells } from '../../../shared/games/battleships/fleet.js';
import { shipOptions } from '../../../shared/games/battleships/moves.js';
import { BATTLESHIPS_DIRECTIONS, BATTLESHIPS_POINTS, type ShipMove, type ShipPlacement } from '../../../shared/games/battleships/protocol.js';
import { START, chatTexts, errorsOf, sim, startGame, type Sim } from '../../platform/engine/testHarness.js';
import type { Effect } from '../../platform/engine/effects.js';
import { RESUME_SETTLE_MS } from '../waiting.js';
import { TURN_MS, data, disconnect, fire, placeAll, reconnect, rollOf, score, shipsOf, steerable, view } from './testHarness.js';

/** Who got a room snapshot among these effects. */
const roomSentTo = (effects: Effect[]): string[] => effects.flatMap((e) => (e.type === 'send' && e.msg.t === 'room' ? (typeof e.to === 'string' ? [e.to] : Array.isArray(e.to) ? e.to : []) : []));

/** The small fleet with s3 out in open water: s0 A1-D1, s1 A2-C2, s2 A3-C3, s3 E7-F7. */
const MOVERS: ShipPlacement[] = [
  { id: 's0', x: 0, y: 0, horizontal: true },
  { id: 's1', x: 0, y: 1, horizontal: true },
  { id: 's2', x: 0, y: 2, horizontal: true },
  { id: 's3', x: 4, y: 6, horizontal: true },
];

const shift = (direction: (typeof BATTLESHIPS_DIRECTIONS)[number], steps: number): ShipMove => ({ kind: 'shift', direction, steps });
const move = (s: Sim, playerId: string, shipId: string, m: ShipMove) => s.game(playerId, { t: 'move', shipId, move: m });

/** Alice and Bob, move or fire on, MOVERS laid out, Alice up with `face` on the die. */
function duel(face: number, players = ['Alice', 'Bob']): { s: Sim; set(r: number): void; alice: string; bob: string; ids: string[] } {
  const { s, set } = steerable();
  const ids = startGame(s, players, { moveOrFire: true });
  set(rollOf(face));
  placeAll(s, ids, MOVERS);
  return { s, set, alice: ids[0], bob: ids[1], ids };
}

/** Misses along the bottom row of the target, never at a MOVERS ship. */
function misser(): (s: Sim, shooter: string, target: string) => void {
  let x = 0;
  return (s, shooter, target) => {
    expect(errorsOf(fire(s, shooter, target, x++, 9))).toEqual([]);
  };
}

describe('Battleships move or fire: the roll', () => {
  it('rolls one die as every turn starts, the same roll for everyone, recorded with the shot', () => {
    const { s, set, alice, bob } = duel(4);
    for (const viewer of [alice, bob, null]) {
      expect(view(s, viewer)).toMatchObject({ moveOrFire: true, turn: { sideId: alice, shooterId: alice, roll: 4, canMove: true }, turnNumber: 1 });
    }
    set(rollOf(2));
    expect(chatTexts(fire(s, alice, bob, 9, 9))).toEqual(['Alice fires at Bob J10: miss.']);
    expect(view(s).lastShot).toMatchObject({ shooterId: alice, dice: 4, auto: false });
    expect(view(s).lastAction).toEqual({ kind: 'fire', shot: view(s).lastShot });
    expect(view(s, alice).turn).toEqual({ sideId: bob, shooterId: bob, roll: 2, canMove: true });
    // The die's faces run 1 to 6 across the rng's range.
    set(0);
    fire(s, bob, alice, 9, 9);
    expect(view(s).turn?.roll).toBe(1);
    set(0.9999);
    fire(s, alice, bob, 8, 9);
    expect(view(s).turn?.roll).toBe(6);
  });

  it('plays classic Battleships with move or fire off: no roll, no moves, one shot a turn', () => {
    const s = sim('battleships');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    placeAll(s, [alice, bob], MOVERS);
    expect(view(s)).toMatchObject({ moveOrFire: false, turn: { shooterId: alice, roll: null, canMove: false } });
    expect(errorsOf(move(s, alice, 's3', shift('right', 1)))).toEqual(['Moving is off in this game. Take your shot.']);
    expect(errorsOf(s.game(alice, { t: 'plan', plan: { shipId: 's3', move: null } }))).toEqual(['Moving is off in this game. Take your shot.']);
    fire(s, alice, bob, 9, 9);
    expect(view(s).lastShot?.dice).toBeNull();
    expect(view(s).turn).toEqual({ sideId: bob, shooterId: bob, roll: null, canMove: false });
  });
});

describe('Battleships move or fire: moving', () => {
  it('moves one ship up to the roll in a straight line, in secret, for no points, and the turn goes on', () => {
    const { s, set, alice, bob } = duel(3);
    expect(errorsOf(move(s, bob, 's3', shift('right', 1)))).toEqual(['It is not your turn.']);
    expect(errorsOf(move(s, alice, 's3', shift('right', 4)))).toEqual(['You rolled a 3. Move up to 3 squares.']);
    expect(errorsOf(move(s, alice, 's9', shift('right', 1)))).toEqual(['No such ship.']);
    expect(errorsOf(move(s, alice, 's0', shift('left', 1)))).toEqual(['That is off the board.']);
    expect(errorsOf(move(s, alice, 's2', shift('up', 1)))).toEqual(['Another ship is already there.']);
    const before = view(s, bob).targets[0];
    set(rollOf(5));
    const effects = move(s, alice, 's3', shift('right', 3));
    expect(errorsOf(effects)).toEqual([]);
    expect(chatTexts(effects)).toEqual(['Alice moved a ship.']);
    expect(view(s, alice).myBoard?.ships[3]).toMatchObject({ id: 's3', x: 7, y: 6, horizontal: true });
    expect(view(s, bob).targets[0]).toEqual(before);
    expect(score(s, alice)).toBe(0);
    expect(view(s)).toMatchObject({
      turn: { sideId: bob, shooterId: bob, roll: 5, canMove: true },
      lastAction: { kind: 'move', playerId: alice, sideId: alice, dice: 3 },
      lastShot: null,
      log: [],
      turnNumber: 2,
    });
    expect(view(s).sides[0].movedLastTurn).toBe(true);
    expect(data(s).sides[0].lastShooterId).toBe(alice);
  });

  it('moves 1 to N squares in each of the four directions', () => {
    const { s, set, alice, bob } = duel(4);
    const miss = misser();
    const path: Array<[ShipMove, number, number, number]> = [
      [shift('left', 4), 4, 0, 6],
      [shift('down', 1), 2, 0, 7],
      [shift('right', 6), 6, 6, 7],
      [shift('up', 3), 3, 6, 4],
    ];
    path.forEach(([m, face, x, y], i) => {
      // A move takes Alice's turn and she fires on her next one, as she must.
      if (i > 0) {
        miss(s, bob, alice);
        miss(s, alice, bob);
        set(rollOf(face));
        miss(s, bob, alice);
      }
      expect(view(s).turn).toMatchObject({ shooterId: alice, roll: face, canMove: true });
      expect(errorsOf(move(s, alice, 's3', m))).toEqual([]);
      expect(view(s, alice).myBoard?.ships[3]).toMatchObject({ x, y, horizontal: true });
    });
    expect(view(s, alice).myBoard?.shots).toEqual(Object.fromEntries([0, 2, 3, 5, 6, 8].map((x) => [cellKey(x, 9), 'miss'])));
  });

  it('turns a ship a quarter about its centre square whatever the roll, and back', () => {
    const { s, set, alice, bob } = duel(1);
    const miss = misser();
    set(rollOf(1));
    expect(errorsOf(move(s, alice, 's3', { kind: 'rotate' }))).toEqual([]);
    // E7-F7 turns about E7: E7-E8.
    expect(view(s, alice).myBoard?.ships[3]).toMatchObject({ x: 4, y: 6, horizontal: false });
    miss(s, bob, alice);
    miss(s, alice, bob);
    miss(s, bob, alice);
    expect(errorsOf(move(s, alice, 's3', { kind: 'rotate' }))).toEqual([]);
    expect(view(s, alice).myBoard?.ships[3]).toMatchObject({ x: 4, y: 6, horizontal: true });
    // A ship along the top edge cannot turn about its second square off the board.
    miss(s, bob, alice);
    miss(s, alice, bob);
    miss(s, bob, alice);
    expect(errorsOf(move(s, alice, 's0', { kind: 'rotate' }))).toEqual(['That is off the board.']);
  });

  it('carries a ship\'s damage with it; old marks stay put and a hit on a moved damaged segment takes no new damage', () => {
    const { s, set, alice, bob } = duel(1);
    const miss = misser();
    miss(s, alice, bob);
    set(rollOf(6));
    expect(chatTexts(fire(s, bob, alice, 1, 0))).toEqual(['Bob fires at Alice B1: hit!']);
    // Alice's s0 (A1-D1) took a hit on its second segment; it sails off to F1-I1, away from the shot square.
    expect(errorsOf(move(s, alice, 's0', shift('right', 1)))).toEqual(['Ships cannot stop on a square that was already shot.']);
    expect(errorsOf(move(s, alice, 's0', shift('right', 5)))).toEqual([]);
    expect(view(s, alice).myBoard?.ships[0]).toMatchObject({ x: 5, y: 0, damage: [false, true, false, false], hits: 1, sunk: false });
    expect(view(s, alice).myBoard?.shots).toEqual({ '1,0': 'hit' });
    expect(view(s, bob).targets[0].shots).toEqual({ '1,0': 'hit' });
    // G1 is the damaged segment, now on an unshot square: a hit, no new damage.
    expect(chatTexts(fire(s, bob, alice, 6, 0))).toEqual(['Bob fires at Alice G1: hit!']);
    expect(shipsOf(s, alice)[0].damage).toEqual([false, true, false, false]);
    for (const x of [5, 7]) {
      miss(s, alice, bob);
      fire(s, bob, alice, x, 0);
    }
    miss(s, alice, bob);
    expect(chatTexts(fire(s, bob, alice, 8, 0))).toEqual(['Bob fires at Alice I1: sunk a 4-ship!']);
    expect(view(s, bob).targets[0].shots).toEqual({ '1,0': 'hit', '5,0': 'sunk', '6,0': 'sunk', '7,0': 'sunk', '8,0': 'sunk' });
    expect(score(s, bob)).toBe(5 * BATTLESHIPS_POINTS.hit + BATTLESHIPS_POINTS.sink);
  });

  it('never stops a ship on a shot square, a miss included, but lets it pass over one', () => {
    const { s, set, alice, bob } = duel(1);
    const miss = misser();
    miss(s, alice, bob);
    set(rollOf(3));
    fire(s, bob, alice, 6, 6);
    expect(errorsOf(move(s, alice, 's3', shift('right', 1)))).toEqual(['Ships cannot stop on a square that was already shot.']);
    expect(errorsOf(move(s, alice, 's3', shift('right', 2)))).toEqual(['Ships cannot stop on a square that was already shot.']);
    expect(errorsOf(move(s, alice, 's3', shift('right', 3)))).toEqual([]);
    expect(view(s, alice).myBoard?.ships[3]).toMatchObject({ x: 7, y: 6 });
    expect(view(s, alice).myBoard?.shots).toEqual({ '6,6': 'miss' });
  });

  it('refuses a second move in a row for the same side, which everyone can see, and allows it again after a shot', () => {
    const { s, set, alice, bob } = duel(2);
    const miss = misser();
    set(rollOf(2));
    move(s, alice, 's3', shift('down', 2));
    // Bob may still move: the rule is per side.
    expect(view(s).turn).toMatchObject({ shooterId: bob, canMove: true });
    expect(errorsOf(move(s, bob, 's3', shift('up', 1)))).toEqual([]);
    expect(view(s, bob).turn).toMatchObject({ shooterId: alice, canMove: false });
    expect(view(s).sides.map((x) => x.movedLastTurn)).toEqual([true, true]);
    expect(errorsOf(move(s, alice, 's3', shift('up', 1)))).toEqual(['You moved last turn. Fire this time.']);
    expect(errorsOf(s.game(alice, { t: 'plan', plan: { shipId: 's3', move: null } }))).toEqual(['You moved last turn. Fire this time.']);
    miss(s, alice, bob);
    expect(view(s).sides[0].movedLastTurn).toBe(false);
    expect(errorsOf(move(s, bob, 's3', shift('up', 1)))).toEqual(['You moved last turn. Fire this time.']);
    miss(s, bob, alice);
    expect(view(s).turn).toMatchObject({ shooterId: alice, canMove: true });
    expect(errorsOf(move(s, alice, 's3', shift('up', 1)))).toEqual([]);
  });

  it('fires a random shot for a shooter whose clock runs out mid-plan; the plan goes with the turn', () => {
    const { s, set, alice, bob } = duel(2);
    expect(errorsOf(s.game(alice, { t: 'plan', plan: { shipId: 's3', move: shift('right', 2) } }))).toEqual([]);
    expect(view(s, alice).myBoard?.plan).toEqual({ shipId: 's3', move: shift('right', 2) });
    expect(view(s, bob).myBoard?.plan).toBeNull();
    set(0);
    s.now += TURN_MS;
    const effects = s.tick();
    // rng 0: the first opponent and its first open cell, A1.
    expect(chatTexts(effects)).toEqual(['Alice ran out of time. A shot is fired for them.', 'Alice fires at Bob A1: hit!']);
    expect(view(s).lastAction).toMatchObject({ kind: 'fire', shot: { shooterId: alice, x: 0, y: 0, auto: true, dice: 2 } });
    expect(view(s, alice).myBoard?.ships[3]).toMatchObject({ x: 4, y: 6 });
    expect(view(s, alice).myBoard?.plan).toBeNull();
    expect(view(s).sides[0].movedLastTurn).toBe(false);
    expect(view(s).turn).toMatchObject({ shooterId: bob, roll: 1 });
  });

  it('checks a plan for the ship, the roll and the board edge only: the ghost may pass over squares it cannot stop on', () => {
    const { s, alice, bob } = duel(2);
    expect(errorsOf(s.game(bob, { t: 'plan', plan: null }))).toEqual(['It is not your turn.']);
    expect(errorsOf(s.game(alice, { t: 'plan', plan: { shipId: 's9', move: null } }))).toEqual(['No such ship.']);
    expect(errorsOf(s.game(alice, { t: 'plan', plan: { shipId: 's3', move: shift('up', 3) } }))).toEqual(['You rolled a 2.']);
    expect(errorsOf(s.game(alice, { t: 'plan', plan: { shipId: 's0', move: shift('up', 1) } }))).toEqual(['That is off the board.']);
    // s1 down 1 would end on s2: fine for a ghost on its way, refused as a move.
    expect(errorsOf(s.game(alice, { t: 'plan', plan: { shipId: 's1', move: shift('down', 1) } }))).toEqual([]);
    expect(errorsOf(move(s, alice, 's1', shift('down', 1)))).toEqual(['Another ship is already there.']);
    expect(errorsOf(s.game(alice, { t: 'plan', plan: null }))).toEqual([]);
    expect(view(s, alice).myBoard?.plan).toBeNull();
  });
});

describe('Battleships move or fire: secrecy', () => {
  /** Alice, Bob and Carol with a roll of 3; `act` is Alice's move. */
  function after(act: (s: Sim, alice: string) => void): { s: Sim; ids: string[]; chat: string[] } {
    const { s, ids } = duel(3, ['Alice', 'Bob', 'Carol']);
    const before = s.effects.length;
    act(s, ids[0]);
    return { s, ids, chat: chatTexts(s.effects.slice(before)) };
  }

  it('shows nobody outside the mover\'s side which ship moved, or where, or that it moved at all beyond the line', () => {
    const shifted = after((s, alice) => move(s, alice, 's3', shift('right', 3)));
    const turned = after((s, alice) => move(s, alice, 's0', shift('down', 3)));
    expect(shifted.chat).toEqual(['Alice moved a ship.']);
    expect(turned.chat).toEqual(shifted.chat);
    const [alice, bob, carol] = shifted.ids;
    for (const viewer of [bob, carol, null]) expect(view(shifted.s, viewer)).toEqual(view(turned.s, viewer));
    expect(view(shifted.s, alice)).not.toEqual(view(turned.s, alice));
    // Against the moment before the move, nobody else's grids changed at all.
    const untouched = duel(3, ['Alice', 'Bob', 'Carol']).s;
    for (const viewer of [bob, carol, null]) expect(view(shifted.s, viewer).targets).toEqual(view(untouched, viewer).targets);
  });

  it('lets the side\'s own members only see a plan', () => {
    const { s, set } = steerable();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { mode: 'teams', moveOrFire: true });
    set(rollOf(4));
    placeAll(s, [alice, bob]);
    const plan = { shipId: 's0', move: shift('down', 4) };
    s.game(alice, { t: 'plan', plan });
    expect(view(s, alice).myBoard?.plan).toEqual(plan);
    expect(view(s, carol).myBoard?.plan).toEqual(plan);
    expect(view(s, bob).myBoard?.plan).toBeNull();
    expect(view(s, null).myBoard).toBeNull();
    expect(JSON.stringify(view(s, bob))).not.toContain('"plan":{');
    expect(JSON.stringify(view(s, null))).not.toContain('"plan"');
  });

  it('sends a plan step to the mover\'s side only: the others get no snapshot that gives the move away', () => {
    const { s, set } = steerable();
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { mode: 'teams', moveOrFire: true });
    set(rollOf(4));
    placeAll(s, [alice, bob]);
    for (const plan of [{ shipId: 's0', move: null }, { shipId: 's0', move: shift('down', 2) }, null]) {
      const sent = roomSentTo(s.game(alice, { t: 'plan', plan }));
      expect([...sent].sort()).toEqual([alice, carol].sort());
      expect(sent).not.toContain(bob);
      expect(sent).not.toContain(dave);
    }
  });
});

describe('Battleships move or fire: one roll a turn', () => {
  it('keeps the roll when the shooter drops and comes back: a reload never re-rolls', () => {
    const { s, set, alice, bob } = duel(1);
    expect(view(s).turn).toMatchObject({ shooterId: alice, roll: 1 });
    disconnect(s, alice, 'Alice');
    expect(view(s).turn).toBeNull();
    set(rollOf(6));
    reconnect(s, alice, 'Alice');
    s.now += RESUME_SETTLE_MS;
    s.tick();
    expect(view(s).turn).toMatchObject({ shooterId: alice, roll: 1 });
    expect(view(s).turnNumber).toBe(1);
    // The roll goes with the turn once it is taken: the next turn rolls afresh.
    fire(s, alice, bob, 9, 9);
    expect(view(s).turn).toMatchObject({ shooterId: bob, roll: 6 });
  });

  it('keeps the side\'s roll when its shooter drops and a teammate takes the turn', () => {
    const { s, set } = steerable();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave'], { mode: 'teams', moveOrFire: true });
    set(rollOf(1));
    placeAll(s, [alice, bob]);
    expect(view(s).turn).toMatchObject({ sideId: 'A', shooterId: alice, roll: 1 });
    set(rollOf(6));
    disconnect(s, alice, 'Alice');
    expect(view(s).turn).toMatchObject({ sideId: 'A', shooterId: carol, roll: 1 });
  });
});

describe('Battleships move or fire: teams', () => {
  it('has the side\'s shooter roll and decide; teammates watch the plan on the shared board and cannot confirm it', () => {
    const { s, set } = steerable();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { mode: 'teams', moveOrFire: true });
    set(rollOf(6));
    placeAll(s, [alice, bob]);
    expect(view(s, carol).turn).toEqual({ sideId: 'A', shooterId: alice, roll: 6, canMove: true });
    expect(errorsOf(move(s, carol, 's0', shift('down', 6)))).toEqual(['It is not your turn.']);
    expect(errorsOf(s.game(carol, { t: 'plan', plan: { shipId: 's0', move: null } }))).toEqual(['It is not your turn.']);
    s.game(alice, { t: 'plan', plan: { shipId: 's0', move: null } });
    expect(view(s, carol).myBoard?.plan).toEqual({ shipId: 's0', move: null });
    s.game(alice, { t: 'plan', plan: { shipId: 's0', move: shift('down', 6) } });
    expect(view(s, carol).myBoard?.plan).toEqual({ shipId: 's0', move: shift('down', 6) });
    const theirs = view(s, bob).targets[0];
    set(rollOf(2));
    expect(chatTexts(move(s, alice, 's0', shift('down', 6)))).toEqual(['Alice moved a ship.']);
    expect(view(s, carol).myBoard?.ships[0]).toMatchObject({ x: 0, y: 6 });
    expect(view(s, carol).myBoard?.plan).toBeNull();
    expect(view(s, bob).targets[0]).toEqual(theirs);
    // Bob's turn for Team B; then Carol is up for Team A, which may not move again.
    expect(view(s).turn).toMatchObject({ sideId: 'B', shooterId: bob, roll: 2, canMove: true });
    fire(s, bob, 'A', 11, 11);
    expect(view(s, carol).turn).toMatchObject({ sideId: 'A', shooterId: carol, canMove: false });
    expect(errorsOf(move(s, carol, 's0', shift('up', 1)))).toEqual(['You moved last turn. Fire this time.']);
  });
});

describe('Battleships move or fire: a long game', () => {
  /** A small seeded generator, so the game is the same on every run. */
  function lcg(seed: number): () => number {
    let x = seed;
    return () => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x / 2147483648;
    };
  }

  it('keeps every afloat ship sinkable through random moves and shots, and always ends', () => {
    for (const seed of [1, 7, 42]) {
      const rng = lcg(seed);
      const s = sim('battleships', 'ABCD', START, rng);
      const ids = startGame(s, ['Alice', 'Bob', 'Carol'], { moveOrFire: true });
      for (const id of ids) s.game(id, { t: 'autoPlace' });
      for (const id of ids) s.game(id, { t: 'placeReady' });
      let moves = 0;
      for (let i = 0; i < 2000 && view(s).phase === 'playing'; i++) {
        const turn = view(s).turn;
        if (!turn) throw new Error('no turn');
        const mine = view(s, turn.shooterId).myBoard;
        if (!mine) throw new Error('no board');
        const side = data(s).sides.find((x) => x.id === turn.sideId);
        let moved = false;
        if (turn.canMove && turn.roll !== null && side && rng() < 0.5) {
          const afloat = side.ships.filter((ship) => !isSunk(ship));
          const ship = afloat[Math.floor(rng() * afloat.length)];
          const options = shipOptions(side.ships, ship.id, data(s).size, side.shots, turn.roll);
          const choices: ShipMove[] = BATTLESHIPS_DIRECTIONS.flatMap((d) => options.steps[d].map((n) => shift(d, n)));
          if (options.rotate) choices.push({ kind: 'rotate' });
          if (choices.length > 0) {
            expect(errorsOf(move(s, turn.shooterId, ship.id, choices[Math.floor(rng() * choices.length)]))).toEqual([]);
            moved = true;
            moves++;
          }
        }
        if (!moved) {
          s.now += TURN_MS;
          s.tick();
        }
        for (const x of data(s).sides.filter((d) => d.alive)) {
          for (const ship of x.ships.filter((sh) => !isSunk(sh))) {
            // An undamaged segment on an unshot square: the ship can still be found and sunk.
            const open = shipCells(ship).filter((c) => !x.shots[cellKey(c.x, c.y)] && !ship.damage[segmentAt(ship, c.x, c.y)]);
            expect(open.length).toBeGreaterThan(0);
          }
        }
      }
      expect(view(s).phase).toBe('gameOver');
      expect(moves).toBeGreaterThan(10);
    }
  });
});
