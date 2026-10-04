import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();

const { useGameStore } = await import('../store/useGameStore');
const { resetStore, room, welcome } = await import('../test/fixtures');
const { Chat, placeholderFor } = await import('./Chat');
const { GuessInput } = await import('./GuessInput');
const { SettingsPanel, maxPlayersMin } = await import('./SettingsPanel');
const { Timer } = await import('./Timer');
const { WordDisplay } = await import('./WordDisplay');
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
    useGameStore.setState({ clockOffset: 0 });
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

describe('chat placeholders', () => {
  it('tells the drawer that only players who guessed can read them', () => {
    expect(placeholderFor('drawing', true, true)).toBe('Chat with players who guessed...');
    expect(placeholderFor('drawing', false, false)).toBe('Type your guess...');
    expect(placeholderFor('drawing', false, true)).toBe('You guessed it! Chat with others who know...');
    expect(placeholderFor('lobby', true, false)).toBe('Chat...');
  });
});

describe('inputs while reconnecting', () => {
  it('keeps the guess tiles input enabled (so it keeps focus and the keyboard) and disables only Send', () => {
    useGameStore.setState({ connection: 'reconnecting' });
    const html = renderToString(createElement(GuessInput, { mask: '_____', focusMemory: { current: false } }));
    expect(tagWith(html, 'chat-input')).not.toContain('disabled');
    expect(tagWith(html, 'chat-send')).toContain('disabled');
  });

  it('keeps the plain chat input enabled too', () => {
    useGameStore.getState().handleServerMessage(welcome('bob', room()));
    useGameStore.setState({ connection: 'reconnecting' });
    const html = renderToString(createElement(Chat));
    expect(tagWith(html, 'chat-input')).not.toContain('disabled');
    expect(tagWith(html, 'chat-send')).toContain('disabled');
  });
});

describe('guess tiles for assistive tech and narrow bars', () => {
  it('describes the word shape and revealed hints to the real input', () => {
    useGameStore.setState({ connection: 'connected' });
    const html = renderToString(createElement(GuessInput, { mask: 'a__l_', focusMemory: { current: false } }));
    expect(tagWith(html, 'chat-input')).toContain('aria-describedby="guess-word-description"');
    expect(html).toContain('5 letters. Revealed: A blank blank L blank.');
  });

  it('tells each tile group how many letters it holds so the tiles can shrink to fit', () => {
    const html = renderToString(createElement(GuessInput, { mask: '__________ ___-_', focusMemory: { current: false } }));
    expect(html).toContain('--letters:10;--seps:0');
    expect(html).toContain('--letters:4;--seps:1');
  });

  it('exposes the header mask as an image with the same description', () => {
    const html = renderToString(createElement(WordDisplay, { mask: '___ __', isDrawer: false }));
    const tag = tagWith(html, 'word-mask');
    expect(tag).toContain('role="img"');
    expect(tag).toContain('aria-label="5 letters in 2 words."');
  });
});

describe('max players slider', () => {
  it('cannot go below the number of seated players', () => {
    expect(maxPlayersMin(0)).toBe(2);
    expect(maxPlayersMin(3)).toBe(3);
    expect(maxPlayersMin(99)).toBe(20);
    const html = renderToString(createElement(SettingsPanel, { settings: { ...DEFAULT_SETTINGS, maxPlayers: 3 }, isHost: true, playerCount: 3 }));
    expect(tagWith(html, 'settings-maxPlayers')).toContain('min="3"');
    expect(tagWith(html, 'settings-rounds')).toContain('min="1"');
  });
});
