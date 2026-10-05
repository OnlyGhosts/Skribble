/**
 * Click Race's client module under test: the template every new game's client tests can copy.
 * The tests run in node: browser globals are stubbed, components render through react-dom/server.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { TemplateRoomState } from '@shared/games/template/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { templateClient } = await import('./module');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

/** A race in progress between the host (7 taps) and bob (3 taps), as the server would snapshot it. */
function race(overrides: Partial<TemplateRoomState> = {}): TemplateRoomState {
  return {
    ...room({ gameId: 'template', phase: 'playing', players: [player('host'), player('bob', { joinOrder: 1 })] }),
    settings: { maxPlayers: 12, allowMidGameJoin: true, targetClicks: 10, timeLimit: 30 },
    game: { clicks: { host: 7, bob: 3 }, endsAt: Date.now() + 20_000, winnerId: null },
    ...overrides,
  };
}

/** Attributes of the first tag carrying `data-testid="<id>"` in the markup. */
function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid=${testId} in ${html}`);
  return match[0];
}

beforeEach(() => {
  resetStore();
  setLocation('/template/ABCD');
  registerGames(registryOf(templateClient));
});

describe('Click Race screen', () => {
  it('renders the tap button with my count, the ranking and the clock', () => {
    const state = race();
    usePlatformStore.getState().handleServerMessage(welcome('bob', state));
    const html = renderToString(createElement(templateClient.Screen, { room: state, meId: 'bob', isHost: false }));
    expect(tagWith(html, 'click-button')).not.toContain('disabled');
    expect(tagWith(html, 'click-button')).toContain('aria-label="Tap! 3 of 10"');
    // Mixed JSX text renders with comment separators under renderToString; assert on attributes instead.
    const rows = html.match(/<li[^>]*data-testid="race-row"[^>]*>/g) ?? [];
    expect(rows.map((r) => r.match(/data-name="([^"]+)"/)?.[1])).toEqual(['host', 'bob']);
    expect(rows.map((r) => r.match(/data-clicks="(\d+)"/)?.[1])).toEqual(['7', '3']);
    expect(tagWith(html, 'timer')).toMatch(/data-seconds="(19|20)"/);
  });

  it('disables the button once the race ended (the platform shows the podium over it)', () => {
    const state = race({ phase: 'ended', podium: [{ playerId: 'host', score: 100, rank: 1 }] });
    usePlatformStore.getState().handleServerMessage(welcome('host', state));
    const html = renderToString(createElement(templateClient.Screen, { room: state, meId: 'host', isHost: true }));
    expect(tagWith(html, 'click-button')).toContain('disabled');
  });
});

describe('Click Race settings rows', () => {
  it('renders both sliders with the shared limits for the host, read-only values otherwise', () => {
    const { settings } = race();
    if (!templateClient.SettingsFields) throw new Error('no settings fields');
    const host = renderToString(createElement(templateClient.SettingsFields, { settings, canEdit: true, patch: () => undefined }));
    expect(tagWith(host, 'settings-targetClicks')).toContain('min="10"');
    expect(tagWith(host, 'settings-timeLimit')).toContain('max="120"');
    const guest = renderToString(createElement(templateClient.SettingsFields, { settings, canEdit: false, patch: () => undefined }));
    expect(guest).not.toContain('data-testid="settings-targetClicks"');
    expect(tagWith(guest, 'settings-value-timeLimit')).toBeTruthy();
    expect(guest).toContain('30s');
  });
});
