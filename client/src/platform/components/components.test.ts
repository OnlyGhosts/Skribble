import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../store/usePlatformStore');
const { player, resetStore, room, welcome } = await import('../../test/fixtures');
const { Chat } = await import('./Chat');
const { SettingsPanel } = await import('./SettingsPanel');
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

/** The declarations of the first rule whose selector list starts with `selector`. */
function ruleOf(css: string, selector: string): string {
  const block = css.match(new RegExp(`\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\{([^}]*)\}`))?.[1];
  if (block === undefined) throw new Error(`no rule for ${selector}`);
  return block;
}

function stylesheet(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../styles/${name}`, import.meta.url)), 'utf8');
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

describe('platform settings', () => {
  it('offers the three content modes to the host, with the adults-only tag on Unhinged', () => {
    const html = renderToString(createElement(SettingsPanel, { room: room(), isHost: true, game: null }));
    expect(html).not.toContain('settings-maxPlayers');
    expect(tagWith(html, 'settings-contentMode')).toContain('data-value="family"');
    for (const mode of ['family', 'cheeky', 'unhinged']) expect(tagWith(html, `content-mode-${mode}`)).not.toContain('disabled');
    expect(tagWith(html, 'content-mode-family')).toContain('aria-checked="true"');
    expect(html).toContain('18+');
    expect(html).toContain('Adults only');
    expect(tagWith(html, 'settings-allowMidGameJoin')).not.toContain('disabled');
  });

  it('keeps the adults-only tag legible in both themes and leaves read-only cards undimmed', () => {
    const css = stylesheet('lobby.css');
    const tag = ruleOf(css, '.content-mode__age');
    expect(tag).toContain('color: var(--color-danger-text)');
    expect(tag).toContain('background: var(--color-danger-soft)');
    expect(tag).not.toContain('#fff');
    expect(ruleOf(css, '.content-mode:disabled')).not.toContain('opacity');
  });

  it('renders read-only values for non-hosts', () => {
    const unhinged = room({ settings: { ...room().settings, contentMode: 'unhinged' } });
    const html = renderToString(createElement(SettingsPanel, { room: unhinged, isHost: false, game: null }));
    expect(tagWith(html, 'settings-value-contentMode')).toBeTruthy();
    expect(html).toContain('Unhinged');
    for (const mode of ['family', 'cheeky', 'unhinged']) expect(tagWith(html, `content-mode-${mode}`)).toContain('disabled');
    expect(tagWith(html, 'content-mode-unhinged')).toContain('aria-checked="true"');
    expect(tagWith(html, 'settings-allowMidGameJoin')).toContain('disabled');
    expect(html).toContain('Only the host can change settings.');
  });
});

describe('podium overlay', () => {
  const ended = (meId: string) => {
    const state = room({
      phase: 'ended',
      players: [player('host', { score: 10 }), player('bob', { score: 30, joinOrder: 1 }), player('carol', { score: 20, joinOrder: 2 }), player('dan', { score: 0, joinOrder: 3, participating: false, sittingOut: true })],
      podium: [
        { playerId: 'bob', score: 30, rank: 1 },
        { playerId: 'carol', score: 20, rank: 2 },
        { playerId: 'host', score: 10, rank: 3 },
      ],
    });
    return { room: state, meId };
  };

  it('celebrates the winner by name, tells each player their place and ranks the podium with the winner in the middle', () => {
    const html = renderToString(createElement(PodiumOverlay, { ...ended('bob'), isHost: false }));
    expect(tagWith(html, 'overlay-game-end')).toContain('data-winner="true"');
    expect(html).toContain('bob wins!');
    expect(html).toContain('You won!');
    expect(html).toContain('data-testid="confetti"');
    expect(html.match(/data-rank="(\d)"/g)).toEqual(['data-rank="2"', 'data-rank="1"', 'data-rank="3"']);
    const third = renderToString(createElement(PodiumOverlay, { ...ended('host'), isHost: true }));
    expect(third).toContain('You came 3rd');
    expect(tagWith(third, 'overlay-game-end')).toContain('data-winner="false"');
    const second = renderToString(createElement(PodiumOverlay, { ...ended('carol'), isHost: false }));
    expect(second).toContain('You came 2nd');
    const spectator = renderToString(createElement(PodiumOverlay, { ...ended('dan'), isHost: false }));
    expect(spectator).toContain('You sat this one out');
  });

  it('announces a tie instead of crowning the first of the tied players', () => {
    const tied = room({
      phase: 'ended',
      players: [player('host', { score: 30 }), player('bob', { score: 30, joinOrder: 1 })],
      podium: [
        { playerId: 'host', score: 30, rank: 1 },
        { playerId: 'bob', score: 30, rank: 1 },
      ],
    });
    const html = renderToString(createElement(PodiumOverlay, { room: tied, meId: 'bob', isHost: false }));
    expect(html).toContain('host and bob tie!');
    expect(html).toContain('You tied for the win!');
    expect(html).not.toContain('host wins!');
  });

  it('offers Ready for the next game to everyone with the count, and Play again / Back to lobby to the host only', () => {
    const guest = renderToString(createElement(PodiumOverlay, { ...ended('bob'), isHost: false }));
    expect(tagWith(guest, 'ready-toggle')).toContain('aria-pressed="false"');
    expect(guest).toContain('Ready for the next game');
    expect(guest).toContain('data-testid="sitout-toggle"');
    // The host counts as ready by pressing Start; dan sits out and is not counted.
    expect(guest).toContain('1 of 3 ready');
    expect(guest).not.toContain('data-testid="back-to-lobby"');
    expect(guest).not.toContain('data-testid="play-again"');
    expect(guest).toContain('host picks what comes next');
    const host = renderToString(createElement(PodiumOverlay, { ...ended('host'), isHost: true }));
    expect(host).toContain('data-testid="back-to-lobby"');
    expect(host).toContain('data-testid="play-again"');
    // The host is counted as ready (Play again starts the game), and their toggle says so rather than asking.
    expect(tagWith(host, 'ready-toggle')).toContain('aria-pressed="true"');
    expect(tagWith(host, 'ready-toggle')).toContain('disabled');
    expect(host).toContain('you start the game');
    expect(host).toContain('1 of 3 ready');
    expect(tagWith(host, 'sitout-toggle')).not.toContain('disabled');
  });

  it('keeps Ready and the host buttons out of the scrolling standings, so a small phone never hides them below the fold', () => {
    const html = renderToString(createElement(PodiumOverlay, { ...ended('host'), isHost: true }));
    const standings = html.indexOf('data-testid="podium-standings"');
    const standingsEnd = html.indexOf('data-testid="podium-next"');
    expect(standings).toBeGreaterThan(-1);
    expect(html.slice(standings, standingsEnd)).toContain('data-testid="podium-entry"');
    for (const id of ['ready-toggle', 'sitout-toggle', 'play-again', 'back-to-lobby']) expect(html.indexOf(`data-testid="${id}"`)).toBeGreaterThan(standingsEnd);
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.podium-card')).toContain('overflow: hidden');
    expect(ruleOf(css, '.podium-card__scroll')).toContain('overflow-y: auto');
    expect(ruleOf(css, '.podium-card__scroll')).toContain('min-height: 0');
    expect(ruleOf(css, '.podium-next')).toContain('flex: 0 0 auto');
  });

  it('keeps Leave out of reach: no leave button on the card, only in the closed options sheet behind a confirmation', () => {
    const html = renderToString(createElement(PodiumOverlay, { ...ended('bob'), isHost: false }));
    expect(html).not.toContain('data-testid="podium-leave"');
    expect(html).not.toContain('Leave room');
    expect(html).toContain('data-testid="podium-menu"');
  });

  it('is a modal dialog whose card (never a button) takes the focus away from the game screen behind it', () => {
    const html = renderToString(createElement(PodiumOverlay, { ...ended('host'), isHost: true }));
    const dialog = tagWith(html, 'overlay-game-end');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(tagWith(html, 'podium-card')).toContain('tabindex="-1"');
  });
});
