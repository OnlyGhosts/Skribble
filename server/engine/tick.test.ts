import { describe, expect, it } from 'vitest';
import { CHOOSE_TIME_SECONDS, DRAWER_DISCONNECT_GRACE_MS, EMPTY_ROOM_TTL_MS, RECONNECT_GRACE_MS, TURN_END_SECONDS } from '../../shared/constants.js';
import { hintRevealOrder, maskWord } from '../../shared/hints.js';
import type { Phase, ServerMessageOf } from '../../shared/protocol.js';
import type { Effect } from './effects.js';
import { canDraw } from './players.js';
import { applyAction } from './reduce.js';
import { nextDeadline } from './time.js';
import { Ids, START, ctxAt, sim, startGame } from './testHarness.js';

/** The phases a player saw, in order, from the snapshot effects. */
function phasesSeen(effects: Effect[], playerId: string): Phase[] {
  return effects
    .filter((e): e is Extract<Effect, { type: 'send' }> => e.type === 'send' && Array.isArray(e.to) && e.to.includes(playerId))
    .map((e) => e.msg)
    .filter((m): m is ServerMessageOf<'room'> => m.t === 'room')
    .map((m) => m.room.phase);
}

describe('tick', () => {
  it('catches up through a whole turn in one call, firing each deadline at its own time', () => {
    const s = sim();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    expect(s.data.phase).toEqual({ kind: 'choosing', endsAt: START + CHOOSE_TIME_SECONDS * 1000 });

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
    expect(s.data.turn).toMatchObject({ drawerId: bob, word: '', revealAt: [], revealed: [] });
    expect(s.data.usedWords).toEqual(['apple']);
    // Chat timestamps follow the deadline that produced them; snapshots carry the real clock.
    const hint = effects.find((e) => e.type === 'send' && e.msg.t === 'chat' && e.msg.message.kind === 'hint');
    expect(hint && hint.type === 'send' && hint.msg.t === 'chat' ? hint.msg.message.ts : null).toBe(drawEndAt);
    const snapshot = effects.find((e) => e.type === 'send' && e.msg.t === 'room');
    expect(snapshot && snapshot.type === 'send' && snapshot.msg.t === 'room' ? snapshot.msg.room.serverTime : null).toBe(s.now);

    // The same tick again is a no-op with no effects and the identical object.
    const again = applyAction(s.data, { type: 'tick' }, ctxAt(s.now, new Ids()));
    expect(again.data).toBe(s.data);
    expect(again.effects).toEqual([]);

    // Far enough ahead the game finishes and nothing is scheduled any more.
    s.now += 10 * 60_000;
    s.tick();
    expect(s.data.phase.kind).toBe('gameEnd');
    expect(nextDeadline(s.data)).toBeNull();
    expect(s.tick()).toEqual([]);
  });

  it('expires seats, abandons the game and finally destroys an empty room', () => {
    const s = sim();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    s.apply({ type: 'clientMessage', playerId: alice, msg: { t: 'chooseWord', index: 0 } });
    expect(canDraw(s.data, alice, s.now)).toBe(true);
    expect(canDraw(s.data, bob, s.now)).toBe(false);
    expect(canDraw(s.data, alice, s.now + 60_000)).toBe(false);

    const dropAt = s.now;
    s.apply({ type: 'connectionClosed', playerId: bob, connectionId: 'conn-Bob' });
    expect(nextDeadline(s.data)).toBe(dropAt + DRAWER_DISCONNECT_GRACE_MS);

    // Low-player grace -> lobby; Bob's seat is still held.
    s.now = dropAt + DRAWER_DISCONNECT_GRACE_MS;
    s.tick();
    expect(s.data.phase.kind).toBe('lobby');
    expect(s.data.players).toHaveLength(2);
    expect(nextDeadline(s.data)).toBe(dropAt + RECONNECT_GRACE_MS);

    s.now = dropAt + RECONNECT_GRACE_MS;
    const expiry = s.tick();
    expect(s.data.players.map((p) => p.id)).toEqual([alice]);
    expect(expiry).toContainEqual({ type: 'send', to: 'all', msg: expect.objectContaining({ t: 'chat', message: expect.objectContaining({ text: 'Bob left' }) }) });

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
    s.apply({ type: 'clientMessage', playerId: alice, msg: { t: 'chooseWord', index: 0 } });
    s.apply({ type: 'clientMessage', playerId: bob, msg: { t: 'chat', text: 'apple' } });
    s.apply({ type: 'clientMessage', playerId: dave, msg: { t: 'chat', text: 'apple' } });
    // The last unsolved guesser and then the drawer drop: allGuessed and drawerGone share a deadline.
    s.apply({ type: 'connectionClosed', playerId: carol });
    s.apply({ type: 'connectionClosed', playerId: alice });
    expect(s.data.grace.allGuessedAt).toBe(s.now + DRAWER_DISCONNECT_GRACE_MS);
    expect(s.data.grace.drawerGoneAt).toBe(s.now + DRAWER_DISCONNECT_GRACE_MS);
    s.now += DRAWER_DISCONNECT_GRACE_MS;
    const effects = s.tick();
    expect(s.data.phase).toMatchObject({ kind: 'turnEnd', reason: 'drawerLeft' });
    expect(s.data.grace).toMatchObject({ drawerGoneAt: null, allGuessedAt: null });
    const texts = effects.flatMap((e) => (e.type === 'send' && e.msg.t === 'chat' ? [e.msg.message.text] : []));
    expect(texts).toEqual(['Alice lost connection — skipping their turn.', 'The word was: apple']);
  });
});
