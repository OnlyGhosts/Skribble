import { describe, expect, it } from 'vitest';
import { GAME_IDS, GAME_LIST, gameById } from '../../shared/platform/games.js';
import { GAMES } from './index.js';

describe('server game registry', () => {
  it('registers exactly the games the shared registry lists, with matching metadata', () => {
    expect(Object.keys(GAMES).sort()).toEqual([...GAME_IDS].sort());
    for (const meta of GAME_LIST) {
      const module = GAMES[meta.id];
      expect(module.meta).toEqual(gameById(meta.id));
      expect(module.meta.id).toBe(meta.id);
    }
  });

  it('ships defaults that pass each module\'s own settings schema and a patch schema that accepts an empty patch', () => {
    for (const id of GAME_IDS) {
      const { settings } = GAMES[id];
      expect(settings.schema.safeParse(settings.defaults).success, id).toBe(true);
      expect(settings.patchSchema.safeParse({}).success, id).toBe(true);
      expect(settings.patchSchema.safeParse({ maxPlayers: 3 })).toMatchObject({ success: true, data: {} });
    }
  });

  it('declares side messages only together with a side store', () => {
    for (const id of GAME_IDS) {
      const module = GAMES[id];
      if (module.sideMessages) expect(typeof module.createSideStore, id).toBe('function');
    }
    expect([...(GAMES.skribble.sideMessages ?? [])].sort()).toEqual(['clear', 'draw', 'undo']);
    expect(GAMES.template.sideMessages).toBeUndefined();
  });
});
