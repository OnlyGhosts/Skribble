import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { gameById } from '@shared/platform/games';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../store/usePlatformStore');
const { player, resetStore, room, welcome } = await import('../../test/fixtures');
const { Chat } = await import('./Chat');
const { SettingsPanel, maxPlayersMin } = await import('./SettingsPanel');
const { Timer } = await import('./Timer');
const { PodiumOverlay } = await import('./PodiumOverlay');
const { WaitingOverlay, missingPlayers, waitingTitle } = await import('./WaitingOverlay');
const { ReconnectingBanner, reconnectLabel } = await import('./ReconnectingBanner');
const { homeView } = await import('../screens/GameHome');
const { remainingMs } = await import('../lib/useCountdown');

/** The z-index of the first rule whose selector list starts with `selector`. */
function zIndexOf(css: string, selector: string): number {
  const block = css.match(new RegExp(`\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\{([^}]*)\}`))?.[1] ?? '';
  const z = block.match(/z-index:\s*(-?\d+)/)?.[1];
  if (z === undefined) throw new Error(`no z-index on ${selector}`);
  return Number(z);
}

/** Attributes of the first tag carrying `data-testid="<id>"` in the markup. */
function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid=${testId} in ${html}`);
  return match[0];
}

beforeEach(resetStore);

describe('Timer first render', () => {
  it('shows the real remaining time on the very first paint, never a flash of "0"', () => {
    usePlatformStore.setState({ clockOffset: 0 });
    const html = renderToString(createElement(Timer, { endsAt: Date.now() + 15_000, warnUnder: 10 }));
    const tag = tagWith(html, 'timer');
    expect(tag).toMatch(/data-seconds="1[45]"/);
    expect(tag).not.toContain('timer--urgent');
  });

  it('computes the remaining time on the server clock', () => {
    expect(remainingMs(10_000, 2_000, 5_000)).toBe(3_000);
    expect(remainingMs(10_000, 0, 12_000)).toBe(0);
    expect(remainingMs(null, 500)).toBe(0);
  });
});

describe('Timer paused', () => {
  it('freezes with a pause glyph instead of running out while the game holds', () => {
    const html = renderToString(createElement(Timer, { endsAt: Date.now() - 5_000, warnUnder: 10, paused: true }));
    const tag = tagWith(html, 'timer');
    expect(tag).toContain('timer--paused');
    expect(tag).not.toContain('timer--urgent');
    expect(tag).toContain('aria-label="Paused"');
    expect(tag).toContain('data-paused="players"');
    expect(tag).toContain('data-face="paused"');
  });

  it('shows a waiting face, never a red "0", while the server settles after a deadline', () => {
    const html = renderToString(createElement(Timer, { endsAt: Date.now() - 1_000, warnUnder: 0, settling: true }));
    const tag = tagWith(html, 'timer');
    expect(tag).toContain('timer--settling');
    expect(tag).not.toContain('timer--urgent');
    expect(tag).not.toContain('timer--paused');
    expect(tag).toContain('aria-label="Starting soon"');
    expect(tag).toContain('data-face="settling"');
    expect(tag).not.toContain('data-paused=');
    expect(html).toContain('class="spinner"');
    expect(html).not.toMatch(/timer__value">0</);
    // A hold outranks a settle: the pause glyph stays.
    const both = tagWith(renderToString(createElement(Timer, { endsAt: Date.now() - 1_000, paused: true, settling: true })), 'timer');
    expect(both).toContain('data-face="paused"');
    expect(both).not.toContain('timer--settling');
  });
});

describe('waiting overlay', () => {
  const holding = room({
    phase: 'playing',
    players: [player('host'), player('bob', { joinOrder: 1, connected: false }), player('carol', { joinOrder: 2, connected: false })],
    waiting: { reason: 'players', missing: ['bob', 'carol', 'gone'], needed: 3, connected: 1 },
  });

  it('names the missing players, counts the connected ones and offers Leave to everyone', () => {
    expect(waitingTitle([])).toBe('Waiting for players to reconnect');
    expect(waitingTitle(['Bob'])).toBe('Waiting for Bob to reconnect');
    expect(waitingTitle(['Bob', 'Carol', 'Dan'])).toBe('Waiting for Bob, Carol and Dan to reconnect');
    // A missing player who was removed in the meantime is no longer listed.
    expect(missingPlayers(holding, holding.waiting!).map((p) => p.id)).toEqual(['bob', 'carol']);

    const html = renderToString(createElement(WaitingOverlay, { room: holding, waiting: holding.waiting!, isHost: false }));
    expect(html).toContain('Waiting for bob and carol to reconnect');
    expect(html).toContain('1 of 3 players connected');
    expect(html).toContain('data-testid="waiting-leave"');
    expect(html).not.toContain('data-testid="waiting-remove"');
    expect(html.match(/avatar--dimmed/g)).toHaveLength(2);
  });

  it('lets the host remove each missing player and explains what that does', () => {
    const html = renderToString(createElement(WaitingOverlay, { room: holding, waiting: holding.waiting!, isHost: true }));
    const buttons = html.match(/<button[^>]*data-testid="waiting-remove"[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('data-player-id="bob"');
    expect(html).toContain('Remove bob');
    expect(html).toContain('Remove carol');
    expect(html).toContain('data-testid="waiting-remove-hint"');
  });

  it('is a modal dialog whose card can take the focus away from the game screen behind it', () => {
    const html = renderToString(createElement(WaitingOverlay, { room: holding, waiting: holding.waiting!, isHost: true }));
    const dialog = tagWith(html, 'overlay-waiting');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('data-connected="1"');
    expect(dialog).toContain('data-needed="3"');
    const card = html.match(/<div class="overlay__card[^"]*"[^>]*>/)?.[0] ?? '';
    expect(card).toContain('tabindex="-1"');
  });

  it('never renders without a name: a stale list naming only the viewer or players already back is no hold to show', () => {
    // The welcome of the player who just came back: the hold still names them, the list shows them connected.
    const stale = room({
      phase: 'playing',
      players: [player('host'), player('bob', { joinOrder: 1, connected: true })],
      waiting: { reason: 'players', missing: ['bob'], needed: 2, connected: 2 },
    });
    expect(missingPlayers(stale, stale.waiting!)).toEqual([]);
    expect(renderToString(createElement(WaitingOverlay, { room: stale, waiting: stale.waiting!, isHost: true, meId: 'host' }))).toBe('');
    // A frame built just before the viewer's own reconnect was folded in.
    const mine = room({
      phase: 'playing',
      players: [player('host'), player('bob', { joinOrder: 1, connected: false })],
      waiting: { reason: 'players', missing: ['bob'], needed: 2, connected: 1 },
    });
    expect(missingPlayers(mine, mine.waiting!, 'bob')).toEqual([]);
    expect(renderToString(createElement(WaitingOverlay, { room: mine, waiting: mine.waiting!, isHost: false, meId: 'bob' }))).toBe('');
    expect(renderToString(createElement(WaitingOverlay, { room: mine, waiting: mine.waiting!, isHost: true, meId: 'host' }))).toContain('Waiting for bob to reconnect');
    // An empty list, whatever the server meant by it.
    const empty = { ...mine, waiting: { reason: 'players' as const, missing: [], needed: 2, connected: 1 } };
    expect(renderToString(createElement(WaitingOverlay, { room: empty, waiting: empty.waiting, isHost: true, meId: 'host' }))).toBe('');
  });

  it('stacks above the phone bottom sheets (the hold can start while one is open) and below the toasts', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles/components.css', import.meta.url)), 'utf8');
    const sheet = zIndexOf(css, '.sheet');
    expect(zIndexOf(css, '.waiting-overlay')).toBeGreaterThan(sheet);
    expect(zIndexOf(css, '.podium-overlay')).toBeGreaterThan(sheet);
    expect(zIndexOf(css, '.waiting-overlay')).toBeLessThan(zIndexOf(css, '.toasts'));
    // The remove buttons keep a 44px target and let a long name wrap instead of overflowing the card.
    const remove = css.slice(css.indexOf('.waiting__remove .btn {'));
    expect(remove.slice(0, remove.indexOf('}'))).toMatch(/min-height: 44px/);
    expect(remove.slice(0, remove.indexOf('}'))).toMatch(/white-space: normal/);
  });
});

describe('reconnecting banner', () => {
  it('shows over the game screen while the socket is down and not at all while connected', () => {
    expect(reconnectLabel('reconnecting')).toBe('Reconnecting…');
    expect(reconnectLabel('connecting')).toBe('Connecting…');
    expect(reconnectLabel('connected')).toBeNull();
    // The store starts out connecting (react-dom/server reads the store's initial state).
    const html = renderToString(createElement(ReconnectingBanner));
    const tag = tagWith(html, 'reconnecting-banner');
    expect(tag).toContain('data-status="connecting"');
    expect(tag).toContain('role="status"');
    expect(html).toContain('Connecting…');
  });
});

describe('game home while rejoining', () => {
  it('shows the rejoining spinner or the join form, never both once the rejoin has dragged on', () => {
    expect(homeView(false, false)).toBe('form');
    expect(homeView(false, true)).toBe('form');
    expect(homeView(true, false)).toBe('rejoining');
    expect(homeView(true, true)).toBe('stale');
  });
});

describe('chat while reconnecting', () => {
  it('keeps the input enabled (so it keeps focus and the keyboard) and disables only Send', () => {
    usePlatformStore.getState().handleServerMessage(welcome('bob', room()));
    usePlatformStore.setState({ connection: 'reconnecting' });
    const html = renderToString(createElement(Chat));
    expect(tagWith(html, 'chat-input')).not.toContain('disabled');
    expect(tagWith(html, 'chat-input')).toContain('placeholder="Chat..."');
    expect(tagWith(html, 'chat-send')).toContain('disabled');
  });
});

describe('max players slider', () => {
  const skribble = gameById('skribble');

  it('cannot go below the number of seated players nor outside the game’s range', () => {
    expect(maxPlayersMin(0, skribble)).toBe(2);
    expect(maxPlayersMin(3, skribble)).toBe(3);
    expect(maxPlayersMin(99, skribble)).toBe(20);
    const three = room({ players: [player('host'), player('bob'), player('carol')], settings: { ...room().settings, maxPlayers: 3 } });
    const html = renderToString(createElement(SettingsPanel, { room: three, isHost: true, game: null }));
    expect(tagWith(html, 'settings-maxPlayers')).toContain('min="3"');
    expect(tagWith(html, 'settings-maxPlayers')).toContain('max="20"');
    expect(tagWith(html, 'settings-allowMidGameJoin')).not.toContain('disabled');
  });

  it('renders read-only values for non-hosts', () => {
    const html = renderToString(createElement(SettingsPanel, { room: room(), isHost: false, game: null }));
    expect(html).not.toContain('data-testid="settings-maxPlayers"');
    expect(tagWith(html, 'settings-allowMidGameJoin')).toContain('disabled');
    expect(html).toContain('Only the host can change settings.');
  });
});

describe('podium overlay', () => {
  it('ranks the podium with the winner in the middle and offers Back to lobby to the host only', () => {
    const ended = room({
      phase: 'ended',
      players: [player('host', { score: 10 }), player('bob', { score: 30 }), player('carol', { score: 20 })],
      podium: [
        { playerId: 'bob', score: 30, rank: 1 },
        { playerId: 'carol', score: 20, rank: 2 },
        { playerId: 'host', score: 10, rank: 3 },
      ],
    });
    const html = renderToString(createElement(PodiumOverlay, { room: ended, isHost: true }));
    expect(html).toContain('bob wins!');
    expect(html.match(/data-rank="(\d)"/g)).toEqual(['data-rank="2"', 'data-rank="1"', 'data-rank="3"']);
    expect(html).toContain('data-testid="back-to-lobby"');
    const guest = renderToString(createElement(PodiumOverlay, { room: ended, isHost: false }));
    expect(guest).not.toContain('data-testid="back-to-lobby"');
    expect(guest).toContain('data-testid="podium-leave"');
  });

  it('is a modal dialog whose card can take the focus away from the game screen behind it', () => {
    const ended = room({ phase: 'ended', podium: [{ playerId: 'host', score: 10, rank: 1 }] });
    const html = renderToString(createElement(PodiumOverlay, { room: ended, isHost: true }));
    const dialog = tagWith(html, 'overlay-game-end');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    const card = html.match(/<div class="overlay__card[^"]*"[^>]*>/)?.[0] ?? '';
    expect(card).toContain('tabindex="-1"');
  });
});
