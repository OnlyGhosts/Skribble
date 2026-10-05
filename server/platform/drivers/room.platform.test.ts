/**
 * Platform behaviour that must hold whatever game the room runs: seats, hosts, kicks, votes,
 * settings, profiles, chat, reconnects and the lobby. Every scenario runs against both game modules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_HISTORY_LENGTH, EMPTY_ROOM_TTL_MS, LOW_PLAYERS_GRACE_MS, RECONNECT_GRACE_MS } from '../../../shared/platform/constants.js';
import { GAME_IDS, gameById, type GameId } from '../../../shared/platform/games.js';
import { GAMES } from '../../games/index.js';
import { GAME_TEST_FIXTURES } from '../../games/testFixtures.js';
import { AVATAR, createHarness, startGame, type Harness } from './testUtils.js';

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
      expect(welcome.room.players[0]).toEqual({ id: alice, name: 'Alice', avatar: AVATAR, score: 0, isHost: true, connected: true, joinOrder: 0 });
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
      expect(settings).toMatchObject({ maxPlayers: Math.min(12, meta.maxPlayers), allowMidGameJoin: true });
      expect(settings).toMatchObject(GAMES[gameId].settings.defaults as Record<string, unknown>);
    });

    it('rejects joins when the room is full (counting players in grace)', () => {
      const h = harness();
      const alice = h.join('Alice');
      h.send(alice, { t: 'updateSettings', settings: { maxPlayers: 2 } });
      const bob = h.join('Bob');
      expect(h.room.join('Carol', AVATAR, 'c')).toMatchObject({ ok: false, code: 'ROOM_FULL' });
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
      h.send(carol, { t: 'updateSettings', settings: { maxPlayers: 5 } });
      expect(h.room.settings.maxPlayers).toBe(5);

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
      h.join('Carol');
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
      solo.join('Frank');
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
    it('only the host may start, and only with enough connected players', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      h.send(bob, { t: 'start' });
      expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
      expect(h.room.phase).toBe('lobby');

      if (meta.minPlayers > 1) {
        h.room.handleDisconnect(bob);
        h.send(alice, { t: 'start' });
        expect(h.transport.errors(alice)).toEqual(['NOT_ALLOWED']);
        expect(h.transport.last(alice, 'error').message).toContain(`at least ${meta.minPlayers}`);
        expect(h.room.phase).toBe('lobby');
        h.room.rejoin(h.token(bob), 'conn-Bob-2');
      }
      h.transport.clear();
      h.send(alice, { t: 'start' });
      expect(h.room.phase).toBe('playing');
      expect(h.transport.chats(bob).map((c) => c.text)).toContain('The game has started!');
      // Everyone sees the new phase with the game's view attached.
      expect(h.transport.last(bob, 'room').room.phase).toBe('playing');
      expect(h.transport.last(bob, 'room').room.game).not.toBeNull();
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
      // Long enough that the game is still running when the grace runs out.
      const [alice, bob, carol] = startGame(h, ['Alice', 'Bob', 'Carol'], GAME_TEST_FIXTURES[gameId].longSettings);
      h.transport.clear();

      h.room.handleDisconnect(bob, 'conn-Bob');
      expect(h.player(bob).connected).toBe(false);
      expect(h.room.playerCount).toBe(3);
      expect(h.transport.last(alice, 'room').room.players.find((p) => p.id === bob)?.connected).toBe(false);

      vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
      h.transport.clear();
      const result = h.room.rejoin(h.token(bob), 'conn-Bob-2');
      expect(result).toEqual({ ok: true, playerId: bob });
      expect(h.player(bob)).toMatchObject({ connected: true, connectionId: 'conn-Bob-2' });
      const welcome = h.transport.last(bob, 'welcome');
      expect(welcome.playerId).toBe(bob);
      expect(welcome.room.phase).toBe('playing');
      expect(welcome.room.players.find((p) => p.id === bob)).toMatchObject({ connected: true });
      expect(welcome.chat.length).toBeGreaterThan(0);
      expect(h.transport.chats(carol)).toEqual([{ kind: 'system', text: 'Bob reconnected' }]);
      expect(h.transport.last(carol, 'room').room.players.find((p) => p.id === bob)?.connected).toBe(true);
      // The seat survives well past the original grace deadline.
      vi.advanceTimersByTime(RECONNECT_GRACE_MS);
      expect(h.room.playerCount).toBe(3);
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
      it('returns to the lobby when connected players stay below the minimum after a short grace', () => {
        const h = harness();
        const [alice, bob] = startGame(h, ['Alice', 'Bob']);
        h.transport.clear();
        h.room.handleDisconnect(bob);
        // A dropped socket gets a short grace (reloads are common) before the game is abandoned.
        expect(h.room.phase).toBe('playing');
        expect(h.transport.last(alice, 'room').room.players.find((p) => p.id === bob)?.connected).toBe(false);
        vi.advanceTimersByTime(LOW_PLAYERS_GRACE_MS - 1);
        expect(h.room.phase).toBe('playing');
        vi.advanceTimersByTime(1);
        expect(h.room.phase).toBe('lobby');
        expect(h.transport.chats(alice).at(-1)).toEqual({ kind: 'system', text: 'Not enough players — back to the lobby.' });
        const state = h.transport.last(alice, 'room').room;
        expect(state.game).toBeNull();
        expect(state.players.every((p) => p.score === 0)).toBe(true);
        // Timers were cancelled: nothing changes later.
        vi.advanceTimersByTime(600_000);
        expect(h.room.phase).toBe('lobby');
      });

      it('keeps the game running when the missing player rejoins within the grace', () => {
        const h = harness();
        const [, bob] = startGame(h, ['Alice', 'Bob']);
        h.room.handleDisconnect(bob);
        vi.advanceTimersByTime(LOW_PLAYERS_GRACE_MS - 1);
        expect(h.room.rejoin(h.token(bob), 'bob-2').ok).toBe(true);
        vi.advanceTimersByTime(LOW_PLAYERS_GRACE_MS);
        expect(h.room.phase).toBe('playing');
      });

      it('abandons the game at once when a player leaves and too few remain', () => {
        const h = harness();
        const [alice, bob] = startGame(h, ['Alice', 'Bob']);
        h.transport.clear();
        h.room.leave(bob);
        expect(h.room.phase).toBe('lobby');
        expect(h.transport.chats(alice).map((c) => c.text)).toEqual(['Bob left', 'Not enough players — back to the lobby.']);
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
    it('validates settings patches: host only, lobby only, clamped to the game and the occupancy', () => {
      const h = harness();
      const alice = h.join('Alice');
      const bob = h.join('Bob');
      h.send(bob, { t: 'updateSettings', settings: { maxPlayers: 5 } });
      expect(h.transport.errors(bob)).toEqual(['NOT_ALLOWED']);
      expect(h.room.settings.maxPlayers).toBe(Math.min(12, meta.maxPlayers));
      h.transport.clear();

      h.send(alice, { t: 'updateSettings', settings: { maxPlayers: 2, allowMidGameJoin: false } });
      expect(h.room.settings).toMatchObject({ maxPlayers: 2, allowMidGameJoin: false });
      expect(h.transport.ofType(bob, 'room')).toHaveLength(1);
      expect(h.transport.last(bob, 'room').room.settings.maxPlayers).toBe(2);
      expect(h.room.join('Carol', AVATAR, 'c')).toMatchObject({ ok: false, code: 'ROOM_FULL' });

      // maxPlayers can never drop below the current occupancy, nor exceed the game's limit.
      h.send(alice, { t: 'updateSettings', settings: { maxPlayers: 12 } });
      h.join('Carol');
      h.send(alice, { t: 'updateSettings', settings: { maxPlayers: 2 } });
      expect(h.room.settings.maxPlayers).toBe(3);
      expect(h.room.join('Dave', AVATAR, 'd')).toMatchObject({ ok: false, code: 'ROOM_FULL' });
      h.send(alice, { t: 'updateSettings', settings: { maxPlayers: 50 } });
      expect(h.room.settings.maxPlayers).toBe(meta.maxPlayers);

      // Invalid values are refused as a whole; unknown keys are stripped, not refused.
      h.transport.clear();
      h.send(alice, { t: 'updateSettings', settings: { maxPlayers: 0 } });
      expect(h.transport.errors(alice)).toEqual(['INVALID_MESSAGE']);
      h.send(alice, { t: 'updateSettings', settings: { bogus: true, allowMidGameJoin: false } });
      expect(h.transport.errors(alice)).toEqual(['INVALID_MESSAGE']);
      expect(h.room.settings).not.toHaveProperty('bogus');
      expect(h.room.settings.allowMidGameJoin).toBe(false);

      h.send(alice, { t: 'start' });
      h.send(alice, { t: 'updateSettings', settings: { allowMidGameJoin: true } });
      expect(h.transport.errors(alice)).toEqual(['INVALID_MESSAGE', 'NOT_ALLOWED']);
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
      h.transport.clear();
      h.send(alice, { t: 'returnToLobby' });
      const lobby = h.transport.last(bob, 'room').room;
      expect(lobby).toMatchObject({ phase: 'lobby', podium: null, game: null });
      expect(lobby.players.every((p) => p.score === 0)).toBe(true);
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
