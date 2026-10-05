/** Skribble's rules through a memory Room: turns, guessing, hints, the canvas, ratings and the drawer's grace periods. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHOOSE_TIME_SECONDS,
  DRAWER_DISCONNECT_GRACE_MS,
  MAX_ACTIONS_PER_TURN,
  MAX_CANVAS_RESYNC_BYTES,
  MAX_POINTS_PER_STROKE,
  MAX_POINTS_PER_TURN,
  TURN_END_SECONDS,
} from '../../../shared/games/skribble/constants.js';
import { hintRevealOrder, hintSchedule, maskWord } from '../../../shared/games/skribble/hints.js';
import type { DrawOp } from '../../../shared/games/skribble/protocol.js';
import { drawerPoints, guesserPoints } from '../../../shared/games/skribble/scoring.js';
import { LOW_PLAYERS_GRACE_MS, RECONNECT_GRACE_MS } from '../../../shared/platform/constants.js';
import { AVATAR, TEST_WORDS, createHarness, drawerOf, expectPhase, phaseOf, pick, skribbleView, startGame, type Harness } from '../../platform/drivers/testUtils.js';

const START = new Date('2026-01-01T12:00:00Z').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Skribble: turn lifecycle', () => {
  it('runs choosing -> drawing -> turnEnd -> next turn -> game over with a tie-aware podium', () => {
    const h = createHarness();
    const [alice, bob, carol] = startGame(h, ['Alice', 'Bob', 'Carol']);
    const state = skribbleView(h.room);
    expect(state).toMatchObject({ round: 1, totalRounds: 1, turn: 1, turnsInRound: 3 });
    expect(h.room.getState(null).settings).toMatchObject({ rounds: 1, drawTime: 60, maxPlayers: 12 });

    // Turn 1: Alice draws (joinOrder 0), only Bob guesses.
    let choosing = expectPhase(h.room, 'choosing', alice);
    expect(choosing.drawerId).toBe(alice);
    expect(choosing.endsAt).toBe(START + CHOOSE_TIME_SECONDS * 1000);
    expect(choosing.choices).toEqual(['apple', 'banana', 'cherry']);
    expect(expectPhase(h.room, 'choosing', bob).choices).toBeUndefined();

    h.send(alice, { t: 'chooseWord', index: 0 });
    const drawing = expectPhase(h.room, 'drawing', bob);
    expect(drawing).toMatchObject({ drawerId: alice, startedAt: START, endsAt: START + 60_000, mask: '_____', likes: 0, dislikes: 0 });
    expect(drawing.word).toBeUndefined();
    expect(expectPhase(h.room, 'drawing', alice).word).toBe('apple');

    vi.advanceTimersByTime(10_000);
    h.send(bob, { t: 'chat', text: 'Apple' });
    const guessPts = guesserPoints(50_000, 60_000);
    expect(h.score(bob)).toBe(guessPts);
    expect(h.turnState(bob).guessedThisTurn).toBe(true);
    expect(phaseOf(h.room).kind).toBe('drawing');
    // Carol guesses at the same instant: everyone guessed, so the turn ends early.
    h.send(carol, { t: 'chat', text: 'apple' });
    expect(h.score(carol)).toBe(guessPts);

    const turnEnd = expectPhase(h.room, 'turnEnd');
    expect(turnEnd.reason).toBe('allGuessed');
    expect(turnEnd.word).toBe('apple');
    expect(turnEnd.drawerId).toBe(alice);
    expect(turnEnd.endsAt).toBe(Date.now() + TURN_END_SECONDS * 1000);
    const alicePts = drawerPoints(2, 2);
    expect(alicePts).toBe(300);
    expect(turnEnd.points).toEqual({ [alice]: alicePts, [bob]: guessPts, [carol]: guessPts });
    expect(h.transport.chats(carol).at(-1)).toEqual({ kind: 'hint', text: 'The word was: apple' });
    // The drawing timer was cancelled with the early end.
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000 - 1);
    expect(phaseOf(h.room).kind).toBe('turnEnd');

    // Turn 2: Bob draws; nobody guesses and time runs out.
    vi.advanceTimersByTime(1);
    choosing = expectPhase(h.room, 'choosing', bob);
    expect(choosing.drawerId).toBe(bob);
    expect(skribbleView(h.room).turn).toBe(2);
    // The used word is excluded from the next choices.
    expect(choosing.choices).toEqual(['banana', 'cherry', 'dragon']);
    expect(Object.values(skribbleView(h.room).players).every((p) => p.turnPoints === 0)).toBe(true);
    h.send(bob, { t: 'chooseWord', index: 1 });
    vi.advanceTimersByTime(59_999);
    expect(phaseOf(h.room).kind).toBe('drawing');
    vi.advanceTimersByTime(1);
    const second = expectPhase(h.room, 'turnEnd');
    expect(second.reason).toBe('timeUp');
    expect(second.word).toBe('cherry');
    expect(second.points).toEqual({});

    // Turn 3: Carol draws; nobody guesses.
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000);
    expect(drawerOf(h.room, [alice, bob, carol])).toBe(carol);
    expect(skribbleView(h.room).turn).toBe(3);
    h.send(carol, { t: 'chooseWord', index: 0 });
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);

    expect(h.room.phase).toBe('ended');
    expect(phaseOf(h.room).kind).toBe('gameOver');
    expect(h.score(alice)).toBe(alicePts);
    expect(h.score(bob)).toBe(guessPts);
    expect(h.score(carol)).toBe(guessPts);
    // Bob and Carol tie for first (ordered by join order); Alice is third, not second.
    expect(h.room.state.podium).toEqual([
      { playerId: bob, score: guessPts, rank: 1 },
      { playerId: carol, score: guessPts, rank: 1 },
      { playerId: alice, score: alicePts, rank: 3 },
    ]);
    expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'system', text: `Game over! Bob and Carol tie with ${guessPts} points.` });

    // The podium persists until the host returns to the lobby.
    vi.advanceTimersByTime(600_000);
    expect(h.room.phase).toBe('ended');
    h.send(alice, { t: 'returnToLobby' });
    const lobby = h.room.getState(null);
    expect(lobby).toMatchObject({ phase: 'lobby', game: null, podium: null });
    expect(lobby.players.every((p) => p.score === 0)).toBe(true);
  });

  it('announces a single winner', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    const { word } = pick(h, players);
    h.send(bob, { t: 'chat', text: word });
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000);
    pick(h, players);
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    expect(h.room.phase).toBe('ended');
    expect(h.score(bob)).toBeGreaterThan(h.score(alice));
    expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'system', text: `Game over! Bob wins with ${h.score(bob)} points.` });
  });

  it('ends the turn as soon as every connected non-drawer has guessed', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [, bob, carol] = players;
    const { drawer, word } = pick(h, players);
    h.send(bob, { t: 'chat', text: word });
    expect(phaseOf(h.room).kind).toBe('drawing');
    h.send(carol, { t: 'chat', text: word.toUpperCase() });
    const end = expectPhase(h.room, 'turnEnd');
    expect(end.reason).toBe('allGuessed');
    expect(end.points[drawer]).toBe(drawerPoints(2, 2));
  });

  it('auto-picks the first choice when the drawer does not choose in time', () => {
    const h = createHarness();
    const [alice] = startGame(h, ['Alice', 'Bob']);
    vi.advanceTimersByTime(CHOOSE_TIME_SECONDS * 1000 - 1);
    expect(phaseOf(h.room).kind).toBe('choosing');
    vi.advanceTimersByTime(1);
    const drawing = expectPhase(h.room, 'drawing', alice);
    expect(drawing.word).toBe('apple');
    expect(drawing.startedAt).toBe(START + CHOOSE_TIME_SECONDS * 1000);
  });

  it('rejects chooseWord from non-drawers, out of range and outside choosing', () => {
    const h = createHarness();
    const [alice, bob] = startGame(h, ['Alice', 'Bob']);
    h.send(bob, { t: 'chooseWord', index: 0 });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
    h.send(alice, { t: 'chooseWord', index: 7 });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
    expect(phaseOf(h.room).kind).toBe('choosing');
    h.send(alice, { t: 'chooseWord', index: 2 });
    expect(phaseOf(h.room).kind).toBe('drawing');
    h.send(alice, { t: 'chooseWord', index: 0 });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
  });

  it('appends mid-game joiners to the current round', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    expect(skribbleView(h.room).turnsInRound).toBe(2);
    const carol = h.join('Carol');
    expect(skribbleView(h.room).turnsInRound).toBe(3);
    expect(h.transport.last(carol, 'welcome').room.game?.phase.kind).toBe('choosing');
    expect(h.transport.last(carol, 'welcome').room.game?.turnsInRound).toBe(3);

    // Carol draws last this round.
    pick(h, [...players, carol]);
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    pick(h, [...players, carol]);
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    expect(drawerOf(h.room, [...players, carol])).toBe(carol);
    expect(skribbleView(h.room).turn).toBe(3);
  });

  it('skips drawers who are disconnected when their turn begins and rebuilds the queue each round', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol'], { rounds: 2 });
    const [alice, bob, carol] = players;
    pick(h, players);
    vi.advanceTimersByTime(10_000);
    h.room.handleDisconnect(bob);
    vi.advanceTimersByTime(50_000 + TURN_END_SECONDS * 1000);
    // Bob (still within his reconnect grace) is skipped; Carol draws turn 2 of 2 in round 1.
    expect(drawerOf(h.room, players)).toBe(carol);
    expect(skribbleView(h.room)).toMatchObject({ round: 1, turn: 2, turnsInRound: 2 });

    expect(h.room.rejoin(h.token(bob), 'conn-Bob-2').ok).toBe(true);
    pick(h, players);
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    // Round 2 includes everyone again in join order.
    expect(skribbleView(h.room)).toMatchObject({ round: 2, turn: 1, turnsInRound: 3 });
    expect(drawerOf(h.room, players)).toBe(alice);
    pick(h, players);
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    expect(drawerOf(h.room, players)).toBe(bob);
  });

  it('clears the canvas for everyone at the start of each turn', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    for (const p of players) expect(h.transport.ofType(p, 'clear')).toHaveLength(1);
    const { drawer } = pick(h, players);
    h.send(drawer, { t: 'draw', ops: [{ k: 'start', id: 1, tool: 'brush', color: '#000000', size: 6, x: 1, y: 1 }] });
    expect(h.canvas()).toHaveLength(1);
    h.transport.clear();
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    expect(phaseOf(h.room).kind).toBe('choosing');
    expect(h.canvas()).toHaveLength(0);
    for (const p of players) expect(h.transport.ofType(p, 'clear')).toHaveLength(1);
  });
});

describe('Skribble: guessing and chat', () => {
  it('scores a correct guess, hides the guess text and reveals the word to the guesser', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    const { word } = pick(h, players);
    h.transport.clear();
    vi.advanceTimersByTime(15_000);
    h.send(bob, { t: 'chat', text: `  ${word} ` });

    const expected = guesserPoints(45_000, 60_000);
    expect(h.score(bob)).toBe(expected);
    expect(h.turnState(bob).turnPoints).toBe(expected);
    for (const p of players) {
      expect(h.transport.chats(p)).toEqual([{ kind: 'correct', text: 'Bob guessed the word!' }]);
      expect(JSON.stringify(h.transport.of(p))).not.toContain(`"text":"  ${word} "`);
    }
    const correct = h.transport.last(carol, 'chat').message;
    expect(correct.playerId).toBe(bob);
    expect(correct.name).toBe('Bob');

    expect(expectPhase(h.room, 'drawing', bob).word).toBe(word);
    expect(expectPhase(h.room, 'drawing', carol).word).toBeUndefined();
    expect(h.transport.last(bob, 'room').room.game?.phase).toMatchObject({ kind: 'drawing', word });
    expect(h.transport.last(carol, 'room').room.game?.phase).not.toHaveProperty('word');
    const aliceView = h.transport.last(alice, 'room').room;
    expect(aliceView.players.find((p) => p.id === bob)?.score).toBe(expected);
    expect(aliceView.game?.players[bob]).toEqual({ guessedThisTurn: true, turnPoints: expected });
  });

  it('flags close guesses privately while still broadcasting the chat line first', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    pick(h, players); // apple
    h.transport.clear();
    h.send(bob, { t: 'chat', text: 'aple' });
    expect(h.transport.chats(bob)).toEqual([
      { kind: 'chat', text: 'aple' },
      { kind: 'close', text: "'aple' is close!" },
    ]);
    expect(h.transport.chats(alice)).toEqual([{ kind: 'chat', text: 'aple' }]);
    expect(h.transport.chats(carol)).toEqual([{ kind: 'chat', text: 'aple' }]);
    expect(h.score(bob)).toBe(0);

    h.transport.clear();
    h.send(bob, { t: 'chat', text: 'house' });
    for (const p of players) expect(h.transport.chats(p)).toEqual([{ kind: 'chat', text: 'house' }]);
  });

  it("blocks the drawer from leaking the word and routes the drawer's chat to guessers only", () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    const { word } = pick(h, players);
    h.transport.clear();

    h.send(alice, { t: 'chat', text: `it is an ${word}!` });
    expect(h.transport.chats(alice)).toEqual([{ kind: 'system', text: "You can't give away the word!" }]);
    expect(h.transport.chats(bob)).toEqual([]);
    expect(h.transport.chats(carol)).toEqual([]);

    h.send(alice, { t: 'chat', text: 'hurry up' });
    expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'guessed', text: 'hurry up' });
    expect(h.transport.chats(bob)).toEqual([]);

    h.send(bob, { t: 'chat', text: word });
    h.transport.clear();
    h.send(alice, { t: 'chat', text: 'nice one' });
    expect(h.transport.chats(bob)).toEqual([{ kind: 'guessed', text: 'nice one' }]);
    expect(h.transport.chats(carol)).toEqual([]);
  });

  it("delivers guessed players' chat only to the drawer and other guessers", () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol', 'Dave']);
    const [alice, bob, carol, dave] = players;
    const { word } = pick(h, players);
    h.send(bob, { t: 'chat', text: word });
    h.send(carol, { t: 'chat', text: word });
    h.transport.clear();

    h.send(bob, { t: 'chat', text: `the ${word} is easy` });
    expect(h.transport.chats(alice)).toEqual([{ kind: 'guessed', text: `the ${word} is easy` }]);
    expect(h.transport.chats(carol)).toEqual([{ kind: 'guessed', text: `the ${word} is easy` }]);
    expect(h.transport.chats(bob)).toEqual([{ kind: 'guessed', text: `the ${word} is easy` }]);
    expect(h.transport.chats(dave)).toEqual([]);
    // Guessing again never scores twice.
    h.send(bob, { t: 'chat', text: word });
    expect(h.score(bob)).toBe(guesserPoints(60_000, 60_000));
    // 'guessed' messages are not part of the public history late joiners receive.
    const eve = h.join('Eve');
    expect(h.transport.last(eve, 'welcome').chat.every((c) => c.kind !== 'guessed' && c.kind !== 'close')).toBe(true);
  });

  it('scores the drawer against everyone who guessed during the turn, even if they dropped or left since', () => {
    // (a) Bob guesses, then his socket drops; Carol never guesses: 1 of 2, not 1 of 1.
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob] = players;
    const { word } = pick(h, players);
    h.send(bob, { t: 'chat', text: word });
    h.room.handleDisconnect(bob);
    vi.advanceTimersByTime(60_000);
    expect(expectPhase(h.room, 'turnEnd').reason).toBe('timeUp');
    expect(h.turnState(alice).turnPoints).toBe(drawerPoints(1, 2));
    expect(h.turnState(alice).turnPoints).toBe(150);

    // (b) Bob guesses, then leaves the room: his correct guess still counts for the drawer.
    const g = createHarness();
    const ps = startGame(g, ['Alice', 'Bob', 'Carol']);
    const [a2, b2] = ps;
    const second = pick(g, ps);
    g.send(b2, { t: 'chat', text: second.word });
    g.room.leave(b2);
    vi.advanceTimersByTime(60_000);
    expect(expectPhase(g.room, 'turnEnd').reason).toBe('timeUp');
    expect(g.score(a2)).toBe(drawerPoints(1, 2));
    expect(expectPhase(g.room, 'turnEnd').points).toEqual({ [a2]: 150 });

    // A player disconnected for the whole turn is not a guesser; one who joins mid-turn is.
    const k = createHarness();
    const qs = startGame(k, ['Alice', 'Bob', 'Carol']);
    const [a3, b3, c3] = qs;
    k.room.handleDisconnect(c3);
    const third = pick(k, qs);
    const dave = k.join('Dave');
    k.send(b3, { t: 'chat', text: third.word });
    expect(phaseOf(k.room).kind).toBe('drawing');
    vi.advanceTimersByTime(60_000);
    // Guessers: Bob and Dave (Carol was away the whole turn) -> 1 of 2.
    expect(k.turnState(a3).turnPoints).toBe(drawerPoints(1, 2));
    expect(k.turnState(dave).turnPoints).toBe(0);
  });

  it('never lets the drawer leak a word choice while choosing', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    const choosing = expectPhase(h.room, 'choosing', alice);
    expect(choosing.choices).toEqual(['apple', 'banana', 'cherry']);
    h.transport.clear();

    for (const leak of ['I will draw apple', 'BANANA it is', 'c-h-e-r-r-y']) {
      h.send(alice, { t: 'chat', text: leak });
      expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'system', text: "You can't give away the word!" });
    }
    expect(h.transport.chats(bob)).toEqual([]);
    expect(h.transport.chats(carol)).toEqual([]);

    // Innocent drawer chat is not public either (it would be trivial to hint at the choices).
    h.send(alice, { t: 'chat', text: 'give me a second' });
    expect(h.transport.chats(bob)).toEqual([]);
    expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'guessed', text: 'give me a second' });
    // Guessers keep chatting openly while the drawer picks.
    h.send(bob, { t: 'chat', text: 'hurry up' });
    expect(h.transport.chats(carol)).toEqual([{ kind: 'chat', text: 'hurry up' }]);
    expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'chat', text: 'hurry up' });

    // Nothing in the public history can tip off a late joiner either.
    const dave = h.join('Dave');
    expect(h.transport.last(dave, 'welcome').chat.some((c) => /apple|banana|cherry|second/.test(c.text))).toBe(false);
    h.send(alice, { t: 'chooseWord', index: 0 });
    h.send(bob, { t: 'chat', text: 'apple' });
    expect(h.score(bob)).toBe(guesserPoints(60_000, 60_000));
  });
});

describe('Skribble: hints', () => {
  it('reveals letters on schedule, updating the mask and sending snapshots', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob'], { hints: 2 });
    const [, bob] = players;
    const { word } = pick(h, players); // apple
    const order = hintRevealOrder(word, 2, () => 0);
    const schedule = hintSchedule(60_000, 2);
    expect(schedule).toEqual([20_000, 40_000]);

    h.transport.clear();
    vi.advanceTimersByTime(schedule[0] - 1);
    expect(h.transport.ofType(bob, 'room')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(h.transport.ofType(bob, 'room')).toHaveLength(1);
    expect(expectPhase(h.room, 'drawing', bob).mask).toBe(maskWord(word, [order[0]]));
    vi.advanceTimersByTime(schedule[1] - schedule[0]);
    const mask = expectPhase(h.room, 'drawing', bob).mask;
    expect(mask).toBe(maskWord(word, order));
    expect(mask.replace(/_/g, '')).toHaveLength(2);
    expect(h.transport.ofType(bob, 'room')).toHaveLength(2);
  });

  it('never reveals more than half the letters', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob'], { hints: 5, customWords: ['ab', ...TEST_WORDS] });
    const [, bob] = players;
    const { word } = pick(h, players);
    expect(word).toBe('ab');
    vi.advanceTimersByTime(59_999);
    expect(expectPhase(h.room, 'drawing', bob).mask).toBe('_b');
  });
});

describe('Skribble: canvas', () => {
  const start = (id: number): DrawOp => ({ k: 'start', id, tool: 'brush', color: '#ff0000', size: 6, x: 10, y: 20 });

  /** Adds `count` flat coordinates to a stroke in protocol-sized batches (a move carries at most 2000). */
  const fillStroke = (h: Harness, drawer: string, id: number, count: number): void => {
    for (let left = count; left > 0; left -= 2000) h.send(drawer, { t: 'draw', ops: [{ k: 'move', id, pts: new Array<number>(Math.min(2000, left)).fill(2) }] });
  };

  it('forwards draw ops to everyone but the drawer and keeps a replayable history', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    const { drawer } = pick(h, players);
    expect(drawer).toBe(alice);
    h.transport.clear();

    const ops: DrawOp[] = [start(1), { k: 'move', id: 1, pts: [11, 21, 12, 22] }, { k: 'move', id: 99, pts: [0, 0] }, { k: 'end', id: 1 }, { k: 'end', id: 99 }, { k: 'fill', x: 5, y: 5, color: '#00ff00' }];
    h.send(alice, { t: 'draw', ops });
    expect(h.transport.ofType(alice, 'draw')).toHaveLength(0);
    const forwarded = h.transport.last(bob, 'draw').ops;
    expect(forwarded).toEqual([start(1), { k: 'move', id: 1, pts: [11, 21, 12, 22] }, { k: 'end', id: 1 }, { k: 'fill', x: 5, y: 5, color: '#00ff00' }]);
    expect(h.transport.last(carol, 'draw').ops).toEqual(forwarded);
    expect(h.canvas()).toEqual([
      { kind: 'stroke', id: 1, tool: 'brush', color: '#ff0000', size: 6, points: [10, 20, 11, 21, 12, 22], done: true },
      { kind: 'fill', x: 5, y: 5, color: '#00ff00' },
    ]);
    // No snapshot for draw traffic.
    expect(h.transport.ofType(bob, 'room')).toHaveLength(0);

    h.send(bob, { t: 'draw', ops: [start(2)] });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
    expect(h.canvas()).toHaveLength(2);
    // Malformed draw batches are refused without reaching the canvas.
    h.room.handleMessage(alice, { kind: 'game', msg: { t: 'draw', ops: [] } });
    expect(h.transport.errors(alice)).toEqual(['INVALID_MESSAGE']);
  });

  it('undo and clear are echoed to everyone including the drawer', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.send(alice, { t: 'draw', ops: [start(1), start(2)] });
    h.transport.clear();

    h.send(alice, { t: 'undo' });
    expect(h.canvas()).toHaveLength(1);
    expect(h.transport.ofType(alice, 'undo')).toHaveLength(1);
    expect(h.transport.ofType(bob, 'undo')).toHaveLength(1);
    // Moves for an undone stroke are ignored.
    h.send(alice, { t: 'draw', ops: [{ k: 'move', id: 2, pts: [1, 1] }] });
    expect(h.transport.ofType(bob, 'draw')).toHaveLength(0);

    h.send(alice, { t: 'clear' });
    expect(h.canvas()).toHaveLength(0);
    expect(h.transport.ofType(alice, 'clear')).toHaveLength(1);
    expect(h.transport.ofType(bob, 'clear')).toHaveLength(1);
    // Undo on an empty canvas is a no-op nobody hears about.
    h.send(alice, { t: 'undo' });
    expect(h.transport.ofType(bob, 'undo')).toHaveLength(1);

    h.send(bob, { t: 'undo' });
    h.send(bob, { t: 'clear' });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
  });

  it('enforces MAX_ACTIONS_PER_TURN and MAX_POINTS_PER_STROKE by dropping extras', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.transport.clear();

    for (let i = 0; i < MAX_ACTIONS_PER_TURN + 5; i += 100) {
      const ops: DrawOp[] = [];
      for (let j = i; j < i + 100; j++) ops.push(start(j));
      h.send(alice, { t: 'draw', ops });
    }
    expect(h.canvas()).toHaveLength(MAX_ACTIONS_PER_TURN);
    const forwardedStarts = h.transport.ofType(bob, 'draw').flatMap((m) => m.ops).filter((o) => o.k === 'start');
    expect(forwardedStarts).toHaveLength(MAX_ACTIONS_PER_TURN);
    h.send(alice, { t: 'draw', ops: [{ k: 'fill', x: 0, y: 0, color: '#000000' }] });
    expect(h.canvas()).toHaveLength(MAX_ACTIONS_PER_TURN);

    h.send(alice, { t: 'clear' });
    h.transport.clear();
    h.send(alice, { t: 'draw', ops: [start(1)] });
    const chunk = new Array<number>(2000).fill(1);
    const strokeLength = (): number => {
      const first = h.canvas()[0];
      return first.kind === 'stroke' ? first.points.length : 0;
    };
    while (strokeLength() < MAX_POINTS_PER_STROKE) h.send(alice, { t: 'draw', ops: [{ k: 'move', id: 1, pts: chunk }] });
    expect(strokeLength()).toBe(MAX_POINTS_PER_STROKE);
    h.transport.clear();
    h.send(alice, { t: 'draw', ops: [{ k: 'move', id: 1, pts: [1, 1] }] });
    expect(h.transport.ofType(bob, 'draw')).toHaveLength(0);
  });

  it('truncates a move batch that overflows the stroke cap and forwards the truncated op', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.send(alice, { t: 'draw', ops: [start(1)] });
    fillStroke(h, alice, 1, MAX_POINTS_PER_STROKE - 2 - 4);
    h.transport.clear();
    h.send(alice, { t: 'draw', ops: [{ k: 'move', id: 1, pts: [1, 2, 3, 4, 5, 6, 7, 8] }] });
    expect(h.transport.last(bob, 'draw').ops).toEqual([{ k: 'move', id: 1, pts: [1, 2, 3, 4] }]);
    const stroke = h.canvas()[0];
    expect(stroke.kind === 'stroke' && stroke.points.length).toBe(MAX_POINTS_PER_STROKE);
  });

  it('caps points across the whole canvas so a maxed-out turn still yields a small welcome', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.transport.clear();

    const chunk = new Array<number>(2000).fill(1.25);
    const totalPoints = (): number => h.canvas().reduce((n, a) => n + (a.kind === 'stroke' ? a.points.length : 0), 0);
    // Fill every stroke to its own cap until the canvas-wide cap stops us.
    let id = 0;
    while (totalPoints() < MAX_POINTS_PER_TURN && id < MAX_ACTIONS_PER_TURN) {
      h.send(alice, { t: 'draw', ops: [start(id)] });
      for (let n = 2; n < MAX_POINTS_PER_STROKE; n += chunk.length) {
        h.send(alice, { t: 'draw', ops: [{ k: 'move', id, pts: chunk }] });
      }
      id++;
    }
    expect(totalPoints()).toBe(MAX_POINTS_PER_TURN);
    expect(h.canvas().length).toBeLessThan(MAX_ACTIONS_PER_TURN);

    // Nothing more fits: new strokes and further points on any stroke are dropped and not forwarded.
    h.transport.clear();
    h.send(alice, { t: 'draw', ops: [start(id), { k: 'move', id, pts: [1, 1] }, { k: 'move', id: 0, pts: [1, 1] }] });
    expect(totalPoints()).toBe(MAX_POINTS_PER_TURN);
    expect(h.transport.ofType(bob, 'draw')).toHaveLength(0);

    // The forwarded stream equals the stored history, so every joiner gets a bounded welcome.
    const carol = h.join('Carol');
    const welcome = h.transport.last(carol, 'welcome');
    expect(h.welcomeCanvas(carol)).toEqual(h.canvas());
    expect(JSON.stringify(welcome).length).toBeLessThan(MAX_CANVAS_RESYNC_BYTES);

    // Undo returns the budget of the removed stroke; clear returns all of it.
    const history = h.canvas();
    const lastStroke = history[history.length - 1];
    const freed = lastStroke.kind === 'stroke' ? lastStroke.points.length : 0;
    h.send(alice, { t: 'undo' });
    expect(totalPoints()).toBe(MAX_POINTS_PER_TURN - freed);
    h.transport.clear();
    h.send(alice, { t: 'draw', ops: [start(id), { k: 'move', id, pts: [1, 1, 2, 2] }] });
    expect(totalPoints()).toBe(MAX_POINTS_PER_TURN - freed + 6);
    expect(h.transport.ofType(bob, 'draw')).toHaveLength(1);
    h.send(alice, { t: 'clear' });
    expect(totalPoints()).toBe(0);
    h.send(alice, { t: 'draw', ops: [start(id + 1), { k: 'move', id: id + 1, pts: chunk }] });
    expect(totalPoints()).toBe(2 + chunk.length);
  });

  it('resyncs the drawer once their ops were truncated, so their canvas matches everyone else’s', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.send(alice, { t: 'draw', ops: [start(1)] });
    fillStroke(h, alice, 1, MAX_POINTS_PER_STROKE - 2);
    h.transport.clear();
    // Accepted in full: no resync.
    vi.advanceTimersByTime(5000);
    expect(h.transport.ofType(alice, 'canvas')).toHaveLength(0);

    // Points past the cap are dropped for viewers; the drawer still has them locally.
    for (let i = 0; i < 5; i++) h.send(alice, { t: 'draw', ops: [{ k: 'move', id: 1, pts: [9, 9] }] });
    expect(h.transport.ofType(bob, 'draw')).toHaveLength(0);
    expect(h.transport.ofType(alice, 'canvas')).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    const resync = h.transport.ofType(alice, 'canvas');
    expect(resync).toHaveLength(1);
    expect(resync[0].actions).toEqual(h.canvas());
    expect(h.transport.ofType(bob, 'canvas')).toHaveLength(0);

    // 'end' for a stroke the server never had is not a truncation; a dropped 'start' is.
    h.transport.clear();
    h.send(alice, { t: 'draw', ops: [{ k: 'end', id: 77 }] });
    vi.advanceTimersByTime(1000);
    expect(h.transport.ofType(alice, 'canvas')).toHaveLength(0);
    for (let i = 2; i < MAX_ACTIONS_PER_TURN + 2; i++) h.send(alice, { t: 'draw', ops: [start(i)] });
    vi.advanceTimersByTime(1000);
    expect(h.transport.ofType(alice, 'canvas')).toHaveLength(1);
    expect(h.transport.last(alice, 'canvas').actions).toHaveLength(MAX_ACTIONS_PER_TURN);

    // A pending resync dies with the turn.
    h.transport.clear();
    h.send(alice, { t: 'draw', ops: [start(9999)] });
    h.send(bob, { t: 'chat', text: 'apple' });
    expect(phaseOf(h.room).kind).toBe('turnEnd');
    vi.advanceTimersByTime(1000);
    expect(h.transport.ofType(alice, 'canvas')).toHaveLength(0);
  });

  it("does not hand the previous group's drawing to whoever re-uses an emptied room", () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.send(alice, { t: 'draw', ops: [start(1)] });
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    h.send(bob, { t: 'chooseWord', index: 0 });
    h.send(bob, { t: 'draw', ops: [{ k: 'fill', x: 1, y: 1, color: '#000000' }] });
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    expect(h.room.phase).toBe('ended');
    expect(h.canvas()).toHaveLength(1);
    h.room.leave(alice);
    h.room.leave(bob);
    expect(h.room.isEmpty).toBe(true);
    const carol = h.join('Carol');
    expect(h.welcomeCanvas(carol)).toEqual([]);
    expect(h.transport.last(carol, 'welcome').room.phase).toBe('lobby');
  });

  it('gives late joiners and rejoiners the full history in welcome', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.send(alice, { t: 'draw', ops: [start(1), { k: 'move', id: 1, pts: [1, 2] }] });
    const carol = h.join('Carol');
    expect(h.welcomeCanvas(carol)).toEqual([{ kind: 'stroke', id: 1, tool: 'brush', color: '#ff0000', size: 6, points: [10, 20, 1, 2] }]);
    h.room.handleDisconnect(bob);
    h.send(alice, { t: 'draw', ops: [{ k: 'fill', x: 1, y: 1, color: '#000000' }] });
    h.room.rejoin(h.token(bob), 'conn-Bob-2');
    expect(h.welcomeCanvas(bob)).toHaveLength(2);
  });

  it('refuses ops stamped for a canvas the game has since reset', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    // Another instance moved the canvas on: the stored stamp no longer matches this room's canvas id.
    h.storage.reset('ABCD', null, 'elsewhere');
    h.transport.clear();
    h.send(alice, { t: 'draw', ops: [start(1)] });
    h.send(alice, { t: 'undo' });
    h.send(alice, { t: 'clear' });
    expect(h.transport.errors(alice)).toEqual([]);
    expect(h.transport.ofType(bob, 'draw')).toHaveLength(0);
    expect(h.transport.ofType(bob, 'undo')).toHaveLength(0);
    expect(h.transport.ofType(bob, 'clear')).toHaveLength(0);
    expect(h.storage.length('ABCD')).toBe(0);
  });
});

describe('Skribble: drawer and guesser grace periods', () => {
  it('ends the turn with drawerLeft after the drawer grace period unless they rejoin', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob] = players;
    const { word } = pick(h, players);
    h.send(bob, { t: 'chat', text: word });
    const bobScore = h.score(bob);

    h.room.handleDisconnect(alice);
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS - 1);
    expect(phaseOf(h.room).kind).toBe('drawing');
    h.room.rejoin(h.token(alice), 'conn-Alice-2');
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS);
    expect(phaseOf(h.room).kind).toBe('drawing');

    h.room.handleDisconnect(alice);
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS);
    const end = expectPhase(h.room, 'turnEnd');
    expect(end.reason).toBe('drawerLeft');
    expect(h.score(alice)).toBe(0);
    expect(end.points).toEqual({ [bob]: bobScore });
    expect(end.word).toBe(word);
  });

  it('ends the turn when a disconnected drawer times out of choosing', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice] = players;
    h.room.handleDisconnect(alice);
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS);
    const end = expectPhase(h.room, 'turnEnd');
    expect(end.reason).toBe('drawerLeft');
    expect(end.word).toBe('');
    expect(h.transport.chats(players[1]).some((c) => c.kind === 'hint')).toBe(false);
  });

  it('keeps the game running when the missing player rejoins within the grace and can still guess', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [, bob] = players;
    const { word } = pick(h, players);
    h.room.handleDisconnect(bob);
    vi.advanceTimersByTime(LOW_PLAYERS_GRACE_MS - 1);
    expect(h.room.rejoin(h.token(bob), 'bob-2').ok).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(phaseOf(h.room).kind).toBe('drawing');
    h.send(bob, { t: 'chat', text: word });
    expect(h.score(bob)).toBeGreaterThan(0);
    expect(phaseOf(h.room).kind).toBe('turnEnd');
  });

  it('holds the turn boundary for a player in reconnect grace and abandons the game only when it expires', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob'], { rounds: 3 });
    const [alice, bob] = players;
    const { word } = pick(h, players);
    h.send(bob, { t: 'chat', text: word });
    expect(phaseOf(h.room).kind).toBe('turnEnd');
    h.transport.clear();
    h.room.handleDisconnect(bob);
    expect(phaseOf(h.room).kind).toBe('turnEnd');
    // The summary timer fires while Bob is still in grace: nothing is reset yet.
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000);
    expect(phaseOf(h.room).kind).toBe('turnEnd');
    expect(h.transport.chats(alice)).toEqual([{ kind: 'system', text: 'Waiting for Bob to reconnect…' }]);
    expect(h.score(alice)).toBeGreaterThan(0);
    // The same 10 s grace a mid-turn drop gets, then back to the lobby.
    vi.advanceTimersByTime(LOW_PLAYERS_GRACE_MS - TURN_END_SECONDS * 1000);
    expect(h.room.phase).toBe('lobby');
    expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'system', text: 'Not enough players — back to the lobby.' });
    expect(h.score(alice)).toBe(0);
    // The pending low-player check was cancelled by the reset; only Bob's seat expiring follows.
    vi.advanceTimersByTime(600_000);
    expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'system', text: 'Bob left' });
  });

  it('resumes the held turn boundary with scores intact when the player rejoins in time', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob'], { rounds: 3 });
    const [alice, bob] = players;
    const { word } = pick(h, players);
    h.send(bob, { t: 'chat', text: word });
    const scores = [h.score(alice), h.score(bob)];
    h.room.handleDisconnect(bob);
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000 + 1000);
    expect(phaseOf(h.room).kind).toBe('turnEnd');
    h.transport.clear();
    expect(h.room.rejoin(h.token(bob), 'conn-Bob-2').ok).toBe(true);
    // Bob draws next; the welcome shows the summary, the snapshot right after it the new turn.
    expect(drawerOf(h.room, players)).toBe(bob);
    expect(h.transport.last(bob, 'welcome').room.game?.phase.kind).toBe('turnEnd');
    expect(h.transport.last(bob, 'room').room.game?.phase.kind).toBe('choosing');
    expect(h.transport.last(alice, 'room').room.game?.phase.kind).toBe('choosing');
    expect([h.score(alice), h.score(bob)]).toEqual(scores);
    expect(skribbleView(h.room)).toMatchObject({ round: 1, turn: 2 });
    // The grace timer that would have abandoned the game is gone.
    vi.advanceTimersByTime(LOW_PLAYERS_GRACE_MS);
    expect(phaseOf(h.room).kind).toBe('choosing');
  });

  it('resumes a held turn boundary when a new player joins instead', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob'], { rounds: 3 });
    const [, bob] = players;
    const { word } = pick(h, players);
    h.send(bob, { t: 'chat', text: word });
    h.room.handleDisconnect(bob);
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000);
    expect(phaseOf(h.room).kind).toBe('turnEnd');
    const carol = h.join('Carol');
    expect(phaseOf(h.room).kind).toBe('choosing');
    // Bob is skipped while away; Carol is the only connected candidate.
    expect(drawerOf(h.room, [...players, carol])).toBe(carol);
    vi.advanceTimersByTime(LOW_PLAYERS_GRACE_MS);
    expect(phaseOf(h.room).kind).toBe('choosing');
  });

  it('gives the last unsolved guesser a grace before "everyone guessed" ends the turn', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    const { word } = pick(h, players);
    h.send(bob, { t: 'chat', text: word });
    h.room.handleDisconnect(carol);
    // A reload must not forfeit Carol's turn.
    expect(phaseOf(h.room).kind).toBe('drawing');
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS - 1);
    expect(phaseOf(h.room).kind).toBe('drawing');
    expect(h.room.rejoin(h.token(carol), 'conn-Carol-2').ok).toBe(true);
    vi.advanceTimersByTime(1);
    expect(phaseOf(h.room).kind).toBe('drawing');
    h.send(carol, { t: 'chat', text: word });
    expect(h.score(carol)).toBeGreaterThan(0);
    expect(expectPhase(h.room, 'turnEnd').reason).toBe('allGuessed');
    expect(h.turnState(alice).turnPoints).toBe(drawerPoints(2, 2));

    // Without a rejoin the turn ends after the grace, and Carol still dilutes the drawer's share.
    const g = createHarness();
    const ps = startGame(g, ['Alice', 'Bob', 'Carol']);
    const [a2, b2, c2] = ps;
    const second = pick(g, ps);
    g.send(b2, { t: 'chat', text: second.word });
    g.room.handleDisconnect(c2);
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS);
    expect(expectPhase(g.room, 'turnEnd').reason).toBe('allGuessed');
    expect(g.turnState(a2).turnPoints).toBe(drawerPoints(1, 2));
  });

  it('tells players the drawer lost connection when their grace runs out', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob] = players;
    pick(h, players);
    h.transport.clear();
    h.room.handleDisconnect(alice);
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS);
    expect(expectPhase(h.room, 'turnEnd').reason).toBe('drawerLeft');
    expect(h.transport.chats(bob).map((c) => c.text)).toContain('Alice lost connection — skipping their turn.');
    expect(h.room.getPlayer(alice)).toBeDefined();
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(h.room.getPlayer(alice)).toBeUndefined();
  });

  it('kicking the drawer ends the turn without drawer points', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    pick(h, players);
    // Alice is host and drawer; make Bob draw instead by advancing a turn.
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    const { drawer, word } = pick(h, players);
    expect(drawer).toBe(bob);
    h.send(carol, { t: 'chat', text: word });
    h.send(alice, { t: 'kick', playerId: bob });
    const end = expectPhase(h.room, 'turnEnd');
    expect(end.reason).toBe('drawerLeft');
    expect(end.points).toEqual({ [carol]: h.turnState(carol).turnPoints });
    expect(h.room.getState(null).players.map((p) => p.name)).toEqual(['Alice', 'Carol']);
  });
});

describe('Skribble: ratings and snapshots', () => {
  it('tracks likes/dislikes per recipient and toggles on repeat', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    h.send(bob, { t: 'rate', value: 'like' });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
    pick(h, players);
    h.transport.clear();

    h.send(bob, { t: 'rate', value: 'like' });
    h.send(carol, { t: 'rate', value: 'dislike' });
    expect(expectPhase(h.room, 'drawing', bob)).toMatchObject({ likes: 1, dislikes: 1, myRating: 'like' });
    expect(expectPhase(h.room, 'drawing', carol)).toMatchObject({ likes: 1, dislikes: 1, myRating: 'dislike' });
    expect(expectPhase(h.room, 'drawing', alice)).not.toHaveProperty('myRating');
    expect(h.transport.ofType(alice, 'room')).toHaveLength(2);

    h.send(bob, { t: 'rate', value: 'like' });
    expect(expectPhase(h.room, 'drawing', bob)).toMatchObject({ likes: 0, dislikes: 1 });
    expect(expectPhase(h.room, 'drawing', bob)).not.toHaveProperty('myRating');
    h.send(carol, { t: 'rate', value: 'like' });
    expect(expectPhase(h.room, 'drawing', bob)).toMatchObject({ likes: 1, dislikes: 0 });

    h.send(alice, { t: 'rate', value: 'like' });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
  });

  it('forgets the rating of a player who leaves or is kicked', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol', 'Dave']);
    const [alice, bob, carol, dave] = players;
    pick(h, players);
    h.send(bob, { t: 'rate', value: 'like' });
    h.send(carol, { t: 'rate', value: 'dislike' });
    h.send(dave, { t: 'rate', value: 'dislike' });
    expect(expectPhase(h.room, 'drawing', alice)).toMatchObject({ likes: 1, dislikes: 2 });

    h.room.leave(carol);
    expect(expectPhase(h.room, 'drawing', alice)).toMatchObject({ likes: 1, dislikes: 1 });
    h.send(alice, { t: 'kick', playerId: dave });
    expect(expectPhase(h.room, 'drawing', alice)).toMatchObject({ likes: 1, dislikes: 0 });
    expect(expectPhase(h.room, 'drawing', bob)).toMatchObject({ likes: 1, dislikes: 0, myRating: 'like' });
  });

  it('builds per-recipient views with the right visibility', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    expect(phaseOf(h.room, alice)).toMatchObject({ kind: 'choosing', choices: ['apple', 'banana', 'cherry'] });
    expect(phaseOf(h.room, bob)).not.toHaveProperty('choices');
    expect(phaseOf(h.room)).not.toHaveProperty('choices');

    const { word } = pick(h, players);
    h.send(bob, { t: 'chat', text: word });
    expect(phaseOf(h.room, alice)).toMatchObject({ kind: 'drawing', word });
    expect(phaseOf(h.room, bob)).toMatchObject({ kind: 'drawing', word });
    expect(phaseOf(h.room, carol)).not.toHaveProperty('word');
    expect(phaseOf(h.room)).not.toHaveProperty('word');
    expect(skribbleView(h.room).players[alice].guessedThisTurn).toBe(true);
    // Unknown viewers get the spectator view.
    expect(h.room.getState('ghost').game).toMatchObject({ phase: { kind: 'drawing' } });
    expect(h.room.getState('ghost').game).not.toHaveProperty('phase.word');
  });

  it('does not send snapshots for plain chat or draw traffic', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.transport.clear();
    h.send(bob, { t: 'chat', text: 'hmm' });
    h.send(alice, { t: 'draw', ops: [{ k: 'fill', x: 1, y: 1, color: '#000000' }] });
    expect(h.transport.ofType(alice, 'room')).toHaveLength(0);
    expect(h.transport.ofType(bob, 'room')).toHaveLength(0);
  });

  it('validates Skribble settings through the platform patch', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    h.send(alice, { t: 'updateSettings', settings: { rounds: 5, customWords: ['cat', ' Dog ', 'cat', 'hot  dog'], customWordsOnly: true } });
    expect(h.room.settings).toMatchObject({ rounds: 5, customWords: ['cat', 'Dog', 'hot dog'], customWordsOnly: false });
    h.send(alice, { t: 'updateSettings', settings: { customWords: TEST_WORDS, customWordsOnly: true } });
    expect(h.room.settings.customWordsOnly).toBe(true);
    h.transport.clear();
    h.send(alice, { t: 'updateSettings', settings: { rounds: 0 } });
    expect(h.transport.errors(alice)).toEqual(['INVALID_MESSAGE']);
    expect(h.room.settings.rounds).toBe(5);
    expect(h.room.join('Bob', AVATAR, 'b').ok).toBe(true);
  });
});
