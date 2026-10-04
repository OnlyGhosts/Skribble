import { describe, expect, it } from 'vitest';
import { CHOOSE_TIME_SECONDS, TURN_END_SECONDS } from '../../shared/constants';
import { createRoomData, type RoomData } from './state';
import { AVATAR, START, sim, startGame } from './testHarness';

function roundTrip(data: RoomData): RoomData {
  return JSON.parse(JSON.stringify(data)) as RoomData;
}

describe('RoomData serialisation', () => {
  it('is the identity for a fresh room', () => {
    const data = createRoomData('ABCD', START);
    expect(roundTrip(data)).toStrictEqual(data);
  });

  it('survives JSON at every point of a game, including grace periods, votes and chat', () => {
    const s = sim();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    expect(roundTrip(s.data)).toStrictEqual(s.data);

    s.apply({ type: 'clientMessage', playerId: alice, msg: { t: 'chooseWord', index: 0 } });
    s.apply({ type: 'clientMessage', playerId: bob, msg: { t: 'chat', text: 'apple' } });
    s.apply({ type: 'clientMessage', playerId: carol, msg: { t: 'rate', value: 'like' } });
    s.apply({ type: 'clientMessage', playerId: bob, msg: { t: 'voteKick', playerId: carol } });
    s.apply({ type: 'connectionClosed', playerId: alice, connectionId: 'conn-Alice' });
    expect(s.data.grace.drawerGoneAt).not.toBeNull();
    expect(s.data.players.find((p) => p.id === alice)?.disconnectedAt).toBe(s.now);
    expect(s.data.votes).toHaveLength(1);
    expect(roundTrip(s.data)).toStrictEqual(s.data);

    s.advance(CHOOSE_TIME_SECONDS * 1000);
    s.tick();
    expect(s.data.phase.kind).toBe('turnEnd');
    expect(roundTrip(s.data)).toStrictEqual(s.data);

    s.advance(TURN_END_SECONDS * 1000);
    s.tick();
    expect(roundTrip(s.data)).toStrictEqual(s.data);

    // Empty the room: the TTL deadline and the reset state must round-trip too.
    for (const p of [...s.data.players]) s.apply({ type: 'leave', playerId: p.id });
    expect(s.data.players).toHaveLength(0);
    expect(s.data.grace.emptyRoomAt).toBe(s.now + 60_000);
    expect(roundTrip(s.data)).toStrictEqual(s.data);

    s.apply({ type: 'join', name: 'Eve', avatar: AVATAR, connectionId: 'e' });
    expect(roundTrip(s.data)).toStrictEqual(s.data);
  });

  it('holds only JSON primitives, arrays and plain objects', () => {
    const s = sim();
    startGame(s, ['Alice', 'Bob']);
    const visit = (value: unknown, path: string): void => {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
      if (typeof value === 'number') {
        expect(Number.isFinite(value), path).toBe(true);
        return;
      }
      expect(typeof value, path).toBe('object');
      if (Array.isArray(value)) {
        value.forEach((v, i) => visit(v, `${path}[${i}]`));
        return;
      }
      expect(Object.getPrototypeOf(value), path).toBe(Object.prototype);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        expect(v, `${path}.${k}`).not.toBeUndefined();
        visit(v, `${path}.${k}`);
      }
    };
    visit(s.data, 'data');
  });
});
