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
const { remainingMs } = await import('../lib/useCountdown');

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
