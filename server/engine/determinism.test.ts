import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import { applyAction } from './reduce';
import type { RoomData } from './state';
import { AVATAR, Ids, START, ctxAt, sim, startGame } from './testHarness';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Applies the same action twice to a frozen copy of `data` with identical contexts. */
function twice(data: RoomData, action: Action, now: number): void {
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

describe('applyAction', () => {
  it('is deterministic and never mutates its input', () => {
    const s = sim();
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const actions: Action[] = [
      { type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' },
      { type: 'clientMessage', playerId: alice, msg: { t: 'chooseWord', index: 1 } },
      { type: 'clientMessage', playerId: bob, msg: { t: 'chat', text: 'bananas' } },
      { type: 'connectionClosed', playerId: bob },
      { type: 'leave', playerId: alice },
      { type: 'tick' },
    ];
    for (const action of actions) twice(s.data, action, s.now + 5000);
  });

  it('returns the very same object when nothing changed', () => {
    const s = sim();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    const before = s.data;

    // A rejected command sends an error but changes no state.
    const refused = applyAction(before, { type: 'clientMessage', playerId: bob, msg: { t: 'chooseWord', index: 0 } }, ctxAt(s.now, new Ids()));
    expect(refused.data).toBe(before);
    expect(refused.effects).toEqual([{ type: 'send', to: [bob], msg: { t: 'error', code: 'NOT_ALLOWED', message: 'You are not choosing a word right now.' } }]);

    // Unknown players and a tick with nothing due are no-ops.
    expect(applyAction(before, { type: 'clientMessage', playerId: 'ghost', msg: { t: 'chat', text: 'boo' } }, ctxAt(s.now, new Ids()))).toMatchObject({ data: before, effects: [] });
    expect(applyAction(before, { type: 'tick' }, ctxAt(s.now, new Ids()))).toMatchObject({ data: before, effects: [] });

    // A rejected seat reports why, without touching the room.
    const full = applyAction(before, { type: 'create', name: 'Zed', avatar: AVATAR, connectionId: 'z' }, ctxAt(s.now, new Ids()));
    expect(full.data).toBe(before);
    expect(full.result).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(full.effects).toEqual([]);

    const changed = applyAction(before, { type: 'clientMessage', playerId: alice, msg: { t: 'chooseWord', index: 0 } }, ctxAt(s.now, new Ids()));
    expect(changed.data).not.toBe(before);
    expect(changed.data.version).toBe(before.version + 1);
    expect(before.phase.kind).toBe('choosing');
  });

  it('takes identity and randomness only from the context', () => {
    const s = sim();
    const [alice] = startGame(s, ['Alice', 'Bob']);
    expect(s.data.players.map((p) => [p.id, p.token])).toEqual([
      ['player-1', 'token-1'],
      ['player-2', 'token-2'],
    ]);
    expect(s.data.turn?.choices).toEqual(['apple', 'banana', 'cherry']);

    // A different rng picks different words for the same sequence of actions.
    const other = sim('ABCD', START, () => 0.99);
    startGame(other, ['Alice', 'Bob']);
    expect(other.data.turn?.choices).not.toEqual(s.data.turn?.choices);
    expect(other.data.turn?.choices).toHaveLength(3);
    expect(alice).toBe('player-1');
  });
});
