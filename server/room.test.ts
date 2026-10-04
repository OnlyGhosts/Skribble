import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_HISTORY_LENGTH,
  CHOOSE_TIME_SECONDS,
  DRAWER_DISCONNECT_GRACE_MS,
  MAX_ACTIONS_PER_TURN,
  MAX_POINTS_PER_STROKE,
  RECONNECT_GRACE_MS,
  TURN_END_SECONDS,
} from '../shared/constants';
import { hintRevealOrder, hintSchedule, maskWord } from '../shared/hints';
import type { DrawOp } from '../shared/protocol';
import { drawerPoints, guesserPoints } from '../shared/scoring';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { AVATAR, TEST_WORDS, createHarness, drawerOf, expectPhase, phaseOf, startGame, type Harness } from './testUtils';

const START = new Date('2026-01-01T12:00:00Z').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Moves the game from `choosing` into `drawing` by having the drawer pick choice `index`. */
function pick(h: Harness, players: ReturnType<Harness['join']>[], index = 0): { drawer: ReturnType<Harness['join']>; word: string } {
  const drawer = drawerOf(h.room, players);
  const choosing = expectPhase(h.room, 'choosing', drawer);
  const word = choosing.choices?.[index];
  if (word === undefined) throw new Error('no choices');
  h.room.handleMessage(drawer, { t: 'chooseWord', index });
  expectPhase(h.room, 'drawing');
  return { drawer, word };
}

describe('Room: seats', () => {
  it('makes the first joiner host and sends welcome / snapshot / system message', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    expect(h.room.hostPlayerId).toBe(alice.id);
    const welcome = h.transport.last(alice, 'welcome');
    expect(welcome.playerId).toBe(alice.id);
    expect(welcome.token).toBe(alice.token);
    expect(welcome.token).toMatch(/^[0-9a-f]{32}$/);
    expect(welcome.room.hostId).toBe(alice.id);
    expect(welcome.room.phase).toEqual({ kind: 'lobby' });
    expect(welcome.room.players).toHaveLength(1);
    expect(welcome.room.players[0].isHost).toBe(true);
    expect(welcome.canvas).toEqual([]);
    expect(welcome.chat.map((c) => c.text)).toEqual(['Alice joined']);
    expect(welcome.room.serverTime).toBe(START);
    expect(h.transport.attached).toEqual([{ playerId: alice.id, connectionId: 'conn-Alice' }]);

    h.transport.clear();
    const bob = h.join('Bob');
    expect(h.transport.ofType(alice, 'room')).toHaveLength(1);
    expect(h.transport.last(alice, 'room').room.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    expect(h.transport.chats(alice)).toEqual([{ kind: 'system', text: 'Bob joined' }]);
    // The joiner gets the join notice through the welcome history, not twice.
    expect(h.transport.ofType(bob, 'chat')).toHaveLength(0);
    expect(h.transport.last(bob, 'welcome').chat.map((c) => c.text)).toEqual(['Alice joined', 'Bob joined']);
    expect(bob.joinOrder).toBe(1);
  });

  it('rejects joins when the room is full (counting players in grace)', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    h.room.handleMessage(alice, { t: 'updateSettings', settings: { maxPlayers: 2 } });
    const bob = h.join('Bob');
    expect(h.room.join('Carol', AVATAR, 'c')).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    h.room.handleDisconnect(bob);
    expect(h.room.isFull).toBe(true);
    expect(h.room.join('Carol', AVATAR, 'c')).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(h.room.join('Carol', AVATAR, 'c').ok).toBe(true);
  });

  it('removes a leaving player immediately and transfers host to the longest-connected player', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    vi.advanceTimersByTime(1000);
    const bob = h.join('Bob');
    vi.advanceTimersByTime(1000);
    const carol = h.join('Carol');
    // Bob reconnects later than Carol joined, so Carol is the longest-connected.
    h.room.handleDisconnect(bob);
    vi.advanceTimersByTime(1000);
    expect(h.room.rejoin(bob.token, 'conn-Bob-2').ok).toBe(true);
    h.transport.clear();

    h.room.leave(alice);
    expect(h.room.playerCount).toBe(2);
    expect(h.room.hostPlayerId).toBe(carol.id);
    expect(h.transport.chats(bob).map((c) => c.text)).toEqual(['Alice left', 'Carol is now the host']);
    expect(h.transport.last(carol, 'room').room.players.find((p) => p.name === 'Carol')?.isHost).toBe(true);
    expect(alice.token).toBe('');
  });

  it('passes host after the grace period and prefers connected players', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    const bob = h.join('Bob');
    const carol = h.join('Carol');
    h.room.handleDisconnect(bob);
    h.room.handleDisconnect(alice);
    expect(h.room.hostPlayerId).toBe(alice.id);
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(h.room.playerCount).toBe(1);
    expect(h.room.hostPlayerId).toBe(carol.id);
  });

  it('fires onEmpty when the last seat is released', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    expect(h.emptied).toHaveLength(0);
    h.room.leave(alice);
    expect(h.emptied).toEqual([h.room]);
    expect(h.room.isEmpty).toBe(true);
    expect(h.room.hostPlayerId).toBe('');
  });
});

describe('Room: start preconditions', () => {
  it('only the host may start, and only with enough connected players', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    h.room.handleMessage(alice, { t: 'start' });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);

    const bob = h.join('Bob');
    h.room.handleMessage(bob, { t: 'start' });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);

    h.room.handleDisconnect(bob);
    h.room.handleMessage(alice, { t: 'start' });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
    expect(h.room.phaseKind).toBe('lobby');

    h.room.rejoin(bob.token, 'conn-Bob-2');
    h.transport.clear();
    h.room.handleMessage(alice, { t: 'start' });
    expect(h.room.phaseKind).toBe('choosing');
    expect(h.transport.chats(bob).map((c) => c.text)).toContain('The game has started!');
    expect(h.transport.ofType(bob, 'clear')).toHaveLength(1);
  });

  it('cannot start twice', () => {
    const h = createHarness();
    const [alice] = startGame(h, ['Alice', 'Bob']);
    h.transport.clear();
    h.room.handleMessage(alice, { t: 'start' });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
  });
});

describe('Room: turn lifecycle', () => {
  it('runs choosing -> drawing -> turnEnd -> next turn -> gameEnd with a tie-aware podium', () => {
    const h = createHarness();
    const [alice, bob, carol] = startGame(h, ['Alice', 'Bob', 'Carol']);
    const state = h.room.getState(null);
    expect(state.round).toBe(1);
    expect(state.totalRounds).toBe(1);
    expect(state.turn).toBe(1);
    expect(state.turnsInRound).toBe(3);

    // Turn 1: Alice draws (joinOrder 0), only Bob guesses.
    let choosing = expectPhase(h.room, 'choosing', alice);
    expect(choosing.drawerId).toBe(alice.id);
    expect(choosing.endsAt).toBe(START + CHOOSE_TIME_SECONDS * 1000);
    expect(choosing.choices).toEqual(['apple', 'banana', 'cherry']);
    expect(expectPhase(h.room, 'choosing', bob).choices).toBeUndefined();

    h.room.handleMessage(alice, { t: 'chooseWord', index: 0 });
    const drawing = expectPhase(h.room, 'drawing', bob);
    expect(drawing).toMatchObject({ drawerId: alice.id, startedAt: START, endsAt: START + 60_000, mask: '_____', likes: 0, dislikes: 0 });
    expect(drawing.word).toBeUndefined();
    expect(expectPhase(h.room, 'drawing', alice).word).toBe('apple');

    vi.advanceTimersByTime(10_000);
    h.room.handleMessage(bob, { t: 'chat', text: 'Apple' });
    const guessPts = guesserPoints(50_000, 60_000);
    expect(bob.score).toBe(guessPts);
    expect(bob.guessedThisTurn).toBe(true);
    expect(h.room.phaseKind).toBe('drawing');
    // Carol guesses at the same instant: everyone guessed, so the turn ends early.
    h.room.handleMessage(carol, { t: 'chat', text: 'apple' });
    expect(carol.score).toBe(guessPts);

    const turnEnd = expectPhase(h.room, 'turnEnd');
    expect(turnEnd.reason).toBe('allGuessed');
    expect(turnEnd.word).toBe('apple');
    expect(turnEnd.drawerId).toBe(alice.id);
    expect(turnEnd.endsAt).toBe(Date.now() + TURN_END_SECONDS * 1000);
    const alicePts = drawerPoints(2, 2);
    expect(alicePts).toBe(300);
    expect(turnEnd.points).toEqual({ [alice.id]: alicePts, [bob.id]: guessPts, [carol.id]: guessPts });
    expect(h.transport.chats(carol).at(-1)).toEqual({ kind: 'hint', text: 'The word was: apple' });
    // The drawing timer was cancelled with the early end.
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000 - 1);
    expect(h.room.phaseKind).toBe('turnEnd');

    // Turn 2: Bob draws; nobody guesses and time runs out.
    vi.advanceTimersByTime(1);
    choosing = expectPhase(h.room, 'choosing', bob);
    expect(choosing.drawerId).toBe(bob.id);
    expect(h.room.getState(null).turn).toBe(2);
    // The used word is excluded from the next choices.
    expect(choosing.choices).toEqual(['banana', 'cherry', 'dragon']);
    expect(h.transport.last(carol, 'room').room.players.every((p) => p.turnPoints === 0)).toBe(true);
    h.room.handleMessage(bob, { t: 'chooseWord', index: 1 });
    vi.advanceTimersByTime(59_999);
    expect(h.room.phaseKind).toBe('drawing');
    vi.advanceTimersByTime(1);
    const second = expectPhase(h.room, 'turnEnd');
    expect(second.reason).toBe('timeUp');
    expect(second.word).toBe('cherry');
    expect(second.points).toEqual({});

    // Turn 3: Carol draws; nobody guesses.
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000);
    expect(drawerOf(h.room, [alice, bob, carol])).toBe(carol);
    expect(h.room.getState(null).turn).toBe(3);
    h.room.handleMessage(carol, { t: 'chooseWord', index: 0 });
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);

    const end = expectPhase(h.room, 'gameEnd');
    expect(alice.score).toBe(alicePts);
    expect(bob.score).toBe(guessPts);
    expect(carol.score).toBe(guessPts);
    // Bob and Carol tie for first (ordered by join order); Alice is third, not second.
    expect(end.podium).toEqual([
      { playerId: bob.id, score: guessPts, rank: 1 },
      { playerId: carol.id, score: guessPts, rank: 1 },
      { playerId: alice.id, score: alicePts, rank: 3 },
    ]);
    expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'system', text: `Game over! Bob wins with ${guessPts} points.` });

    // gameEnd persists until the host returns to the lobby.
    vi.advanceTimersByTime(600_000);
    expect(h.room.phaseKind).toBe('gameEnd');
    h.room.handleMessage(bob, { t: 'returnToLobby' });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
    h.room.handleMessage(alice, { t: 'returnToLobby' });
    const lobby = h.room.getState(null);
    expect(lobby.phase).toEqual({ kind: 'lobby' });
    expect(lobby.round).toBe(0);
    expect(lobby.turn).toBe(0);
    expect(lobby.players.every((p) => p.score === 0 && p.turnPoints === 0 && !p.guessedThisTurn)).toBe(true);
  });

  it('ends the turn as soon as every connected non-drawer has guessed', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [, bob, carol] = players;
    const { drawer, word } = pick(h, players);
    h.room.handleMessage(bob, { t: 'chat', text: word });
    expect(h.room.phaseKind).toBe('drawing');
    h.room.handleMessage(carol, { t: 'chat', text: word.toUpperCase() });
    const end = expectPhase(h.room, 'turnEnd');
    expect(end.reason).toBe('allGuessed');
    expect(end.points[drawer.id]).toBe(drawerPoints(2, 2));
  });

  it('auto-picks the first choice when the drawer does not choose in time', () => {
    const h = createHarness();
    const [alice] = startGame(h, ['Alice', 'Bob']);
    vi.advanceTimersByTime(CHOOSE_TIME_SECONDS * 1000 - 1);
    expect(h.room.phaseKind).toBe('choosing');
    vi.advanceTimersByTime(1);
    const drawing = expectPhase(h.room, 'drawing', alice);
    expect(drawing.word).toBe('apple');
    expect(drawing.startedAt).toBe(START + CHOOSE_TIME_SECONDS * 1000);
  });

  it('rejects chooseWord from non-drawers, out of range and outside choosing', () => {
    const h = createHarness();
    const [alice, bob] = startGame(h, ['Alice', 'Bob']);
    h.room.handleMessage(bob, { t: 'chooseWord', index: 0 });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
    h.room.handleMessage(alice, { t: 'chooseWord', index: 7 });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
    expect(h.room.phaseKind).toBe('choosing');
    h.room.handleMessage(alice, { t: 'chooseWord', index: 2 });
    expect(h.room.phaseKind).toBe('drawing');
    h.room.handleMessage(alice, { t: 'chooseWord', index: 0 });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
  });

  it('appends mid-game joiners to the current round and respects allowMidGameJoin', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    expect(h.room.getState(null).turnsInRound).toBe(2);
    const carol = h.join('Carol');
    expect(h.room.getState(null).turnsInRound).toBe(3);
    expect(h.transport.last(carol, 'welcome').room.phase.kind).toBe('choosing');

    // Carol draws last this round.
    pick(h, [...players, carol]);
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    pick(h, [...players, carol]);
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    expect(drawerOf(h.room, [...players, carol])).toBe(carol);
    expect(h.room.getState(null).turn).toBe(3);

    const closed = createHarness();
    startGame(closed, ['Alice', 'Bob'], { allowMidGameJoin: false });
    expect(closed.room.join('Carol', AVATAR, 'c')).toMatchObject({ ok: false, code: 'GAME_IN_PROGRESS' });
    expect(closed.room.isJoinable).toBe(false);
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
    expect(h.room.getState(null)).toMatchObject({ round: 1, turn: 2, turnsInRound: 2 });

    expect(h.room.rejoin(bob.token, 'conn-Bob-2').ok).toBe(true);
    pick(h, players);
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    // Round 2 includes everyone again in join order.
    expect(h.room.getState(null)).toMatchObject({ round: 2, turn: 1, turnsInRound: 3 });
    expect(drawerOf(h.room, players)).toBe(alice);
    pick(h, players);
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    expect(drawerOf(h.room, players)).toBe(bob);
  });

  it('clears the canvas for everyone at the start of each turn', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const { drawer } = pick(h, players);
    h.room.handleMessage(drawer, { t: 'draw', ops: [{ k: 'start', id: 1, tool: 'brush', color: '#000000', size: 6, x: 1, y: 1 }] });
    expect(h.room.canvasHistory).toHaveLength(1);
    h.transport.clear();
    vi.advanceTimersByTime(60_000 + TURN_END_SECONDS * 1000);
    expect(h.room.phaseKind).toBe('choosing');
    expect(h.room.canvasHistory).toHaveLength(0);
    for (const p of players) expect(h.transport.ofType(p, 'clear')).toHaveLength(1);
  });
});

describe('Room: guessing and chat', () => {
  it('scores a correct guess, hides the guess text and reveals the word to the guesser', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    const { word } = pick(h, players);
    h.transport.clear();
    vi.advanceTimersByTime(15_000);
    h.room.handleMessage(bob, { t: 'chat', text: `  ${word} ` });

    const expected = guesserPoints(45_000, 60_000);
    expect(bob.score).toBe(expected);
    expect(bob.turnPoints).toBe(expected);
    for (const p of players) {
      const chats = h.transport.chats(p);
      expect(chats).toEqual([{ kind: 'correct', text: 'Bob guessed the word!' }]);
      expect(JSON.stringify(h.transport.of(p))).not.toContain(`"text":"  ${word} "`);
    }
    const correct = h.transport.last(carol, 'chat').message;
    expect(correct.playerId).toBe(bob.id);
    expect(correct.name).toBe('Bob');

    expect(expectPhase(h.room, 'drawing', bob).word).toBe(word);
    expect(expectPhase(h.room, 'drawing', carol).word).toBeUndefined();
    expect(h.transport.last(bob, 'room').room.phase).toMatchObject({ kind: 'drawing', word });
    expect(h.transport.last(carol, 'room').room.phase).not.toHaveProperty('word');
    expect(h.transport.last(alice, 'room').room.players.find((p) => p.id === bob.id)).toMatchObject({
      guessedThisTurn: true,
      score: expected,
      turnPoints: expected,
    });
  });

  it('flags close guesses privately while still broadcasting the chat line', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    pick(h, players); // apple
    h.transport.clear();
    h.room.handleMessage(bob, { t: 'chat', text: 'aple' });
    expect(h.transport.chats(bob)).toEqual([
      { kind: 'chat', text: 'aple' },
      { kind: 'close', text: "'aple' is close!" },
    ]);
    expect(h.transport.chats(alice)).toEqual([{ kind: 'chat', text: 'aple' }]);
    expect(h.transport.chats(carol)).toEqual([{ kind: 'chat', text: 'aple' }]);
    expect(bob.score).toBe(0);

    h.transport.clear();
    h.room.handleMessage(bob, { t: 'chat', text: 'house' });
    for (const p of players) expect(h.transport.chats(p)).toEqual([{ kind: 'chat', text: 'house' }]);
  });

  it("blocks the drawer from leaking the word and routes the drawer's chat to guessers only", () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    const { word } = pick(h, players);
    h.transport.clear();

    h.room.handleMessage(alice, { t: 'chat', text: `it is an ${word}!` });
    expect(h.transport.chats(alice)).toEqual([{ kind: 'system', text: "You can't give away the word!" }]);
    expect(h.transport.chats(bob)).toEqual([]);
    expect(h.transport.chats(carol)).toEqual([]);

    h.room.handleMessage(alice, { t: 'chat', text: 'hurry up' });
    expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'guessed', text: 'hurry up' });
    expect(h.transport.chats(bob)).toEqual([]);

    h.room.handleMessage(bob, { t: 'chat', text: word });
    h.transport.clear();
    h.room.handleMessage(alice, { t: 'chat', text: 'nice one' });
    expect(h.transport.chats(bob)).toEqual([{ kind: 'guessed', text: 'nice one' }]);
    expect(h.transport.chats(carol)).toEqual([]);
  });

  it("delivers guessed players' chat only to the drawer and other guessers", () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol', 'Dave']);
    const [alice, bob, carol, dave] = players;
    const { word } = pick(h, players);
    h.room.handleMessage(bob, { t: 'chat', text: word });
    h.room.handleMessage(carol, { t: 'chat', text: word });
    h.transport.clear();

    h.room.handleMessage(bob, { t: 'chat', text: `the ${word} is easy` });
    expect(h.transport.chats(alice)).toEqual([{ kind: 'guessed', text: `the ${word} is easy` }]);
    expect(h.transport.chats(carol)).toEqual([{ kind: 'guessed', text: `the ${word} is easy` }]);
    expect(h.transport.chats(bob)).toEqual([{ kind: 'guessed', text: `the ${word} is easy` }]);
    expect(h.transport.chats(dave)).toEqual([]);
    // Guessing again never scores twice.
    h.room.handleMessage(bob, { t: 'chat', text: word });
    expect(bob.score).toBe(guesserPoints(60_000, 60_000));
    // 'guessed' messages are not part of the public history late joiners receive.
    const eve = h.join('Eve');
    expect(h.transport.last(eve, 'welcome').chat.every((c) => c.kind !== 'guessed' && c.kind !== 'close')).toBe(true);
  });

  it('lets everyone chat normally outside the drawing phase and caps the history', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    const bob = h.join('Bob');
    h.transport.clear();
    h.room.handleMessage(alice, { t: 'chat', text: 'apple' });
    expect(h.transport.chats(bob)).toEqual([{ kind: 'chat', text: 'apple' }]);
    expect(h.transport.last(bob, 'chat').message).toMatchObject({ playerId: alice.id, name: 'Alice', ts: START });

    for (let i = 0; i < CHAT_HISTORY_LENGTH + 10; i++) h.room.handleMessage(bob, { t: 'chat', text: `m${i}` });
    const carol = h.join('Carol');
    const history = h.transport.last(carol, 'welcome').chat;
    expect(history).toHaveLength(CHAT_HISTORY_LENGTH);
    expect(history.at(-1)?.text).toBe('Carol joined');
    expect(history.at(-2)?.text).toBe(`m${CHAT_HISTORY_LENGTH + 9}`);
    // Ids strictly increase.
    for (let i = 1; i < history.length; i++) expect(history[i].id).toBeGreaterThan(history[i - 1].id);
  });
});

describe('Room: hints', () => {
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

describe('Room: canvas', () => {
  const start = (id: number): DrawOp => ({ k: 'start', id, tool: 'brush', color: '#ff0000', size: 6, x: 10, y: 20 });

  it('forwards draw ops to everyone but the drawer and keeps a replayable history', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    const { drawer } = pick(h, players);
    expect(drawer).toBe(alice);
    h.transport.clear();

    const ops: DrawOp[] = [start(1), { k: 'move', id: 1, pts: [11, 21, 12, 22] }, { k: 'move', id: 99, pts: [0, 0] }, { k: 'end', id: 1 }, { k: 'end', id: 99 }, { k: 'fill', x: 5, y: 5, color: '#00ff00' }];
    h.room.handleMessage(alice, { t: 'draw', ops });
    expect(h.transport.ofType(alice, 'draw')).toHaveLength(0);
    const forwarded = h.transport.last(bob, 'draw').ops;
    expect(forwarded).toEqual([start(1), { k: 'move', id: 1, pts: [11, 21, 12, 22] }, { k: 'end', id: 1 }, { k: 'fill', x: 5, y: 5, color: '#00ff00' }]);
    expect(h.transport.last(carol, 'draw').ops).toEqual(forwarded);
    expect(h.room.canvasHistory).toEqual([
      { kind: 'stroke', id: 1, tool: 'brush', color: '#ff0000', size: 6, points: [10, 20, 11, 21, 12, 22], done: true },
      { kind: 'fill', x: 5, y: 5, color: '#00ff00' },
    ]);
    // No snapshot for draw traffic.
    expect(h.transport.ofType(bob, 'room')).toHaveLength(0);

    h.room.handleMessage(bob, { t: 'draw', ops: [start(2)] });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
    expect(h.room.canvasHistory).toHaveLength(2);
  });

  it('undo and clear are echoed to everyone including the drawer', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.room.handleMessage(alice, { t: 'draw', ops: [start(1), start(2)] });
    h.transport.clear();

    h.room.handleMessage(alice, { t: 'undo' });
    expect(h.room.canvasHistory).toHaveLength(1);
    expect(h.transport.ofType(alice, 'undo')).toHaveLength(1);
    expect(h.transport.ofType(bob, 'undo')).toHaveLength(1);
    // Moves for an undone stroke are ignored.
    h.room.handleMessage(alice, { t: 'draw', ops: [{ k: 'move', id: 2, pts: [1, 1] }] });
    expect(h.transport.ofType(bob, 'draw')).toHaveLength(0);

    h.room.handleMessage(alice, { t: 'clear' });
    expect(h.room.canvasHistory).toHaveLength(0);
    expect(h.transport.ofType(alice, 'clear')).toHaveLength(1);
    expect(h.transport.ofType(bob, 'clear')).toHaveLength(1);

    h.room.handleMessage(bob, { t: 'undo' });
    h.room.handleMessage(bob, { t: 'clear' });
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
      h.room.handleMessage(alice, { t: 'draw', ops });
    }
    expect(h.room.canvasHistory).toHaveLength(MAX_ACTIONS_PER_TURN);
    const forwardedStarts = h.transport.ofType(bob, 'draw').flatMap((m) => m.ops).filter((o) => o.k === 'start');
    expect(forwardedStarts).toHaveLength(MAX_ACTIONS_PER_TURN);
    h.room.handleMessage(alice, { t: 'draw', ops: [{ k: 'fill', x: 0, y: 0, color: '#000000' }] });
    expect(h.room.canvasHistory).toHaveLength(MAX_ACTIONS_PER_TURN);

    h.room.handleMessage(alice, { t: 'clear' });
    h.transport.clear();
    h.room.handleMessage(alice, { t: 'draw', ops: [start(1)] });
    const chunk = new Array<number>(2000).fill(1);
    while (h.room.canvasHistory[0].kind === 'stroke' && h.room.canvasHistory[0].points.length < MAX_POINTS_PER_STROKE) {
      h.room.handleMessage(alice, { t: 'draw', ops: [{ k: 'move', id: 1, pts: chunk }] });
    }
    const stroke = h.room.canvasHistory[0];
    expect(stroke.kind === 'stroke' && stroke.points.length).toBe(MAX_POINTS_PER_STROKE);
    h.transport.clear();
    h.room.handleMessage(alice, { t: 'draw', ops: [{ k: 'move', id: 1, pts: [1, 1] }] });
    expect(h.transport.ofType(bob, 'draw')).toHaveLength(0);
    // The forwarded stream matches the stored history exactly (truncated batches included).
    const total = h.transport.ofType(bob, 'draw').length;
    expect(total).toBe(0);
  });

  it('truncates a move batch that overflows the stroke cap and forwards the truncated op', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.room.handleMessage(alice, { t: 'draw', ops: [start(1)] });
    const fill = new Array<number>(MAX_POINTS_PER_STROKE - 2 - 4).fill(2);
    h.room.handleMessage(alice, { t: 'draw', ops: [{ k: 'move', id: 1, pts: fill }] });
    h.transport.clear();
    h.room.handleMessage(alice, { t: 'draw', ops: [{ k: 'move', id: 1, pts: [1, 2, 3, 4, 5, 6, 7, 8] }] });
    expect(h.transport.last(bob, 'draw').ops).toEqual([{ k: 'move', id: 1, pts: [1, 2, 3, 4] }]);
    const stroke = h.room.canvasHistory[0];
    expect(stroke.kind === 'stroke' && stroke.points.length).toBe(MAX_POINTS_PER_STROKE);
  });

  it('gives late joiners and rejoiners the full history in welcome', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.room.handleMessage(alice, { t: 'draw', ops: [start(1), { k: 'move', id: 1, pts: [1, 2] }] });
    const carol = h.join('Carol');
    expect(h.transport.last(carol, 'welcome').canvas).toEqual([
      { kind: 'stroke', id: 1, tool: 'brush', color: '#ff0000', size: 6, points: [10, 20, 1, 2] },
    ]);
    h.room.handleDisconnect(bob);
    h.room.handleMessage(alice, { t: 'draw', ops: [{ k: 'fill', x: 1, y: 1, color: '#000000' }] });
    h.room.rejoin(bob.token, 'conn-Bob-2');
    expect(h.transport.last(bob, 'welcome').canvas).toHaveLength(2);
  });
});

describe('Room: reconnection', () => {
  it('keeps the seat and score through a disconnect and restores it on rejoin', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    const { word } = pick(h, players);
    h.room.handleMessage(bob, { t: 'chat', text: word });
    const score = bob.score;
    h.transport.clear();

    h.room.handleDisconnect(bob, 'conn-Bob');
    expect(bob.connected).toBe(false);
    expect(h.room.playerCount).toBe(3);
    expect(h.transport.last(alice, 'room').room.players.find((p) => p.id === bob.id)?.connected).toBe(false);

    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
    h.transport.clear();
    const result = h.room.rejoin(bob.token, 'conn-Bob-2');
    expect(result.ok && result.player).toBe(bob);
    expect(bob.connected).toBe(true);
    expect(bob.score).toBe(score);
    expect(bob.connectionId).toBe('conn-Bob-2');
    const welcome = h.transport.last(bob, 'welcome');
    expect(welcome.playerId).toBe(bob.id);
    expect(welcome.room.players.find((p) => p.id === bob.id)).toMatchObject({ connected: true, score, guessedThisTurn: true });
    expect(welcome.room.phase).toMatchObject({ kind: 'drawing', word });
    expect(welcome.chat.length).toBeGreaterThan(0);
    expect(h.transport.chats(carol)).toEqual([{ kind: 'system', text: 'Bob reconnected' }]);
    expect(h.transport.last(carol, 'room').room.players.find((p) => p.id === bob.id)?.connected).toBe(true);
    // The seat survives well past the original grace deadline.
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(h.room.playerCount).toBe(3);
  });

  it('fails rejoin with unknown or expired tokens', () => {
    const h = createHarness();
    h.join('Alice');
    const bob = h.join('Bob');
    expect(h.room.rejoin('nope', 'x')).toMatchObject({ ok: false, code: 'REJOIN_FAILED' });
    h.room.handleDisconnect(bob);
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(h.room.playerCount).toBe(1);
    expect(h.room.rejoin(bob.token, 'x')).toMatchObject({ ok: false, code: 'REJOIN_FAILED' });
  });

  it('replaces a stale socket on rejoin and ignores the stale socket closing later', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    h.join('Bob');
    h.transport.clear();
    const result = h.room.rejoin(alice.token, 'conn-Alice-2');
    expect(result.ok).toBe(true);
    expect(alice.connected).toBe(true);
    expect(alice.connectionId).toBe('conn-Alice-2');
    expect(h.transport.attached).toEqual([{ playerId: alice.id, connectionId: 'conn-Alice-2' }]);
    expect(h.transport.ofType(alice, 'welcome')).toHaveLength(1);

    h.room.handleDisconnect(alice, 'conn-Alice');
    expect(alice.connected).toBe(true);
    h.room.handleDisconnect(alice, 'conn-Alice-2');
    expect(alice.connected).toBe(false);
  });

  it('ends the turn with drawerLeft after the drawer grace period unless they rejoin', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob] = players;
    const { word } = pick(h, players);
    h.room.handleMessage(bob, { t: 'chat', text: word });
    const bobScore = bob.score;

    h.room.handleDisconnect(alice);
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS - 1);
    expect(h.room.phaseKind).toBe('drawing');
    h.room.rejoin(alice.token, 'conn-Alice-2');
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS);
    expect(h.room.phaseKind).toBe('drawing');

    h.room.handleDisconnect(alice);
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS);
    const end = expectPhase(h.room, 'turnEnd');
    expect(end.reason).toBe('drawerLeft');
    expect(alice.score).toBe(0);
    expect(end.points).toEqual({ [bob.id]: bobScore });
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

  it('returns to the lobby when connected players stay below the minimum after a short grace', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.transport.clear();

    h.room.handleDisconnect(bob);
    // A dropped socket gets a short grace (reloads are common) before the game is abandoned.
    expect(h.room.phaseKind).toBe('drawing');
    expect(h.transport.last(alice, 'room').room.players.find((p) => p.id === bob.id)?.connected).toBe(false);
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS - 1);
    expect(h.room.phaseKind).toBe('drawing');
    vi.advanceTimersByTime(1);
    expect(h.room.phaseKind).toBe('lobby');
    expect(h.transport.chats(alice)).toEqual([{ kind: 'system', text: 'Not enough players — back to the lobby.' }]);
    const state = h.transport.last(alice, 'room').room;
    expect(state.round).toBe(0);
    expect(state.players.every((p) => p.score === 0)).toBe(true);
    expect(h.transport.ofType(alice, 'clear')).toHaveLength(1);
    // Timers were cancelled: nothing changes later.
    vi.advanceTimersByTime(600_000);
    expect(h.room.phaseKind).toBe('lobby');
  });

  it('keeps the game running when the missing player rejoins within the grace', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [, bob] = players;
    const { word } = pick(h, players);
    h.room.handleDisconnect(bob);
    vi.advanceTimersByTime(DRAWER_DISCONNECT_GRACE_MS - 1);
    expect(h.room.rejoin(bob.token, 'bob-2').ok).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(h.room.phaseKind).toBe('drawing');
    h.room.handleMessage(bob, { t: 'chat', text: word });
    expect(bob.score).toBeGreaterThan(0);
    expect(h.room.phaseKind).toBe('turnEnd');
  });

  it('abandons the game at the next turn boundary when a turn ends with too few players', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    const { word } = pick(h, players);
    h.room.handleMessage(bob, { t: 'chat', text: word });
    expect(h.room.phaseKind).toBe('turnEnd');
    h.transport.clear();
    h.room.handleDisconnect(bob);
    expect(h.room.phaseKind).toBe('turnEnd');
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000);
    expect(h.room.phaseKind).toBe('lobby');
    expect(h.transport.chats(alice)).toEqual([{ kind: 'system', text: 'Not enough players — back to the lobby.' }]);
    // The pending low-player check was cancelled by the reset; only Bob's seat expiring follows.
    vi.advanceTimersByTime(600_000);
    expect(h.transport.chats(alice)).toEqual([
      { kind: 'system', text: 'Not enough players — back to the lobby.' },
      { kind: 'system', text: 'Bob left' },
    ]);
  });

  it('ends the turn when the only remaining non-drawer has already guessed and the other disconnects', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [, bob, carol] = players;
    const { word } = pick(h, players);
    h.room.handleMessage(bob, { t: 'chat', text: word });
    h.room.handleDisconnect(carol);
    expect(expectPhase(h.room, 'turnEnd').reason).toBe('allGuessed');
  });
});

describe('Room: kicks and host powers', () => {
  it('lets the host kick: kicked message, socket close, token invalidated', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    const bob = h.join('Bob');
    const carol = h.join('Carol');
    const token = bob.token;
    h.room.handleMessage(bob, { t: 'kick', playerId: carol.id });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
    h.room.handleMessage(alice, { t: 'kick', playerId: alice.id });
    h.room.handleMessage(alice, { t: 'kick', playerId: 'ghost' });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
    h.transport.clear();

    h.room.handleMessage(alice, { t: 'kick', playerId: bob.id });
    expect(h.transport.last(bob, 'kicked').reason).toMatch(/host/);
    expect(h.transport.closed).toEqual([bob.id]);
    expect(h.room.playerCount).toBe(2);
    expect(h.room.rejoin(token, 'x')).toMatchObject({ ok: false, code: 'REJOIN_FAILED' });
    expect(h.transport.chats(carol)).toEqual([{ kind: 'system', text: 'Bob was kicked' }]);
    expect(h.transport.last(carol, 'room').room.players.map((p) => p.name)).toEqual(['Alice', 'Carol']);
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
    h.room.handleMessage(carol, { t: 'chat', text: word });
    h.room.handleMessage(alice, { t: 'kick', playerId: bob.id });
    const end = expectPhase(h.room, 'turnEnd');
    expect(end.reason).toBe('drawerLeft');
    expect(end.points).toEqual({ [carol.id]: carol.turnPoints });
    expect(h.room.getState(null).players.map((p) => p.name)).toEqual(['Alice', 'Carol']);
  });

  it('vote-kicks on a majority of the other connected players and resets votes on state changes', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    const bob = h.join('Bob');
    const carol = h.join('Carol');
    const dave = h.join('Dave');
    h.transport.clear();

    h.room.handleMessage(alice, { t: 'voteKick', playerId: alice.id });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
    h.room.handleMessage(alice, { t: 'voteKick', playerId: dave.id });
    // others = 3 connected excluding Dave -> need 2 votes.
    expect(h.transport.chats(bob)).toEqual([{ kind: 'system', text: 'Alice voted to kick Dave (1/2)' }]);
    h.room.handleMessage(alice, { t: 'voteKick', playerId: dave.id });
    expect(h.transport.chats(bob)).toHaveLength(1);
    expect(h.room.playerCount).toBe(4);

    // Target state change clears the votes.
    h.room.handleDisconnect(dave);
    h.room.rejoin(dave.token, 'conn-Dave-2');
    h.transport.clear();
    h.room.handleMessage(bob, { t: 'voteKick', playerId: dave.id });
    expect(h.transport.chats(carol)).toEqual([{ kind: 'system', text: 'Bob voted to kick Dave (1/2)' }]);
    h.room.handleMessage(carol, { t: 'voteKick', playerId: dave.id });
    expect(h.room.playerCount).toBe(3);
    expect(h.transport.last(dave, 'kicked').reason).toMatch(/vote/);
    expect(h.transport.closed).toEqual([dave.id]);
    expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'system', text: 'Dave was kicked' });
  });

  it('counts the majority only over connected players', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    const bob = h.join('Bob');
    const carol = h.join('Carol');
    h.join('Dave');
    h.join('Eve');
    h.room.handleDisconnect(bob);
    h.room.handleDisconnect(carol);
    // Connected others excluding Eve: Alice, Dave -> need 2.
    const eve = h.room.listPlayers()[4];
    h.room.handleMessage(alice, { t: 'voteKick', playerId: eve.id });
    expect(h.room.playerCount).toBe(5);
    h.room.handleMessage(h.room.listPlayers()[3], { t: 'voteKick', playerId: eve.id });
    expect(h.room.playerCount).toBe(4);
  });
});

describe('Room: settings, profile and ratings', () => {
  it('validates settings patches: host only, lobby only, invariants applied', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    const bob = h.join('Bob');
    h.room.handleMessage(bob, { t: 'updateSettings', settings: { rounds: 5 } });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
    expect(h.room.settings.rounds).toBe(DEFAULT_SETTINGS.rounds);
    h.transport.clear();

    h.room.handleMessage(alice, { t: 'updateSettings', settings: { rounds: 5, customWords: ['cat', ' Dog ', 'cat', 'hot  dog'], customWordsOnly: true, maxPlayers: 2 } });
    expect(h.room.settings).toMatchObject({ rounds: 5, customWords: ['cat', 'Dog', 'hot dog'], customWordsOnly: false, maxPlayers: 2 });
    expect(h.transport.ofType(bob, 'room')).toHaveLength(1);
    expect(h.transport.last(bob, 'room').room.settings.rounds).toBe(5);
    expect(h.room.join('Carol', AVATAR, 'c')).toMatchObject({ ok: false, code: 'ROOM_FULL' });

    // maxPlayers can never drop below the current occupancy.
    h.room.handleMessage(alice, { t: 'updateSettings', settings: { maxPlayers: 12 } });
    h.join('Carol');
    h.room.handleMessage(alice, { t: 'updateSettings', settings: { maxPlayers: 2 } });
    expect(h.room.settings.maxPlayers).toBe(3);
    expect(h.room.join('Dave', AVATAR, 'd')).toMatchObject({ ok: false, code: 'ROOM_FULL' });

    h.room.handleMessage(alice, { t: 'start' });
    h.room.handleMessage(alice, { t: 'updateSettings', settings: { rounds: 1 } });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
    expect(h.room.settings.rounds).toBe(5);
  });

  it('updates profiles in the lobby only', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    const bob = h.join('Bob');
    h.transport.clear();
    h.room.handleMessage(bob, { t: 'updateProfile', name: 'Bobby', avatar: { color: 3, emoji: 4 } });
    expect(bob.name).toBe('Bobby');
    expect(h.transport.last(alice, 'room').room.players[1]).toMatchObject({ name: 'Bobby', avatar: { color: 3, emoji: 4 } });
    h.room.handleMessage(alice, { t: 'start' });
    h.room.handleMessage(bob, { t: 'updateProfile', name: 'Rob' });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
    expect(bob.name).toBe('Bobby');
  });

  it('tracks likes/dislikes per recipient and toggles on repeat', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    h.room.handleMessage(bob, { t: 'rate', value: 'like' });
    expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
    pick(h, players);
    h.transport.clear();

    h.room.handleMessage(bob, { t: 'rate', value: 'like' });
    h.room.handleMessage(carol, { t: 'rate', value: 'dislike' });
    expect(expectPhase(h.room, 'drawing', bob)).toMatchObject({ likes: 1, dislikes: 1, myRating: 'like' });
    expect(expectPhase(h.room, 'drawing', carol)).toMatchObject({ likes: 1, dislikes: 1, myRating: 'dislike' });
    expect(expectPhase(h.room, 'drawing', alice)).not.toHaveProperty('myRating');
    expect(h.transport.ofType(alice, 'room')).toHaveLength(2);

    h.room.handleMessage(bob, { t: 'rate', value: 'like' });
    expect(expectPhase(h.room, 'drawing', bob)).toMatchObject({ likes: 0, dislikes: 1 });
    expect(expectPhase(h.room, 'drawing', bob)).not.toHaveProperty('myRating');
    h.room.handleMessage(carol, { t: 'rate', value: 'like' });
    expect(expectPhase(h.room, 'drawing', bob)).toMatchObject({ likes: 1, dislikes: 0 });

    h.room.handleMessage(alice, { t: 'rate', value: 'like' });
    expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
  });
});

describe('Room: snapshots', () => {
  it('builds per-recipient state with sorted players and the right visibility', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = players;
    const forAlice = h.room.getState(alice);
    const forBob = h.room.getState(bob);
    expect(forAlice.players.map((p) => p.joinOrder)).toEqual([0, 1, 2]);
    expect(forAlice.phase).toMatchObject({ kind: 'choosing', choices: ['apple', 'banana', 'cherry'] });
    expect(forBob.phase).not.toHaveProperty('choices');
    expect(h.room.getState(null).phase).not.toHaveProperty('choices');

    const { word } = pick(h, players);
    h.room.handleMessage(bob, { t: 'chat', text: word });
    expect(h.room.getState(alice).phase).toMatchObject({ kind: 'drawing', word });
    expect(h.room.getState(bob).phase).toMatchObject({ kind: 'drawing', word });
    expect(h.room.getState(carol).phase).not.toHaveProperty('word');
    expect(h.room.getState(null).phase).not.toHaveProperty('word');
    const alicePublic = h.room.getState(carol).players.find((p) => p.id === alice.id);
    expect(alicePublic?.guessedThisTurn).toBe(true);
    expect(h.room.getState(null).serverTime).toBe(Date.now());
  });

  it('does not send snapshots for plain chat or draw traffic', () => {
    const h = createHarness();
    const players = startGame(h, ['Alice', 'Bob']);
    const [alice, bob] = players;
    pick(h, players);
    h.transport.clear();
    h.room.handleMessage(bob, { t: 'chat', text: 'hmm' });
    h.room.handleMessage(alice, { t: 'draw', ops: [{ k: 'fill', x: 1, y: 1, color: '#000000' }] });
    expect(h.transport.ofType(alice, 'room')).toHaveLength(0);
    expect(h.transport.ofType(bob, 'room')).toHaveLength(0);
  });

  it('ignores messages from players who are no longer in the room', () => {
    const h = createHarness();
    const alice = h.join('Alice');
    const bob = h.join('Bob');
    h.room.leave(bob);
    h.transport.clear();
    h.room.handleMessage(bob, { t: 'chat', text: 'ghost' });
    expect(h.transport.of(alice)).toEqual([]);
    expect(phaseOf(h.room)).toEqual({ kind: 'lobby' });
  });
});
