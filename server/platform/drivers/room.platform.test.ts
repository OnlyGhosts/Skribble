/**
 * Platform behaviour that must hold whatever game the room runs: seats, hosts, kicks, votes,
 * settings, profiles, chat, reconnects and the lobby. Every scenario runs against both game modules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_HISTORY_LENGTH, EMPTY_ROOM_TTL_MS, RECONNECT_GRACE_MS } from '../../../shared/platform/constants.js';
import { GAME_IDS, GAME_LIST, gameById, type GameId } from '../../../shared/platform/games.js';
import { ROOM_HARD_CAP } from '../../../shared/platform/settings.js';
import { GAMES } from '../../games/index.js';
import { GAME_TEST_FIXTURES, enoughNames } from '../../games/testFixtures.js';
import { previewOf } from '../engine/view.js';
import { AVATAR, createHarness, readyUp, startGame, templateView, type Harness } from './testUtils.js';

const START = new Date('2026-01-01T12:00:00Z').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(GAME_IDS)('platform room (%s)', (gameId: GameId) => {
  const harness = (): Harness => createHarness({ gameId });
  const meta = gameById(gameId);
  /** The smallest room this game can run: scenarios written for two seats grow to the game's minimum. */
  const smallest = Math.max(2, meta.minPlayers);
  /** Seats filler players after `seated` names until the room holds `total`. */
  const fill = (h: Harness, seated: number, total: number): string[] => Array.from({ length: Math.max(0, total - seated) }, (_, i) => h.join(`Guest${i + 1}`));

  describe('seats', () => {
    it('makes the first joiner host and sends welcome / snapshot / system message', () => {
      const h = harness();
      const alice = h.join('Alice');
      expect(h.room.hostPlayerId).toBe(alice);
      const welcome = h.transport.last(alice, 'welcome');
      expect(welcome.playerId).toBe(alice);
      expect(welcome.token).toBe(h.token(alice));
      expect(welcome.token).toMatch(/^[0-9a-f]{32}$/);
      expect(welcome.room).toMatchObject({ code: 'ABCD', gameId, hostId: alice, phase: 'lobby', podium: null, game: null, serverTime: START });
      expect(welcome.room.players).toHaveLength(1);
      expect(welcome.room.players[0]).toEqual({ id: alice, name: 'Alice', avatar: AVATAR, score: 0, isHost: true, connected: true, joinOrder: 0, ready: false, sittingOut: false, participating: false });
      expect(welcome.chat.map((c) => c.text)).toEqual(['Alice joined']);
      expect(h.transport.attached).toEqual([{ playerId: alice, connectionId: 'conn-Alice' }]);

      h.transport.clear();
      const bob = h.join('Bob');
      expect(h.transport.ofType(alice, 'room')).toHaveLength(1);
      expect(h.transport.last(alice, 'room').room.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
      expect(h.transport.chats(alice)).toEqual([{ kind: 'system', text: 'Bob joined' }]);
      // The joiner gets the join notice through the welcome history, not twice.
      expect(h.transport.ofType(bob, 'chat')).toHaveLength(0);
      expect(h.transport.last(bob, 'welcome').chat.map((c) => c.text)).toEqual(['Alice joined', 'Bob joined']);
      expect(h.player(bob).joinOrder).toBe(1);
    });

    it('starts from the game defaults merged with the platform defaults', () => {
      const h = harness();
      const alice = h.join('Alice');
      const { settings } = h.transport.last(alice, 'welcome').room;
      expect(settings).toMatchObject({ allowMidGameJoin: true, contentMode: 'family' });
      expect(settings).toMatchObject(GAMES[gameId].settings.defaults as Record<string, unknown>);
    });

    it('rejects joins only at the room hard cap (counting players in grace); games never cap the party', () => {
      const h = harness();
      h.join('Alice');
      const bob = h.join('Bob');
      fill(h, 2, ROOM_HARD_CAP);
      expect(h.room.playerCount).toBe(ROOM_HARD_CAP);
      expect(h.room.join('Carol', AVATAR, 'c')).toMatchObject({ ok: false, code: 'ROOM_FULL' });
      expect(previewOf(h.room.state)).toMatchObject({ players: ROOM_HARD_CAP, maxPlayers: meta.maxPlayers ?? ROOM_HARD_CAP, joinable: false });
      h.room.handleDisconnect(bob);
      expect(h.room.isFull).toBe(true);
      expect(h.room.join('Carol', AVATAR, 'c')).toMatchObject({ ok: false, code: 'ROOM_FULL' });
      vi.advanceTimersByTime(RECONNECT_GRACE_MS);
      expect(h.room.join('Carol', AVATAR, 'c').ok).toBe(true);
    });

    it('removes a leaving player immediately and transfers host to the longest-connected player', () => {
      const h = harness();
      const alice = h.join('Alice');
      vi.advanceTimersByTime(1000);
      const bob = h.join('Bob');
      vi.advanceTimersByTime(1000);
      const carol = h.join('Carol');
      // Bob reconnects later than Carol joined, so Carol is the longest-connected.
      h.room.handleDisconnect(bob);
      vi.advanceTimersByTime(1000);
      expect(h.room.rejoin(h.token(bob), 'conn-Bob-2').ok).toBe(true);
      h.transport.clear();

      h.room.leave(alice);
      expect(h.room.playerCount).toBe(2);
      expect(h.room.hostPlayerId).toBe(carol);
      expect(h.transport.chats(bob).map((c) => c.text)).toEqual(['Alice left', 'Carol is now the host']);
      expect(h.transport.last(carol, 'room').room.players.find((p) => p.name === 'Carol')?.isHost).toBe(true);
      expect(h.token(alice)).toBe('');
    });

    it('hands the host role to a connected player while the host is disconnected and back on rejoin', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      h.room.handleDisconnect(bob);
      h.transport.clear();
      h.room.handleDisconnect(alice);
      // Nobody should be locked out of start / settings / kick for the 60 s grace.
      expect(h.room.hostPlayerId).toBe(carol);
      expect(h.transport.chats(carol).map((c) => c.text)).toEqual(['Carol is now the host']);
      expect(h.transport.last(carol, 'room').room.hostId).toBe(carol);
      h.send(carol, { t: 'updateSettings', settings: { allowMidGameJoin: false } });
      expect(h.room.settings.allowMidGameJoin).toBe(false);

      // The original host gets the role back when they come back...
      h.transport.clear();
      const token = h.token(alice);
      expect(h.room.rejoin(token, 'conn-Alice-2').ok).toBe(true);
      expect(h.room.hostPlayerId).toBe(alice);
      expect(h.transport.last(alice, 'welcome').room.hostId).toBe(alice);
      expect(h.transport.chats(carol).map((c) => c.text)).toEqual(['Alice is the host again', 'Alice reconnected']);
      expect(h.transport.last(carol, 'room').room.hostId).toBe(alice);

      // ...but not when their seat expired: the stand-in keeps it.
      h.room.handleDisconnect(alice);
      expect(h.room.hostPlayerId).toBe(carol);
      vi.advanceTimersByTime(RECONNECT_GRACE_MS);
      expect(h.room.playerCount).toBe(1);
      expect(h.room.hostPlayerId).toBe(carol);
    });

    it('keeps the host when nobody else is connected and lets guests start after the host drops', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      // Enough guests stay connected (and ready) to start once the host has dropped.
      const guests = fill(h, 3, meta.minPlayers + 1);
      readyUp(h, [carol, ...guests]);
      h.room.handleDisconnect(alice);
      expect(h.room.hostPlayerId).toBe(bob);
      h.send(bob, { t: 'start' });
      expect(h.room.phase).toBe('playing');
      expect(h.transport.errors(bob)).toEqual([]);

      const solo = harness();
      const dana = solo.join('Dana');
      solo.room.handleDisconnect(dana);
      expect(solo.room.hostPlayerId).toBe(dana);

      // Players arriving during the lone host's grace are not locked out: the first one stands in...
      const eve = solo.join('Eve');
      expect(solo.room.hostPlayerId).toBe(eve);
      const frank = solo.join('Frank');
      readyUp(solo, [frank, ...fill(solo, 2, meta.minPlayers)]);
      solo.send(eve, { t: 'start' });
      expect(solo.room.phase).toBe('playing');
      expect(solo.transport.errors(eve)).toEqual([]);
      // ...and the host takes the role back when they return.
      expect(solo.room.rejoin(solo.token(dana), 'dana-2').ok).toBe(true);
      expect(solo.room.hostPlayerId).toBe(dana);
    });

    it('fires onEmpty when the last seat is released and resets the room for the next group', () => {
      const h = harness();
      const players = startGame(h, ['Alice', 'Bob']);
      expect(h.emptied).toHaveLength(0);
      for (const p of players) h.room.leave(p);
      expect(h.emptied).toEqual([h.room]);
      expect(h.room.isEmpty).toBe(true);
      expect(h.room.hostPlayerId).toBe('');
      expect(h.room.state).toMatchObject({ phase: 'lobby', game: null, podium: null, votes: [], kickedTokens: [] });
      expect(h.room.state.grace.emptyRoomAt).toBe(Date.now() + EMPTY_ROOM_TTL_MS);
      const carol = h.join('Carol');
      expect(h.transport.last(carol, 'welcome').room).toMatchObject({ phase: 'lobby', game: null, hostId: carol });
    });
  });

  describe('start preconditions', () => {
    it('only the host may start, and only with enough players ready (connected, not sitting out; the host counts by pressing start)', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const guests = fill(h, 2, meta.minPlayers);
      h.send(bob, { t: 'start' });
      expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
      expect(h.room.phase).toBe('lobby');

      if (meta.minPlayers === 1) readyUp(h, [bob, ...guests]);
      else {
        // Nobody but the host is ready yet.
        h.send(alice, { t: 'start' });
        expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
        expect(h.transport.last(alice, 'error').message).toBe(`You need at least ${meta.minPlayers} players ready to start.`);
        expect(h.room.phase).toBe('lobby');
        readyUp(h, [bob, ...guests]);
        // A ready player who dropped does not count until they are back.
        h.room.handleDisconnect(bob);
        h.send(alice, { t: 'start' });
        expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
        expect(h.room.phase).toBe('lobby');
        h.room.rejoin(h.token(bob), 'conn-Bob-2');
        expect(h.player(bob).ready).toBe(true);
      }
      h.transport.clear();
      h.send(alice, { t: 'start' });
      expect(h.room.phase).toBe('playing');
      expect(h.transport.chats(bob).map((c) => c.text)).toContain('The game has started!');
      // Everyone sees the new phase with the game's view attached.
      expect(h.transport.last(bob, 'room').room.phase).toBe('playing');
      expect(h.transport.last(bob, 'room').room.game).not.toBeNull();
      // Everyone who was ready plays; ready flags are spent by the start.
      for (const p of h.transport.last(bob, 'room').room.players) expect(p).toMatchObject({ participating: true, ready: false, sittingOut: false });
    });

    it('sits out the players who did not ready up (or sit out on purpose), keeping them in the party', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      const dave = h.join('Dave');
      const guests = fill(h, 4, meta.minPlayers + 2);
      readyUp(h, [bob, ...guests]);
      h.send(carol, { t: 'ready', ready: true });
      h.send(carol, { t: 'sitOut', sitOut: true });
      expect(h.player(carol)).toMatchObject({ ready: false, sittingOut: true });
      h.transport.clear();
      h.send(alice, { t: 'start' });
      expect(h.room.phase).toBe('playing');
      expect(h.transport.chats(alice).map((c) => c.text).slice(0, 2)).toEqual(['Carol and Dave sit this one out', 'The game has started!']);
      const state = h.transport.last(carol, 'room').room;
      expect(state.players.find((p) => p.id === carol)).toMatchObject({ participating: false, sittingOut: true, ready: false });
      expect(state.players.find((p) => p.id === dave)).toMatchObject({ participating: false, sittingOut: false, ready: false });
      expect(state.players.filter((p) => p.participating).map((p) => p.id)).toEqual([alice, bob, ...guests]);
      // Spectators keep getting snapshots and chat, and may not ready up until the game ends.
      expect(state.game).not.toBeNull();
      h.send(dave, { t: 'ready', ready: true });
      expect(h.transport.errors(dave)).toEqual(['NOT_ALLOWED']);
      expect(h.room.playerCount).toBe(Math.max(4, meta.minPlayers + 2));
    });

    it('cannot start twice', () => {
      const h = harness();
      const [alice] = startGame(h, ['Alice', 'Bob']);
      h.transport.clear();
      h.send(alice, { t: 'start' });
      expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
    });

    it('refuses game messages before the game runs and rejects malformed ones', () => {
      const h = harness();
      const alice = h.join('Alice');
      h.join('Bob');
      h.room.handleMessage(alice, { kind: 'game', msg: { t: 'nope' } });
      expect(h.transport.errors(alice)).toEqual(['INVALID_MESSAGE']);
      h.room.handleMessage(alice, { kind: 'game', msg: GAME_TEST_FIXTURES[gameId].validMessage });
      expect(h.transport.errors(alice)).toEqual(['INVALID_MESSAGE', 'NOT_ALLOWED']);
      expect(h.transport.last(alice, 'error').message).toBe('The game is not running.');
    });
  });

  describe('chat', () => {
    it('lets everyone chat in the lobby and caps the history', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      h.transport.clear();
      h.send(alice, { t: 'chat', text: 'apple' });
      expect(h.transport.chats(bob)).toEqual([{ kind: 'chat', text: 'apple' }]);
      expect(h.transport.last(bob, 'chat').message).toMatchObject({ playerId: alice, name: 'Alice', ts: START });

      for (let i = 0; i < CHAT_HISTORY_LENGTH + 10; i++) h.send(bob, { t: 'chat', text: `m${i}` });
      const carol = h.join('Carol');
      const history = h.transport.last(carol, 'welcome').chat;
      expect(history).toHaveLength(CHAT_HISTORY_LENGTH);
      expect(history.at(-1)?.text).toBe('Carol joined');
      expect(history.at(-2)?.text).toBe(`m${CHAT_HISTORY_LENGTH + 9}`);
      // Ids strictly increase.
      for (let i = 1; i < history.length; i++) expect(history[i].id).toBeGreaterThan(history[i - 1].id);
    });

    it('does not send snapshots for plain chat and ignores players who left', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      h.transport.clear();
      h.send(bob, { t: 'chat', text: 'hmm' });
      expect(h.transport.ofType(alice, 'room')).toHaveLength(0);
      h.room.leave(bob);
      h.transport.clear();
      h.send(bob, { t: 'chat', text: 'ghost' });
      expect(h.transport.of(alice)).toEqual([]);
    });
  });

  describe('reconnection', () => {
    it('keeps the seat and score through a disconnect and restores it on rejoin', () => {
      const h = harness();
      // The longest game there is, with one seat more than the minimum so Bob's absence never
      // holds it up; the seat must survive the whole grace whatever the game is doing by then.
      const names = enoughNames(gameId, ['Alice', 'Bob', 'Carol']);
      if (names.length < meta.minPlayers + 1) names.push('Guest1');
      const [alice, bob, carol] = startGame(h, names, GAME_TEST_FIXTURES[gameId].longSettings);
      h.transport.clear();

      h.room.handleDisconnect(bob, 'conn-Bob');
      expect(h.player(bob).connected).toBe(false);
      expect(h.room.playerCount).toBe(names.length);
      expect(h.transport.last(alice, 'room').room.players.find((p) => p.id === bob)?.connected).toBe(false);

      vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
      expect(h.room.playerCount).toBe(names.length);
      expect(h.room.phase).not.toBe('lobby');
      h.transport.clear();
      const result = h.room.rejoin(h.token(bob), 'conn-Bob-2');
      expect(result).toEqual({ ok: true, playerId: bob });
      expect(h.player(bob)).toMatchObject({ connected: true, connectionId: 'conn-Bob-2' });
      const welcome = h.transport.last(bob, 'welcome');
      expect(welcome.playerId).toBe(bob);
      expect(welcome.room.phase).toBe(h.room.phase);
      expect(welcome.room.players.find((p) => p.id === bob)).toMatchObject({ connected: true });
      expect(welcome.chat.length).toBeGreaterThan(0);
      expect(h.transport.chats(carol)).toEqual([{ kind: 'system', text: 'Bob reconnected' }]);
      expect(h.transport.last(carol, 'room').room.players.find((p) => p.id === bob)?.connected).toBe(true);
      // The seat survives well past the original grace deadline.
      vi.advanceTimersByTime(RECONNECT_GRACE_MS);
      expect(h.room.playerCount).toBe(names.length);
    });

    it('fails rejoin with unknown, expired or kicked tokens', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      expect(h.room.rejoin('nope', 'x')).toMatchObject({ ok: false, code: 'REJOIN_FAILED' });
      const bobToken = h.token(bob);
      h.room.handleDisconnect(bob);
      vi.advanceTimersByTime(RECONNECT_GRACE_MS);
      expect(h.room.playerCount).toBe(2);
      expect(h.room.rejoin(bobToken, 'x')).toMatchObject({ ok: false, code: 'REJOIN_FAILED' });
      const carolToken = h.token(carol);
      h.send(alice, { t: 'kick', playerId: carol });
      expect(h.room.rejoin(carolToken, 'x')).toMatchObject({ ok: false, code: 'REJOIN_FAILED', message: 'You were removed from this room.' });
    });

    it('replaces a stale socket on rejoin and ignores the stale socket closing later', () => {
      const h = harness();
      const alice = h.join('Alice');
      h.join('Bob');
      h.transport.clear();
      expect(h.room.rejoin(h.token(alice), 'conn-Alice-2').ok).toBe(true);
      expect(h.player(alice)).toMatchObject({ connected: true, connectionId: 'conn-Alice-2' });
      expect(h.transport.attached).toEqual([{ playerId: alice, connectionId: 'conn-Alice-2' }]);
      expect(h.transport.ofType(alice, 'welcome')).toHaveLength(1);
      // A socket replacement is not a reconnection: nobody is told.
      expect(h.transport.chats(alice)).toEqual([]);

      h.room.handleDisconnect(alice, 'conn-Alice');
      expect(h.player(alice).connected).toBe(true);
      h.room.handleDisconnect(alice, 'conn-Alice-2');
      expect(h.player(alice).connected).toBe(false);
    });

    if (meta.minPlayers > 1) {
      it('keeps the game through a disconnect and abandons it only when the missing seat expires', () => {
        const h = harness();
        const [alice, bob] = startGame(h, ['Alice', 'Bob'], GAME_TEST_FIXTURES[gameId].longSettings);
        h.transport.clear();
        h.room.handleDisconnect(bob);
        // A phone that locks or an app switch must never cost the room its game: the seat is held
        // for the whole grace and the game plays on or holds at its next boundary.
        expect(h.room.phase).toBe('playing');
        expect(h.transport.last(alice, 'room').room.players.find((p) => p.id === bob)?.connected).toBe(false);
        vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
        expect(h.room.phase).toBe('playing');
        expect(h.room.getPlayer(bob)).toBeDefined();
        vi.advanceTimersByTime(1);
        expect(h.room.phase).toBe('lobby');
        expect(h.room.getPlayer(bob)).toBeUndefined();
        expect(h.transport.chats(alice).slice(-2)).toEqual([
          { kind: 'system', text: 'Bob left' },
          { kind: 'system', text: 'Not enough players. Back to the lobby.' },
        ]);
        const state = h.transport.last(alice, 'room').room;
        expect(state.game).toBeNull();
        expect(state.waiting).toBeNull();
        expect(state.players.every((p) => p.score === 0)).toBe(true);
        // Timers were cancelled: nothing changes later.
        vi.advanceTimersByTime(600_000);
        expect(h.room.phase).toBe('lobby');
      });

      it('keeps the game running when the missing player rejoins within the grace', () => {
        const h = harness();
        const [, bob] = startGame(h, ['Alice', 'Bob'], GAME_TEST_FIXTURES[gameId].longSettings);
        h.room.handleDisconnect(bob);
        vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
        expect(h.room.phase).toBe('playing');
        expect(h.room.rejoin(h.token(bob), 'bob-2').ok).toBe(true);
        // The seat is no longer on a timer.
        vi.advanceTimersByTime(RECONNECT_GRACE_MS);
        expect(h.room.getPlayer(bob)).toBeDefined();
        expect(h.room.phase).not.toBe('lobby');
      });

      it('abandons the game at once when a player leaves and too few remain', () => {
        const h = harness();
        const [alice, bob] = startGame(h, ['Alice', 'Bob']);
        h.transport.clear();
        h.room.leave(bob);
        expect(h.room.phase).toBe('lobby');
        expect(h.transport.chats(alice).map((c) => c.text)).toEqual(['Bob left', 'Not enough players. Back to the lobby.']);
      });
    }
  });

  describe('kicks and host powers', () => {
    it('lets the host kick: kicked message, socket close, token invalidated', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      const token = h.token(bob);
      h.send(bob, { t: 'kick', playerId: carol });
      expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
      h.send(alice, { t: 'kick', playerId: alice });
      h.send(alice, { t: 'kick', playerId: 'ghost' });
      expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
      h.transport.clear();

      h.send(alice, { t: 'kick', playerId: bob });
      expect(h.transport.last(bob, 'kicked').reason).toMatch(/host/);
      expect(h.transport.closed).toEqual([bob]);
      expect(h.room.playerCount).toBe(2);
      expect(h.room.rejoin(token, 'x')).toMatchObject({ ok: false, code: 'REJOIN_FAILED' });
      expect(h.transport.chats(carol)).toEqual([{ kind: 'system', text: 'Bob was kicked' }]);
      expect(h.transport.last(carol, 'room').room.players.map((p) => p.name)).toEqual(['Alice', 'Carol']);
    });

    it('vote-kicks on a majority of the other connected players and resets votes on state changes', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      const dave = h.join('Dave');
      h.transport.clear();

      h.send(alice, { t: 'voteKick', playerId: alice });
      expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
      h.send(alice, { t: 'voteKick', playerId: dave });
      // others = 3 connected excluding Dave -> need 2 votes.
      expect(h.transport.chats(bob)).toEqual([{ kind: 'system', text: 'Alice voted to kick Dave (1/2)' }]);
      h.send(alice, { t: 'voteKick', playerId: dave });
      expect(h.transport.chats(bob)).toHaveLength(1);
      expect(h.room.playerCount).toBe(4);

      // The target cannot erase the tally by reconnecting...
      h.room.handleDisconnect(dave);
      h.room.rejoin(h.token(dave), 'conn-Dave-2');
      // ...but a voter dropping withdraws their vote.
      h.room.handleDisconnect(alice);
      h.room.rejoin(h.token(alice), 'conn-Alice-2');
      h.transport.clear();
      h.send(bob, { t: 'voteKick', playerId: dave });
      expect(h.transport.chats(carol)).toEqual([{ kind: 'system', text: 'Bob voted to kick Dave (1/2)' }]);
      h.send(carol, { t: 'voteKick', playerId: dave });
      expect(h.room.playerCount).toBe(3);
      expect(h.transport.last(dave, 'kicked').reason).toMatch(/vote/);
      expect(h.transport.closed).toEqual([dave]);
      expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'system', text: 'Dave was kicked' });
    });

    it('keeps votes against a target across their reconnect', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      const dave = h.join('Dave');
      h.join('Eve');
      h.send(alice, { t: 'voteKick', playerId: dave });
      h.send(bob, { t: 'voteKick', playerId: dave });
      h.room.handleDisconnect(dave);
      h.room.rejoin(h.token(dave), 'conn-Dave-2');
      h.transport.clear();
      h.send(carol, { t: 'voteKick', playerId: dave });
      expect(h.room.playerCount).toBe(4);
      expect(h.transport.last(dave, 'kicked').reason).toMatch(/vote/);
    });

    it('does not count votes cast by players who have since disconnected', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      h.join('Carol');
      const dave = h.join('Dave');
      h.send(alice, { t: 'voteKick', playerId: dave });
      h.room.handleDisconnect(alice);
      h.transport.clear();
      // Connected others: Bob, Carol -> 2 needed, and Alice's vote is gone.
      h.send(bob, { t: 'voteKick', playerId: dave });
      expect(h.room.playerCount).toBe(4);
      expect(h.transport.chats(bob)).toEqual([{ kind: 'system', text: 'Bob voted to kick Dave (1/2)' }]);
      expect(h.transport.ofType(dave, 'kicked')).toHaveLength(0);
    });

    it('re-evaluates pending votes when the threshold drops because someone left', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      const dave = h.join('Dave');
      const eve = h.join('Eve');
      // Others = 4 -> 3 needed.
      h.send(alice, { t: 'voteKick', playerId: eve });
      h.send(bob, { t: 'voteKick', playerId: eve });
      expect(h.transport.chats(carol).at(-1)).toEqual({ kind: 'system', text: 'Bob voted to kick Eve (2/3)' });
      expect(h.room.playerCount).toBe(5);
      h.room.leave(dave);
      // Others = 3 -> 2 needed: the two standing votes now carry.
      expect(h.room.playerCount).toBe(3);
      expect(h.transport.last(eve, 'kicked').reason).toMatch(/vote/);
      expect(h.room.getState(null).players.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Carol']);
    });

    it('refuses vote-kicks with fewer than two other connected players and never kicks on a single vote', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      h.transport.clear();
      h.send(bob, { t: 'voteKick', playerId: alice });
      expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
      expect(h.room.playerCount).toBe(2);
      expect(h.room.hostPlayerId).toBe(alice);
      expect(h.transport.chats(alice)).toEqual([]);

      // Three players, one disconnected: still only one other connected player.
      const carol = h.join('Carol');
      h.room.handleDisconnect(carol);
      h.send(bob, { t: 'voteKick', playerId: alice });
      expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
      expect(h.room.playerCount).toBe(3);

      // A vote in progress whose electorate shrinks to one other player is not decided by that one vote.
      h.room.rejoin(h.token(carol), 'conn-Carol-2');
      h.send(bob, { t: 'voteKick', playerId: alice });
      expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'system', text: 'Bob voted to kick Alice (1/2)' });
      h.room.handleDisconnect(carol);
      expect(h.room.playerCount).toBe(3);
      expect(h.room.hostPlayerId).toBe(alice);
    });

    it('counts the majority only over connected players', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      const dave = h.join('Dave');
      const eve = h.join('Eve');
      h.room.handleDisconnect(bob);
      h.room.handleDisconnect(carol);
      // Connected others excluding Eve: Alice, Dave -> need 2.
      h.send(alice, { t: 'voteKick', playerId: eve });
      expect(h.room.playerCount).toBe(5);
      h.send(dave, { t: 'voteKick', playerId: eve });
      expect(h.room.playerCount).toBe(4);
    });
  });

  describe('settings and profile', () => {
    it('validates settings patches: host only, lobby only, platform fields next to the game fields', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      h.send(bob, { t: 'updateSettings', settings: { contentMode: 'unhinged' } });
      expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
      expect(h.room.settings.contentMode).toBe('family');
      h.transport.clear();

      h.send(alice, { t: 'updateSettings', settings: { contentMode: 'unhinged', allowMidGameJoin: false } });
      expect(h.room.settings).toMatchObject({ contentMode: 'unhinged', allowMidGameJoin: false });
      expect(h.transport.ofType(bob, 'room')).toHaveLength(1);
      expect(h.transport.last(bob, 'room').room.settings.contentMode).toBe('unhinged');
      // The retired room cap is an unknown key now: stripped, never a limit.
      h.send(alice, { t: 'updateSettings', settings: { maxPlayers: 2 } });
      expect(h.room.settings).not.toHaveProperty('maxPlayers');
      fill(h, 2, smallest + 1);
      expect(h.room.join('Zed', AVATAR, 'z').ok).toBe(true);

      // Invalid values are refused as a whole; unknown keys are stripped, not refused.
      h.transport.clear();
      h.send(alice, { t: 'updateSettings', settings: { contentMode: 'filthy' } });
      expect(h.transport.errors(alice)).toEqual(['INVALID_MESSAGE']);
      // The retired middle tier is refused like any unknown mode.
      h.send(alice, { t: 'updateSettings', settings: { contentMode: 'cheeky' } });
      expect(h.transport.errors(alice)).toEqual(['INVALID_MESSAGE', 'INVALID_MESSAGE']);
      expect(h.room.settings.contentMode).toBe('unhinged');
      h.transport.clear();
      h.send(alice, { t: 'updateSettings', settings: { bogus: true, allowMidGameJoin: false } });
      expect(h.transport.errors(alice)).toEqual([]);
      expect(h.room.settings).not.toHaveProperty('bogus');
      expect(h.room.settings.allowMidGameJoin).toBe(false);

      readyUp(h, h.room.getState(null).players.map((p) => p.id));
      h.send(alice, { t: 'start' });
      expect(h.room.phase).toBe('playing');
      h.send(alice, { t: 'updateSettings', settings: { allowMidGameJoin: true } });
      expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
      expect(h.room.settings.allowMidGameJoin).toBe(false);
    });

    it('respects allowMidGameJoin', () => {
      const h = harness();
      startGame(h, ['Alice', 'Bob']);
      const carol = h.join('Carol');
      expect(h.transport.last(carol, 'welcome').room.phase).toBe('playing');
      expect(h.transport.last(carol, 'welcome').room.game).not.toBeNull();

      const closed = harness();
      startGame(closed, ['Alice', 'Bob'], { allowMidGameJoin: false });
      expect(closed.room.join('Carol', AVATAR, 'c')).toMatchObject({ ok: false, code: 'GAME_IN_PROGRESS' });
      expect(closed.room.isJoinable).toBe(false);
    });

    it('updates profiles in the lobby only', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      readyUp(h, [bob, ...fill(h, 2, meta.minPlayers)]);
      h.transport.clear();
      h.send(bob, { t: 'updateProfile', name: 'Bobby', avatar: { color: 3, emoji: 4 } });
      expect(h.player(bob).name).toBe('Bobby');
      expect(h.transport.last(alice, 'room').room.players[1]).toMatchObject({ name: 'Bobby', avatar: { color: 3, emoji: 4 } });
      h.send(alice, { t: 'start' });
      h.send(bob, { t: 'updateProfile', name: 'Rob' });
      expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
      expect(h.player(bob).name).toBe('Bobby');
    });
  });

  describe('lobby return', () => {
    it('only the host returns to the lobby, and only after the game ended; scores and the podium reset', () => {
      const h = harness();
      const [alice, bob] = startGame(h, ['Alice', 'Bob']);
      h.send(alice, { t: 'returnToLobby' });
      expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
      // Run the game to its end with the clock (both games end on their own).
      vi.advanceTimersByTime(10 * 60_000);
      expect(h.room.phase).toBe('ended');
      expect(h.room.state.podium).not.toBeNull();
      expect(h.transport.chats(alice).at(-1)?.text).toMatch(/^Game over!/);
      // The podium persists until the host returns to the lobby.
      vi.advanceTimersByTime(600_000);
      expect(h.room.phase).toBe('ended');
      h.send(bob, { t: 'returnToLobby' });
      expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
      // On the podium everyone may already ready up (or sit the next one out) for the next game...
      h.send(bob, { t: 'ready', ready: true });
      expect(h.transport.last(alice, 'room').room.players.find((p) => p.id === bob)).toMatchObject({ ready: true, participating: true });
      h.transport.clear();
      h.send(alice, { t: 'returnToLobby' });
      const lobby = h.transport.last(bob, 'room').room;
      expect(lobby).toMatchObject({ phase: 'lobby', podium: null, game: null, gameId });
      expect(lobby.players.every((p) => p.score === 0 && !p.participating)).toBe(true);
      // ...and those flags survive the trip back to the lobby, so "play again" is one tap.
      expect(lobby.players.find((p) => p.id === bob)?.ready).toBe(true);
      readyUp(h, lobby.players.map((p) => p.id).filter((id) => id !== alice && id !== bob));
      h.send(alice, { t: 'start' });
      expect(h.room.phase).toBe('playing');
    });
  });

  describe('party', () => {
    const other = GAME_LIST.find((g) => g.id !== gameId)?.id;
    if (!other) throw new Error('need two games');

    it('lets the host switch the game in the lobby: game settings reset, platform settings and ready flags kept, everyone told', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      h.send(alice, { t: 'updateSettings', settings: { ...GAME_TEST_FIXTURES[gameId].settings, contentMode: 'unhinged' } });
      h.send(bob, { t: 'ready', ready: true });
      h.send(bob, { t: 'selectGame', gameId: other });
      expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
      expect(h.room.gameId).toBe(gameId);
      h.transport.clear();

      // Switching to the game already on is nothing.
      h.send(alice, { t: 'selectGame', gameId });
      expect(h.transport.of(bob)).toEqual([]);

      h.send(alice, { t: 'selectGame', gameId: other });
      expect(h.room.gameId).toBe(other);
      expect(h.room.state.version).toBeGreaterThan(0);
      const state = h.transport.last(bob, 'room').room;
      expect(state.gameId).toBe(other);
      expect(state.settings).toEqual({ allowMidGameJoin: true, contentMode: 'unhinged', ...(GAMES[other].settings.defaults as Record<string, unknown>) });
      for (const key of Object.keys(GAMES[gameId].settings.defaults as Record<string, unknown>)) {
        if (!(key in (GAMES[other].settings.defaults as Record<string, unknown>))) expect(state.settings).not.toHaveProperty(key);
      }
      expect(state.players.find((p) => p.id === bob)?.ready).toBe(true);
      expect(h.transport.chats(bob)).toEqual([{ kind: 'system', text: `Host switched the party to ${gameById(other).name}` }]);
      expect(previewOf(h.room.state)).toMatchObject({ gameId: other });
      const carol = h.join('Carol');
      expect(h.transport.last(carol, 'welcome').room.gameId).toBe(other);

      // The party then plays the new game, and returns to its lobby afterwards.
      readyUp(h, [carol, ...fill(h, 3, gameById(other).minPlayers)]);
      h.send(alice, { t: 'updateSettings', settings: GAME_TEST_FIXTURES[other].settings });
      h.send(alice, { t: 'start' });
      expect(h.room.phase).toBe('playing');
      expect(h.transport.last(bob, 'room').room.game).not.toBeNull();
      h.room.handleMessage(alice, { kind: 'game', msg: GAME_TEST_FIXTURES[other].validMessage });
      expect(h.transport.errors(alice)).toEqual([]);
      vi.advanceTimersByTime(60 * 60_000);
      expect(h.room.phase).toBe('ended');
      h.send(alice, { t: 'returnToLobby' });
      expect(h.room.phase).toBe('lobby');
      expect(h.room.gameId).toBe(other);
    });

    it('refuses to switch while a game runs or sits on the podium', () => {
      const h = harness();
      const [alice] = startGame(h, ['Alice', 'Bob']);
      h.send(alice, { t: 'selectGame', gameId: other });
      expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
      expect(h.room.gameId).toBe(gameId);
      vi.advanceTimersByTime(60 * 60_000);
      expect(h.room.phase).toBe('ended');
      h.send(alice, { t: 'selectGame', gameId: other });
      expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
      expect(h.room.gameId).toBe(gameId);
    });
  });

  describe('ready and sit-out', () => {
    it('toggles ready and sit-out between games only; sitting out clears ready and persists across games', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const guests = fill(h, 2, meta.minPlayers + 1);
      h.transport.clear();
      h.send(bob, { t: 'ready', ready: true });
      expect(h.transport.last(alice, 'room').room.players.find((p) => p.id === bob)).toMatchObject({ ready: true, sittingOut: false });
      h.send(bob, { t: 'sitOut', sitOut: true });
      expect(h.transport.last(alice, 'room').room.players.find((p) => p.id === bob)).toMatchObject({ ready: false, sittingOut: true });
      h.send(bob, { t: 'ready', ready: true });
      // Readying while sitting out is recorded but never seats them: sit-out wins until they come back in.
      expect(h.player(bob)).toMatchObject({ ready: true, sittingOut: true });
      h.send(bob, { t: 'sitOut', sitOut: false });
      expect(h.player(bob)).toMatchObject({ ready: true, sittingOut: false });
      h.send(bob, { t: 'sitOut', sitOut: true });

      readyUp(h, guests);
      h.send(alice, { t: 'start' });
      expect(h.room.phase).toBe('playing');
      expect(h.player(bob)).toMatchObject({ ready: false, sittingOut: true, participating: false });
      expect(h.transport.chats(alice).map((c) => c.text)).toContain('Bob sits this one out');
      h.send(bob, { t: 'sitOut', sitOut: false });
      expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
      expect(h.player(bob).sittingOut).toBe(true);

      vi.advanceTimersByTime(60 * 60_000);
      expect(h.room.phase).toBe('ended');
      // Still sitting out after the game, until Bob says otherwise.
      expect(h.player(bob).sittingOut).toBe(true);
      h.send(bob, { t: 'sitOut', sitOut: false });
      expect(h.player(bob).sittingOut).toBe(false);
    });

    it('seats a mid-game joiner in the game at once, and refuses game messages from spectators', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      expect(h.player(alice).participating).toBe(false);
      readyUp(h, [bob, ...fill(h, 3, meta.minPlayers + 1)]);
      h.send(alice, { t: 'updateSettings', settings: GAME_TEST_FIXTURES[gameId].settings });
      h.send(alice, { t: 'start' });
      expect(h.room.phase).toBe('playing');
      expect(h.player(carol).participating).toBe(false);
      const dave = h.join('Dave');
      expect(h.transport.last(dave, 'welcome').room.players.find((p) => p.id === dave)).toMatchObject({ participating: true, ready: false, sittingOut: false });
      h.transport.clear();
      h.room.handleMessage(carol, { kind: 'game', msg: GAME_TEST_FIXTURES[gameId].validMessage });
      expect(h.transport.errors(carol)).toEqual(['NOT_ALLOWED']);
      expect(h.transport.last(carol, 'error').message).toBe('You are sitting this game out.');
    });

    it('decides vote-kicks by the connected players in the game, spectators aside', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      const dave = h.join('Dave');
      const guests = fill(h, 4, meta.minPlayers + 1);
      // Dave sits out; Bob and Carol play with Alice and the fillers.
      readyUp(h, [bob, carol, ...guests]);
      h.send(dave, { t: 'sitOut', sitOut: true });
      h.send(alice, { t: 'start' });
      expect(h.room.phase).toBe('playing');
      h.transport.clear();
      // Others in the game, excluding Bob: Alice, Carol and the fillers.
      const needed = Math.max(2, Math.floor((2 + guests.length) / 2) + 1);
      h.send(alice, { t: 'voteKick', playerId: bob });
      expect(h.transport.chats(carol)).toEqual([{ kind: 'system', text: `Alice voted to kick Bob (1/${needed})` }]);
      // Spectators neither vote nor count towards the majority.
      h.send(dave, { t: 'voteKick', playerId: bob });
      expect(h.transport.errors(dave)).toEqual(['NOT_ALLOWED']);
      expect(h.transport.chats(carol)).toHaveLength(1);
      expect(h.room.playerCount).toBe(Math.max(4, meta.minPlayers + 1));
      h.send(carol, { t: 'voteKick', playerId: bob });
      if (needed === 2) expect(h.room.getPlayer(bob)).toBeUndefined();
      else expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'system', text: `Carol voted to kick Bob (2/${needed})` });
    });
  });

  describe('snapshots', () => {
    it('builds per-recipient state with sorted players and the spectator view', () => {
      const h = harness();
      const [alice, bob] = startGame(h, ['Alice', 'Bob', 'Carol']);
      const forAlice = h.room.getState(alice);
      expect(forAlice.players.map((p) => p.joinOrder)).toEqual([0, 1, 2]);
      expect(forAlice.gameId).toBe(gameId);
      expect(forAlice.game).not.toBeNull();
      expect(h.room.getState(bob).game).not.toBeNull();
      expect(h.room.getState(null).game).not.toBeNull();
      expect(h.room.getState(null).serverTime).toBe(Date.now());
      expect(JSON.stringify(forAlice)).not.toContain(h.token(alice));
    });
  });
});

describe('platform room: seat limits and spectators (Click Race)', () => {
  const template = gameById('template');

  it('seats the first ready players by join order up to the game seat limit and benches the rest', () => {
    template.maxPlayers = 2;
    try {
      const h = createHarness({ gameId: 'template' });
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      const carol = h.join('Carol');
      const dave = h.join('Dave');
      readyUp(h, [dave, carol, bob]);
      h.transport.clear();
      h.send(alice, { t: 'start' });
      expect(h.room.phase).toBe('playing');
      expect(h.transport.chats(alice).map((c) => c.text)).toEqual(['Click Race seats 2 players: Carol and Dave sit this one out', 'The game has started!']);
      const state = h.room.getState(null);
      expect(state.players.map((p) => p.participating)).toEqual([true, true, false, false]);
      expect(previewOf(h.room.state)).toMatchObject({ maxPlayers: 2 });
      // The game only ever sees its participants; the spectators are listed separately.
      expect(Object.keys(templateView(h.room).clicks).sort()).toEqual([alice, bob].sort());
      h.room.handleMessage(carol, { kind: 'game', msg: { t: 'click' } });
      expect(templateView(h.room).clicks[carol]).toBeUndefined();
      expect(h.transport.errors(carol)).toEqual(['NOT_ALLOWED']);
    } finally {
      template.maxPlayers = null;
    }
  });

  it('hands the game its participants and spectators, and aborts only when the participating seats drop below the minimum', () => {
    const h = createHarness({ gameId: 'skribble' });
    const alice = h.join('Alice');
    const bob = h.join('Bob');
    const carol = h.join('Carol');
    h.send(alice, { t: 'updateSettings', settings: GAME_TEST_FIXTURES.skribble.settings });
    readyUp(h, [bob]);
    h.send(alice, { t: 'start' });
    expect(h.room.phase).toBe('playing');
    const view = h.room.getState(carol);
    expect(view.players.map((p) => [p.id, p.participating])).toEqual([[alice, true], [bob, true], [carol, false]]);
    // Skribble's per-player view covers the participants only; the spectator still gets the snapshot.
    expect(Object.keys((view.game as { players: Record<string, unknown> }).players).sort()).toEqual([alice, bob].sort());
    // A spectator leaving never ends the game; a participant leaving below the minimum does.
    h.room.leave(carol);
    expect(h.room.phase).toBe('playing');
    h.room.leave(bob);
    expect(h.room.phase).toBe('lobby');
  });
});

describe('platform room: the end of a game', () => {
  it('keeps every seat, closes nothing and puts the podium in everyone\'s snapshot when the last click ends a Click Race', () => {
    const h = createHarness({ gameId: 'template' });
    const alice = h.join('Alice');
    const bob = h.join('Bob');
    const carol = h.join('Carol');
    h.send(alice, { t: 'updateSettings', settings: { targetClicks: 10 } });
    readyUp(h, [bob]);
    h.send(alice, { t: 'start' });
    h.transport.clear();
    for (let i = 0; i < 9; i++) h.send(bob, { t: 'click' });
    expect(h.room.phase).toBe('playing');
    h.send(bob, { t: 'click' });
    expect(h.room.phase).toBe('ended');
    expect(h.transport.closed).toEqual([]);
    for (const id of [alice, bob, carol]) {
      expect(h.room.getPlayer(id)).toBeDefined();
      expect(h.transport.ofType(id, 'kicked')).toEqual([]);
      expect(h.transport.errors(id)).toEqual([]);
      const last = h.transport.last(id, 'room').room;
      expect(last.phase).toBe('ended');
      expect(last.podium).toEqual([
        { playerId: bob, score: 100, rank: 1 },
        { playerId: alice, score: 0, rank: 2 },
      ]);
      expect(last.players.find((p) => p.id === id)?.connected).toBe(true);
    }
    expect(h.transport.chats(carol).at(-1)).toEqual({ kind: 'system', text: 'Game over! Bob wins with 100 points.' });
    expect(h.emptied).toEqual([]);
    // The podium stays until the host returns to the lobby, whatever the clock does.
    vi.advanceTimersByTime(60 * 60_000);
    expect(h.room.phase).toBe('ended');
    expect(h.room.playerCount).toBe(3);
    expect(h.transport.closed).toEqual([]);
    h.send(alice, { t: 'returnToLobby' });
    expect(h.room.phase).toBe('lobby');
    expect(h.room.playerCount).toBe(3);
  });

  it('keeps the guesser whose guess closes the last Skribble turn seated on the podium', () => {
    const h = createHarness({ gameId: 'skribble' });
    const [alice, bob] = startGame(h, ['Alice', 'Bob']);
    // Turn 1: Alice draws, Bob guesses; turn 2: Bob draws, Alice's guess is the last of the game.
    h.send(alice, { t: 'chooseWord', index: 0 });
    h.send(bob, { t: 'chat', text: 'apple' });
    vi.advanceTimersByTime(6000);
    h.send(bob, { t: 'chooseWord', index: 0 });
    h.transport.clear();
    h.send(alice, { t: 'chat', text: 'banana' });
    expect(h.score(alice)).toBeGreaterThan(0);
    vi.advanceTimersByTime(6000);
    expect(h.room.phase).toBe('ended');
    expect(h.transport.closed).toEqual([]);
    for (const id of [alice, bob]) {
      expect(h.room.getPlayer(id)).toMatchObject({ connected: true, participating: true });
      expect(h.transport.ofType(id, 'kicked')).toEqual([]);
      expect(h.transport.errors(id)).toEqual([]);
      const last = h.transport.last(id, 'room').room;
      expect(last.phase).toBe('ended');
      expect(last.podium?.map((e) => e.playerId).sort()).toEqual([alice, bob].sort());
      expect((last.game as { phase: { kind: string } }).phase.kind).toBe('gameOver');
    }
    expect(h.emptied).toEqual([]);
  });
});
