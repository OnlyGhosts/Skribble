import { describe, expect, it } from 'vitest';
import { ROOM_CODE_LENGTH } from './roomCode.js';
import { GAME_IDS, GAME_LIST, gameById, gameBySlug, isGameId, isGameSlug } from './games.js';
import { gameIdSchema } from './protocol.js';

describe('game registry', () => {
  it('has lowercase-letter slugs that can never be mistaken for a room code', () => {
    for (const g of GAME_LIST) {
      expect(g.slug).toMatch(/^[a-z]+$/);
      expect(g.slug).not.toHaveLength(ROOM_CODE_LENGTH);
    }
  });

  it('has unique ids and slugs, and the wire schema knows every id', () => {
    expect(new Set(GAME_LIST.map((g) => g.id)).size).toBe(GAME_LIST.length);
    expect(new Set(GAME_LIST.map((g) => g.slug)).size).toBe(GAME_LIST.length);
    expect([...gameIdSchema.options].sort()).toEqual([...GAME_IDS].sort());
  });

  it('describes every game well enough for a library card', () => {
    for (const g of GAME_LIST) {
      expect(g.name.length).toBeGreaterThan(0);
      expect(g.tagline.length).toBeGreaterThan(0);
      expect(g.howToPlay.length).toBeGreaterThan(0);
      expect(g.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(g.minPlayers).toBeGreaterThanOrEqual(1);
      expect(g.maxPlayers).toBeGreaterThanOrEqual(g.minPlayers);
    }
  });

  it('resolves ids and slugs', () => {
    expect(gameById('skribble')).toMatchObject({ slug: 'skribble', status: 'live', minPlayers: 2, maxPlayers: 20 });
    expect(gameById('template')).toMatchObject({ slug: 'template', name: 'Click Race', status: 'hidden' });
    expect(gameBySlug('skribble')?.id).toBe('skribble');
    expect(gameBySlug('ABCD')).toBeUndefined();
    expect(isGameSlug('template')).toBe(true);
    expect(isGameSlug('nope')).toBe(false);
    expect(isGameId('skribble')).toBe(true);
    expect(isGameId('chess')).toBe(false);
  });
});
