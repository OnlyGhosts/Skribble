/**
 * The platform's side of holding for disconnected players: a dropped socket never abandons a
 * game, only an empty seat does, and a game's 'waiting' effect reaches every snapshot until the
 * game goes on, aborts, ends or returns to the lobby.
 */
import { describe, expect, it } from 'vitest';
import { RECONNECT_GRACE_MS } from '../../../shared/platform/constants.js';
import { GAME_IDS, gameById } from '../../../shared/platform/games.js';
import type { SkribbleData } from '../../games/skribble/state.js';
import { GAME_TEST_FIXTURES } from '../../games/testFixtures.js';
import { applyGameResult } from './delegate.js';
import type { Cx } from './messaging.js';
import { applyAction } from './reduce.js';
import type { PlatformRoomData } from './state.js';
import { Ids, chatTexts, ctxAt, sim, startGame, type Sim } from './testHarness.js';
import { gameDeadline, nextDeadline, pendingDeadlines } from './time.js';
import { viewFor } from './view.js';

const disconnect = (s: Sim, id: string): void => {
  s.apply({ type: 'connectionClosed', playerId: id });
};

/** A reducer context over a private copy of the room, for driving `applyGameResult` directly. */
function cxOf(data: PlatformRoomData, now: number): Cx {
  return { data: structuredClone(data), effects: [], ctx: ctxAt(now, new Ids()), now };
}

describe.each(GAME_IDS)('holding for disconnected players (%s)', (gameId) => {
  const { minPlayers } = gameById(gameId);

  it('never abandons a running game over a disconnect alone, and schedules nothing of its own for it', () => {
    const s = sim(gameId);
    const [alice, ...others] = startGame(s, ['Alice', 'Bob'], GAME_TEST_FIXTURES[gameId].longSettings);
    for (const id of others) disconnect(s, id);
    expect(s.data.players.filter((p) => p.connected).map((p) => p.id)).toEqual([alice]);
    expect(s.data.phase).toBe('playing');
    expect(chatTexts(s.effects)).not.toContain('Not enough players — back to the lobby.');
    const kinds = pendingDeadlines(s.data).map((d) => d.kind);
    expect(kinds.filter((k) => k === 'reconnectExpiry')).toHaveLength(others.length);
    expect(kinds.every((k) => k === 'game' || k === 'reconnectExpiry')).toBe(true);
    // A minute later the room is still playing (the game may be mid-turn, mid-round or already holding).
    s.now += 60_000;
    s.tick();
    expect(s.data.phase).toBe('playing');
  });

  if (minPlayers > 1) {
    it('abandons the game once a seat expiry leaves fewer seats than the game needs', () => {
      const s = sim(gameId);
      const [alice, bob] = startGame(s, ['Alice', 'Bob'], GAME_TEST_FIXTURES[gameId].longSettings);
      const dropAt = s.now;
      disconnect(s, bob);
      s.now = dropAt + RECONNECT_GRACE_MS - 1;
      s.tick();
      expect(s.data.phase).toBe('playing');
      expect(s.data.players.some((p) => p.id === bob)).toBe(true);

      s.now = dropAt + RECONNECT_GRACE_MS;
      const effects = s.tick();
      expect(chatTexts(effects).slice(-2)).toEqual(['Bob left', 'Not enough players — back to the lobby.']);
      expect(s.data).toMatchObject({ phase: 'lobby', game: null, waiting: null, podium: null });
      expect(s.data.players.map((p) => p.id)).not.toContain(bob);
      expect(s.data.players.every((p) => p.score === 0)).toBe(true);
      expect(viewFor(s.data, alice, s.now).waiting).toBeNull();
      expect(nextDeadline(s.data)).toBeNull();
    });
  }
});

describe('the waiting effect', () => {
  it('reaches the view with the live counts, narrowed to players still seated and disconnected, and null clears it', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    disconnect(s, bob);
    const cx = cxOf(s.data, s.now);

    applyGameResult(cx, { data: cx.data.game, effects: [{ type: 'waiting', missing: [bob] }] });
    expect(cx.data.waiting).toEqual([bob]);
    expect(viewFor(cx.data, alice, s.now).waiting).toEqual({ reason: 'players', missing: [bob], needed: 1, connected: 1 });
    expect(viewFor(cx.data, null, s.now).waiting).toEqual({ reason: 'players', missing: [bob], needed: 1, connected: 1 });
    expect(JSON.parse(JSON.stringify(cx.data))).toStrictEqual(cx.data);

    // Whoever is connected (or unknown) at render time is not missing, whatever the game last said.
    applyGameResult(cx, { data: cx.data.game, effects: [{ type: 'waiting', missing: [alice, bob, 'ghost'] }] });
    expect(viewFor(cx.data, alice, s.now).waiting).toMatchObject({ missing: [bob] });

    // With nobody left to wait for (a frame between a rejoin and the game's resume) there is no hold to show.
    applyGameResult(cx, { data: cx.data.game, effects: [{ type: 'waiting', missing: [alice] }] });
    expect(cx.data.waiting).toEqual([alice]);
    expect(viewFor(cx.data, alice, s.now).waiting).toBeNull();
    expect(viewFor(cx.data, null, s.now).waiting).toBeNull();

    applyGameResult(cx, { data: cx.data.game, effects: [{ type: 'waiting', missing: null }] });
    expect(cx.data.waiting).toBeNull();
    expect(viewFor(cx.data, alice, s.now).waiting).toBeNull();
  });

  it('is cleared by abort, by gameOver and by the return to the lobby', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    disconnect(s, bob);

    const aborted = cxOf(s.data, s.now);
    applyGameResult(aborted, { data: aborted.data.game, effects: [{ type: 'waiting', missing: [bob] }, { type: 'abort', reason: 'Called off.' }] });
    expect(aborted.data).toMatchObject({ phase: 'lobby', waiting: null });
    expect(viewFor(aborted.data, alice, s.now).waiting).toBeNull();

    const over = cxOf(s.data, s.now);
    applyGameResult(over, { data: over.data.game, effects: [{ type: 'waiting', missing: [bob] }, { type: 'gameOver' }] });
    expect(over.data).toMatchObject({ phase: 'ended', waiting: null });
    expect(viewFor(over.data, alice, s.now).waiting).toBeNull();

    // A stale list left on an ended room is dropped when the host returns everyone to the lobby.
    const stale: PlatformRoomData = { ...over.data, waiting: [bob] };
    const back = applyAction(stale, { type: 'platformMessage', playerId: alice, msg: { t: 'returnToLobby' } }, ctxAt(s.now, new Ids()));
    expect(back.data).toMatchObject({ phase: 'lobby', waiting: null });
    expect(viewFor(back.data, alice, s.now).waiting).toBeNull();
  });

  it('leaves a holding game with no deadline but the seat expiries', () => {
    const s = sim();
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { rounds: 3 });
    s.game(alice, { t: 'chooseWord', index: 0 });
    s.platform(bob, { t: 'chat', text: 'apple' });
    const dropAt = s.now;
    disconnect(s, bob);
    s.now = nextDeadline(s.data) ?? s.now;
    s.tick();
    expect((s.data.game as SkribbleData).phase).toMatchObject({ kind: 'turnEnd', held: true });
    expect(gameDeadline(s.data)).toBeNull();
    expect(pendingDeadlines(s.data)).toEqual([{ kind: 'reconnectExpiry', at: dropAt + RECONNECT_GRACE_MS, playerId: bob }]);
    expect(viewFor(s.data, alice, s.now).waiting).toEqual({ reason: 'players', missing: [bob], needed: 2, connected: 1 });
  });
});
