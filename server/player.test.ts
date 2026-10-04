import { describe, expect, it } from 'vitest';
import type { PlayerData } from './engine/state';
import { publicPlayer } from './engine/view';
import { Player } from './player';

function record(overrides: Partial<PlayerData> = {}): PlayerData {
  return {
    id: 'p1',
    token: 'secret-token',
    name: 'Alice',
    avatar: { color: 1, emoji: 2 },
    score: 0,
    joinOrder: 3,
    connected: true,
    connectionId: 'c',
    connectedAt: 1000,
    disconnectedAt: null,
    guessedThisTurn: false,
    turnPoints: 0,
    rating: null,
    ...overrides,
  };
}

describe('Player', () => {
  it('reads through to the current record so every action is visible without copying', () => {
    let current: PlayerData | undefined = record();
    const p = new Player(() => current, current);
    expect(p).toMatchObject({ id: 'p1', token: 'secret-token', name: 'Alice', score: 0, connected: true, connectionId: 'c', joinOrder: 3 });

    // The driver replaces the record wholesale on every action (the reducer never mutates in place).
    current = record({ score: 120, turnPoints: 20, guessedThisTurn: true, rating: 'like', connected: false, connectionId: null, disconnectedAt: 2000 });
    expect(p).toMatchObject({ score: 120, turnPoints: 20, guessedThisTurn: true, rating: 'like', connected: false, connectionId: null });
    expect(p.seated).toBe(true);
    expect(p.avatar).toEqual({ color: 1, emoji: 2 });
    // The avatar is a copy: callers cannot reach into the state through the handle.
    p.avatar.color = 9;
    expect(current.avatar.color).toBe(1);
  });

  it('keeps the last record after removal but forgets the secrets', () => {
    let current: PlayerData | undefined = record({ score: 50, connectionId: 'c2' });
    const p = new Player(() => current, current);
    expect(p.connectionId).toBe('c2');
    current = undefined;
    expect(p.seated).toBe(false);
    expect(p.token).toBe('');
    expect(p.connected).toBe(false);
    expect(p.connectionId).toBeNull();
    expect(p).toMatchObject({ id: 'p1', name: 'Alice', score: 50, joinOrder: 3 });
  });

  it('serialises a public view without the token', () => {
    const data = record();
    expect(publicPlayer(data, 'p1')).toEqual({
      id: 'p1',
      name: 'Alice',
      avatar: { color: 1, emoji: 2 },
      score: 0,
      isHost: true,
      connected: true,
      guessedThisTurn: false,
      turnPoints: 0,
      joinOrder: 3,
    });
    expect(publicPlayer(data, 'other').isHost).toBe(false);
    expect(JSON.stringify(publicPlayer(data, 'x'))).not.toContain(data.token);
  });
});
