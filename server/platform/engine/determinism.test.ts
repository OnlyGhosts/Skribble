import { describe, expect, it } from 'vitest';
import { GAME_IDS } from '../../../shared/platform/games.js';
import type { SkribbleData } from '../../games/skribble/state.js';
import { GAME_TEST_FIXTURES } from '../../games/testFixtures.js';
import type { Action } from './actions.js';
import { applyAction } from './reduce.js';
import type { PlatformRoomData } from './state.js';
import { AVATAR, Ids, START, ctxAt, sim, startGame } from './testHarness.js';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Applies the same action twice to a frozen copy of `data` with identical contexts. */
function twice(data: PlatformRoomData, action: Action, now: number): void {
  const frozen = deepFreeze(structuredClone(data));
  const snapshot = structuredClone(data);
  const a = applyAction(frozen, action, ctxAt(now, new Ids()));
  const b = applyAction(frozen, action, ctxAt(now, new Ids()));
  expect(a).toStrictEqual(b);
  expect(frozen).toStrictEqual(snapshot);
  if (a.data !== frozen) {
    expect(a.data.version).toBe(data.version + 1);
    expect(a.data.updatedAt).toBe(now);
  }
}

describe.each(GAME_IDS)('applyAction (%s)', (gameId) => {
  it('is deterministic and never mutates its input', () => {
    const s = sim(gameId);
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const actions: Action[] = [
      { type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' },
      { type: 'gameMessage', playerId: alice, msg: GAME_TEST_FIXTURES[gameId].validMessage },
      { type: 'platformMessage', playerId: bob, msg: { t: 'chat', text: 'bananas' } },
      { type: 'platformMessage', playerId: bob, msg: { t: 'voteKick', playerId: alice } },
      { type: 'connectionClosed', playerId: bob },
      { type: 'leave', playerId: alice },
      { type: 'tick' },
    ];
    for (const action of actions) twice(s.data, action, s.now + 5000);
    s.now += 10 * 60_000;
    twice(s.data, { type: 'tick' }, s.now);
  });

  it('returns the very same object when nothing changed', () => {
    const s = sim(gameId);
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    const before = s.data;

    // A rejected command sends an error but changes no state.
    const refused = applyAction(before, { type: 'platformMessage', playerId: bob, msg: { t: 'start' } }, ctxAt(s.now, new Ids()));
    expect(refused.data).toBe(before);
    expect(refused.effects).toEqual([{ type: 'send', to: [bob], msg: { t: 'error', code: 'NOT_ALLOWED', message: 'Only the host can do that.' } }]);

    // Unknown players and a tick with nothing due are no-ops.
    expect(applyAction(before, { type: 'platformMessage', playerId: 'ghost', msg: { t: 'chat', text: 'boo' } }, ctxAt(s.now, new Ids()))).toMatchObject({ data: before, effects: [] });
    expect(applyAction(before, { type: 'tick' }, ctxAt(s.now, new Ids()))).toMatchObject({ data: before, effects: [] });

    // A rejected seat reports why, without touching the room.
    const full = applyAction(before, { type: 'create', gameId, name: 'Zed', avatar: AVATAR, connectionId: 'z' }, ctxAt(s.now, new Ids()));
    expect(full.data).toBe(before);
    expect(full.result).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(full.effects).toEqual([]);

    const changed = applyAction(before, { type: 'platformMessage', playerId: alice, msg: { t: 'chat', text: 'hi' } }, ctxAt(s.now, new Ids()));
    expect(changed.data).not.toBe(before);
    expect(changed.data.version).toBe(before.version + 1);
    expect(before.chat.some((c) => c.text === 'hi')).toBe(false);
  });
});

describe('applyAction (skribble)', () => {
  it('takes identity and randomness only from the context', () => {
    const s = sim();
    const [alice] = startGame(s, ['Alice', 'Bob']);
    expect(s.data.players.map((p) => [p.id, p.token])).toEqual([
      ['id-1', 'token-1'],
      ['id-2', 'token-2'],
    ]);
    const game = s.data.game as SkribbleData;
    expect(game.turn?.choices).toEqual(['apple', 'banana', 'cherry']);
    // The canvas id is minted from the same counter.
    expect(game.canvasId).toBe('id-3');

    // A different rng picks different words for the same sequence of actions.
    const other = sim('skribble', 'ABCD', START, () => 0.99);
    startGame(other, ['Alice', 'Bob']);
    const otherGame = other.data.game as SkribbleData;
    expect(otherGame.turn?.choices).not.toEqual(game.turn?.choices);
    expect(otherGame.turn?.choices).toHaveLength(3);
    expect(alice).toBe('id-1');
  });

  it('refuses to create a room for another game than the one it was made for', () => {
    const s = sim('template');
    const out = applyAction(s.data, { type: 'create', gameId: 'skribble', name: 'Alice', avatar: AVATAR, connectionId: 'a' }, ctxAt(s.now, new Ids()));
    expect(out.result).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(out.data).toBe(s.data);
  });
});
