import { describe, expect, it } from 'vitest';
import { CHOOSE_TIME_SECONDS, DRAWER_DISCONNECT_GRACE_MS, TURN_END_SECONDS } from '../../../shared/games/skribble/constants.js';
import { hintRevealOrder, maskWord } from '../../../shared/games/skribble/hints.js';
import type { SkribblePhase, SkribbleView } from '../../../shared/games/skribble/protocol.js';
import { EMPTY_ROOM_TTL_MS, LOW_PLAYERS_GRACE_MS, RECONNECT_GRACE_MS } from '../../../shared/platform/constants.js';
import type { PlatformServerMessageOf } from '../../../shared/platform/protocol.js';
import { canDraw, type SkribbleData } from '../../games/skribble/state.js';
import type { Effect } from './effects.js';
import { applyAction } from './reduce.js';
import { nextDeadline } from './time.js';
import { Ids, START, chatTexts, ctxAt, sim, startGame } from './testHarness.js';

/** The Skribble phases a player saw, in order, from the snapshot effects. */
function phasesSeen(effects: Effect[], playerId: string): SkribblePhase[] {
  return effects
    .filter((e): e is Extract<Effect, { type: 'send' }> => e.type === 'send' && Array.isArray(e.to) && e.to.includes(playerId))
    .map((e) => e.msg)
    .filter((m): m is PlatformServerMessageOf<'room'> => m.t === 'room')
    .flatMap((m) => (m.room.game ? [(m.room.game as SkribbleView).phase] : []));
}

const game = (s: { data: { game: unknown } }): SkribbleData => s.data.game as SkribbleData;

describe('tick', () => {
  it('catches up through a whole turn in one call, firing each deadline at its own time', () => {
    const s = sim();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    expect(game(s).phase).toEqual({ kind: 'choosing', endsAt: START + CHOOSE_TIME_SECONDS * 1000 });

    const chooseAt = START + CHOOSE_TIME_SECONDS * 1000;
    const drawEndAt = chooseAt + 60_000;
    const turnEndAt = drawEndAt + TURN_END_SECONDS * 1000;
    s.now = turnEndAt + 1234;
    const effects = s.tick();

    const seen = phasesSeen(effects, bob);
    const order = hintRevealOrder('apple', 2, () => 0);
    expect(seen.map((p) => p.kind)).toEqual(['drawing', 'drawing', 'drawing', 'turnEnd', 'choosing']);
    // Auto-picked at the choose deadline, not at the (much later) tick time.
    expect(seen[0]).toMatchObject({ kind: 'drawing', drawerId: alice, startedAt: chooseAt, endsAt: drawEndAt, mask: '_____' });
    expect(seen[1]).toMatchObject({ kind: 'drawing', mask: maskWord('apple', [order[0]]) });
    expect(seen[2]).toMatchObject({ kind: 'drawing', mask: maskWord('apple', order) });
    expect(seen[3]).toMatchObject({ kind: 'turnEnd', reason: 'timeUp', word: 'apple', endsAt: turnEndAt, points: {} });
    expect(seen[4]).toMatchObject({ kind: 'choosing', drawerId: bob, endsAt: turnEndAt + CHOOSE_TIME_SECONDS * 1000 });
    expect(game(s).turn).toMatchObject({ drawerId: bob, word: '', revealAt: [], revealed: [] });
    expect(game(s).usedWords).toEqual(['apple']);
    // Chat timestamps follow the deadline that produced them; snapshots carry the real clock.
    const hint = effects.find((e) => e.type === 'send' && e.msg.t === 'chat' && (e.msg as PlatformServerMessageOf<'chat'>).message.kind === 'hint');
    expect(hint && hint.type === 'send' ? (hint.msg as PlatformServerMessageOf<'chat'>).message.ts : null).toBe(drawEndAt);
    const snapshot = effects.find((e) => e.type === 'send' && e.msg.t === 'room');
    expect(snapshot && snapshot.type === 'send' ? (snapshot.msg as PlatformServerMessageOf<'room'>).room.serverTime : null).toBe(s.now);

    // The same tick again is a no-op with no effects and the identical object.
    const again = applyAction(s.data, { type: 'tick' }, ctxAt(s.now, new Ids()));
    expect(again.data).toBe(s.data);
    expect(again.effects).toEqual([]);

    // Far enough ahead the game finishes and nothing is scheduled any more.
    s.now += 10 * 60_000;
    s.tick();
    expect(s.data.phase).toBe('ended');
    expect(game(s).phase.kind).toBe('gameOver');
    expect(nextDeadline(s.data)).toBeNull();
    expect(s.tick()).toEqual([]);
  });

  it('expires seats, abandons the game and finally destroys an empty room', () => {
    const s = sim();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    expect(canDraw(game(s), alice, s.now)).toBe(true);
    expect(canDraw(game(s), bob, s.now)).toBe(false);
    expect(canDraw(game(s), alice, s.now + 60_000)).toBe(false);

    const dropAt = s.now;
    s.apply({ type: 'connectionClosed', playerId: bob, connectionId: 'conn-Bob' });
    expect(nextDeadline(s.data)).toBe(dropAt + LOW_PLAYERS_GRACE_MS);

    // Low-player grace -> lobby; Bob's seat is still held.
    s.now = dropAt + LOW_PLAYERS_GRACE_MS;
    s.tick();
    expect(s.data.phase).toBe('lobby');
    expect(s.data.game).toBeNull();
    expect(s.data.players).toHaveLength(2);
    expect(nextDeadline(s.data)).toBe(dropAt + RECONNECT_GRACE_MS);

    s.now = dropAt + RECONNECT_GRACE_MS;
    const expiry = s.tick();
    expect(s.data.players.map((p) => p.id)).toEqual([alice]);
    expect(chatTexts(expiry)).toContain('Bob left');

    s.apply({ type: 'leave', playerId: alice });
    expect(s.data.players).toHaveLength(0);
    expect(nextDeadline(s.data)).toBe(s.now + EMPTY_ROOM_TTL_MS);
    s.now += EMPTY_ROOM_TTL_MS;
    expect(s.tick()).toEqual([{ type: 'destroy' }]);
    expect(nextDeadline(s.data)).toBeNull();
  });

  it('fires every deadline at most once when several are due in the same tick', () => {
    const s = sim();
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    s.game(alice, { t: 'chooseWord', index: 0 });
    s.platform(bob, { t: 'chat', text: 'apple' });
    s.platform(dave, { t: 'chat', text: 'apple' });
    // The last unsolved guesser and then the drawer drop: allGuessed and drawerGone share a deadline.
    s.apply({ type: 'connectionClosed', playerId: carol });
    s.apply({ type: 'connectionClosed', playerId: alice });
    expect(game(s).grace.allGuessedAt).toBe(s.now + DRAWER_DISCONNECT_GRACE_MS);
    expect(game(s).grace.drawerGoneAt).toBe(s.now + DRAWER_DISCONNECT_GRACE_MS);
    s.now += DRAWER_DISCONNECT_GRACE_MS;
    const effects = s.tick();
    expect(game(s).phase).toMatchObject({ kind: 'turnEnd', reason: 'drawerLeft' });
    expect(game(s).grace).toMatchObject({ drawerGoneAt: null, allGuessedAt: null });
    expect(chatTexts(effects)).toEqual(['Alice lost connection — skipping their turn.', 'The word was: apple']);
  });

  it('ends a Click Race at its time limit and ranks everyone by clicks', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { timeLimit: 10, targetClicks: 100 });
    for (let i = 0; i < 3; i++) s.game(alice, { t: 'click' });
    s.game(bob, { t: 'click' });
    s.now += 9_999;
    expect(s.tick()).toEqual([]);
    s.now += 1;
    const effects = s.tick();
    expect(s.data.phase).toBe('ended');
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 3, rank: 1 },
      { playerId: bob, score: 1, rank: 2 },
    ]);
    expect(chatTexts(effects)).toEqual(['Game over! Alice wins with 3 points.']);
    expect(nextDeadline(s.data)).toBeNull();
  });
});
