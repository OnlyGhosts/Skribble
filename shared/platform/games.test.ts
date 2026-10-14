import { describe, expect, it } from 'vitest';
import { ROOM_CODE_LENGTH } from './roomCode.js';
import { GAME_IDS, GAME_LIST, gameByFormerSlug, gameById, gameBySlug, isGameId, isGameSlug } from './games.js';
import { gameIdSchema } from './protocol.js';

describe('game registry', () => {
  it('has lowercase-letter slugs (current and former) that can never be mistaken for a room code', () => {
    for (const g of GAME_LIST) {
      for (const slug of [g.slug, ...(g.formerSlugs ?? [])]) {
        expect(slug).toMatch(/^[a-z]+$/);
        expect(slug).not.toHaveLength(ROOM_CODE_LENGTH);
      }
    }
  });

  it('never reuses a current slug as a former one', () => {
    const current = new Set(GAME_LIST.map((g) => g.slug));
    const former = GAME_LIST.flatMap((g) => g.formerSlugs ?? []);
    expect(new Set(former).size).toBe(former.length);
    for (const slug of former) expect(current.has(slug)).toBe(false);
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
      // A 24px line glyph: path data only.
      expect(g.glyph).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/);
      expect(typeof g.contentModes).toBe('boolean');
      expect(g.minPlayers).toBeGreaterThanOrEqual(1);
      // null means the room's hard cap seats everyone; a limit can never sit below the minimum.
      if (g.maxPlayers !== null) expect(g.maxPlayers).toBeGreaterThanOrEqual(g.minPlayers);
    }
  });

  it('resolves ids and slugs', () => {
    // Shown as Scribble; the internal id stays 'skribble' (stored rooms carry it) and old links redirect.
    expect(gameById('skribble')).toMatchObject({ slug: 'scribble', name: 'Scribble', status: 'live', minPlayers: 2, maxPlayers: null });
    expect(gameBySlug('scribble')?.id).toBe('skribble');
    expect(gameBySlug('skribble')).toBeUndefined();
    expect(gameByFormerSlug('skribble')?.slug).toBe('scribble');
    expect(gameByFormerSlug('scribble')).toBeUndefined();
    expect(gameById('template')).toMatchObject({ slug: 'template', name: 'Click Race', status: 'hidden' });
    expect(gameBySlug('ABCD')).toBeUndefined();
    expect(isGameSlug('template')).toBe(true);
    expect(isGameSlug('nope')).toBe(false);
    expect(isGameId('skribble')).toBe(true);
    expect(isGameId('chess')).toBe(false);
  });

  it('offers content modes only for the games that read settings.contentMode', () => {
    const withModes = GAME_LIST.filter((g) => g.contentModes).map((g) => g.id);
    expect(withModes.sort()).toEqual(['hangman', 'quipgame', 'skribble', 'spygame']);
  });
});
