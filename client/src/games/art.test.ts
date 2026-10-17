import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();

const { GAMES } = await import('./index');
const { GAME_LIST } = await import('@shared/platform/games');
const { registerGames } = await import('../platform/registry');
const { GamePicker } = await import('../platform/components/GamePicker');
const { ART_VIEWBOX } = await import('../platform/components/GameArt');
const { room } = await import('../test/fixtures');

const tiles = (html: string): string[] => html.split('data-testid="game-tile"').slice(1);

describe('every game’s picture', () => {
  it('is an inline SVG in the GameArt frame, hidden from assistive tech (the name is beside it), drawn in tokens only', () => {
    for (const g of GAME_LIST) {
      const html = renderToString(createElement(GAMES[g.id].Art));
      expect(html, g.id).toMatch(/^<svg /);
      expect(html, g.id).toContain('aria-hidden="true"');
      expect(html, g.id).toContain(`data-art="${g.id}"`);
      expect(html, g.id).toContain(`viewBox="${ART_VIEWBOX}"`);
      // The hard shadow: the same drawing once more under itself, which components.css turns solid ink.
      expect(html, g.id).toContain('class="game-art__shadow"');
      // The mascots' palette comes through the theme tokens, never a raw colour, so both themes draw it alike.
      expect(html, g.id).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      for (const colour of html.match(/(?:fill|stroke)="[^"]+"/g) ?? []) expect(colour, g.id).toMatch(/^(?:fill|stroke)="(?:none|var\(--[a-z-]+\))"$/);
    }
  });

  it('shows on its lobby tile: every live game for the host, the one current game for a guest', () => {
    registerGames(GAMES);
    const host = renderToString(createElement(GamePicker, { room: room(), isHost: true, game: null }));
    const live = GAME_LIST.filter((g) => g.status === 'live');
    expect(tiles(host)).toHaveLength(live.length);
    for (const tile of tiles(host)) {
      const id = tile.match(/data-game="([a-z]+)"/)?.[1];
      expect(tile).toContain(`<span class="game-tile__art"><svg class="game-art" viewBox="${ART_VIEWBOX}" aria-hidden="true" focusable="false" data-art="${id}">`);
      expect(tile.indexOf('data-art=')).toBeLessThan(tile.indexOf('class="game-tile__name"'));
    }
    const guest = renderToString(createElement(GamePicker, { room: room({ gameId: 'poker' }), isHost: false, game: null }));
    expect(tiles(guest)).toHaveLength(1);
    expect(guest.match(/data-art="/g)).toHaveLength(1);
    expect(guest).toContain('data-art="poker"');
  });
});
