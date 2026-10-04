import { describe, expect, it } from 'vitest';
import { Player } from './player';

describe('Player', () => {
  it('has a uuid id and a 32-hex-char token', () => {
    const p = new Player({ name: 'Alice', avatar: { color: 1, emoji: 2 }, joinOrder: 3, connectionId: 'c', now: 1000 });
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.token).toMatch(/^[0-9a-f]{32}$/);
    const q = new Player({ name: 'Bob', avatar: { color: 0, emoji: 0 }, joinOrder: 4, connectionId: 'd', now: 1000 });
    expect(q.id).not.toBe(p.id);
    expect(q.token).not.toBe(p.token);
  });

  it('tracks connection state and resets per turn / per game', () => {
    const p = new Player({ name: 'Alice', avatar: { color: 1, emoji: 2 }, joinOrder: 3, connectionId: 'c', now: 1000 });
    p.score = 120;
    p.turnPoints = 20;
    p.guessedThisTurn = true;
    p.rating = 'like';
    p.resetForTurn();
    expect(p).toMatchObject({ score: 120, turnPoints: 0, guessedThisTurn: false, rating: null });
    p.resetForGame();
    expect(p.score).toBe(0);

    p.markDisconnected(2000);
    expect(p).toMatchObject({ connected: false, connectionId: null, lastSeen: 2000, connectedAt: 1000 });
    p.markConnected('c2', 3000);
    expect(p).toMatchObject({ connected: true, connectionId: 'c2', lastSeen: 3000, connectedAt: 3000 });
    // Replacing a live socket keeps the original connection time.
    p.markConnected('c3', 4000);
    expect(p.connectedAt).toBe(3000);
  });

  it('serialises a public view', () => {
    const p = new Player({ name: 'Alice', avatar: { color: 1, emoji: 2 }, joinOrder: 3, connectionId: 'c', now: 1000 });
    expect(p.toPublic(p.id)).toEqual({
      id: p.id,
      name: 'Alice',
      avatar: { color: 1, emoji: 2 },
      score: 0,
      isHost: true,
      connected: true,
      guessedThisTurn: false,
      turnPoints: 0,
      joinOrder: 3,
    });
    expect(p.toPublic('other').isHost).toBe(false);
    expect(JSON.stringify(p.toPublic('x'))).not.toContain(p.token);
  });
});
