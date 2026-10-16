/**
 * A full room of 50: the lobby, the players sheet and the results list every player, each long
 * list scrolling inside its own panel, and the game picker reads out each game's seat range.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { GameId } from '@shared/platform/games';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { ROOM_HARD_CAP } = await import('@shared/platform/settings');
const { player, resetStore, room } = await import('../../test/fixtures');
const { GamePicker } = await import('./GamePicker');
const { PlayerList } = await import('./PlayerList');
const { ResultsPopup } = await import('./ResultsPopup');
const { Lobby } = await import('../screens/Lobby');

const ids = Array.from({ length: ROOM_HARD_CAP }, (_, i) => (i === 0 ? 'host' : `p${i}`));
const full = (overrides: Parameters<typeof room>[0] = {}) => room({ players: ids.map((id, i) => player(id, { joinOrder: i, score: (ROOM_HARD_CAP - i) * 10 })), ...overrides });
const rows = (html: string) => html.match(/data-testid="player-item"/g)?.length ?? 0;

function ruleOf(css: string, selector: string): string {
  const block = css.match(new RegExp(`\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1];
  if (block === undefined) throw new Error(`no rule for ${selector}`);
  return block;
}

function stylesheet(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../styles/${name}`, import.meta.url)), 'utf8');
}

beforeEach(() => resetStore());

describe('a full room of 50', () => {
  it('lists all 50 in the lobby, in a list that scrolls on its own so the settings and chat stay close', () => {
    expect(ROOM_HARD_CAP).toBe(50);
    expect(rows(renderToString(createElement(Lobby, { room: full(), game: null })))).toBe(50);
    const list = ruleOf(stylesheet('lobby.css'), '.lobby__players .player-list');
    expect(list).toContain('max-height: min(60dvh, 560px)');
    expect(list).toContain('overflow-y: auto');
    expect(ruleOf(stylesheet('lobby.css'), '.lobby__players .player')).toContain('flex: none');
  });

  it('lists all 50 in the players sheet and in the results, each scrolling inside its panel', () => {
    expect(rows(renderToString(createElement(PlayerList, { room: full({ phase: 'playing' }), meId: 'host', isHost: true, mode: 'game', game: null })))).toBe(50);
    const entries = ids.map((playerId, i) => ({ playerId, name: playerId, avatar: { color: 0, emoji: 0 }, score: (ROOM_HARD_CAP - i) * 10, rank: i + 1 }));
    const html = renderToString(createElement(ResultsPopup, { results: { id: 'r', gameId: 'scribble', reason: 'finished', entries }, meId: 'p49', onClose: () => undefined }));
    expect(html.match(/data-testid="results-entry"/g)).toHaveLength(50);
    expect(html).toContain('You came 50th');
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.sheet__body')).toContain('overflow-y: auto');
    expect(ruleOf(css, '.results-card__scroll')).toContain('overflow-y: auto');
  });

  it("reads out each game's seat range: no cap for Blackjack and Quip Game, 2 to 23 for Poker", () => {
    const metaOf = (gameId: GameId) => renderToString(createElement(GamePicker, { room: room({ gameId }), isHost: true })).replace(/<!-- -->/g, '').match(/data-testid="game-picker-meta">([^<]*)</)?.[1];
    expect(metaOf('poker')).toBe('Poker · 2 to 23 players');
    expect(metaOf('blackjack')).toBe('Blackjack · 1+ players');
    expect(metaOf('quipgame')).toBe('Quip Game · 3+ players');
  });
});
