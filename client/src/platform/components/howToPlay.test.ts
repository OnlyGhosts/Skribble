import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { room } = await import('../../test/fixtures');
const { gameById } = await import('@shared/platform/games');
const { HowToPlay, HowToPlayDialog, popoverRoom } = await import('./HowToPlay');
const { GamePicker } = await import('./GamePicker');
const { templateRules } = await import('../../games/template/rules');
const { pokerRules } = await import('../../games/poker/rules');

const lobbyCss = readFileSync(fileURLToPath(new URL('../styles/lobby.css', import.meta.url)), 'utf8');

/** The body of the first rule for exactly `selector`. */
function ruleOf(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

/** The outer HTML of the first element carrying the test id (its own tag only, for attributes). */
function tagWith(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at, testId).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

const noop = () => undefined;
const poker = gameById('poker');
const template = gameById('template');

describe('the How to play button', () => {
  it('is a labelled 44px button that says it opens a dialog, closed to start with', () => {
    const html = renderToString(createElement(HowToPlay, { meta: poker, rules: pokerRules }));
    const button = tagWith(html, 'how-to-play');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('type="button"');
    expect(html).toContain('How to play');
    expect(html).not.toContain('role="dialog"');
    expect(ruleOf(lobbyCss, '.how-to-play__btn')).toContain('min-height: 44px');
  });

  it('is beside the game’s line for the host and under who picks for a guest, only once the module is known', () => {
    const module = { meta: template, Screen: () => null, rules: templateRules };
    const host = renderToString(createElement(GamePicker, { room: room({ gameId: 'template' }), isHost: true, game: module }));
    expect(host).toContain('data-testid="game-picker-meta"');
    expect(host.replace(/<!-- -->/g, '').replace(/<span class="game-picker__count">/g, '').replace(/<\/span>/g, '')).toContain('Click Race · 1+ players');
    // The count keeps to one piece, so a narrow line breaks at the dot.
    expect(host).toContain('<span class="game-picker__count">1+ players</span>');
    expect(host.indexOf('data-testid="how-to-play"')).toBeGreaterThan(host.indexOf('data-testid="game-picker-meta"'));
    const guest = renderToString(createElement(GamePicker, { room: room({ gameId: 'template' }), isHost: false, game: module }));
    expect(guest.indexOf('data-testid="how-to-play"')).toBeGreaterThan(guest.indexOf('data-testid="game-picker-note"'));
    expect(renderToString(createElement(GamePicker, { room: room(), isHost: false, game: null }))).not.toContain('how-to-play');
    // The line and the button share one row even on the narrowest phones: the line wraps its words, the button never drops under the footer.
    expect(ruleOf(lobbyCss, '.game-picker__foot')).not.toContain('flex-wrap');
    expect(ruleOf(lobbyCss, '.game-picker__meta')).toContain('min-width: 0');
    expect(ruleOf(lobbyCss, '.game-picker__foot .how-to-play')).toContain('flex: none');
  });
});

describe('the How to play card', () => {
  it('is a popover dialog on a desktop: named after the game, its close button, the name, summary and five sections', () => {
    const html = renderToString(createElement(HowToPlayDialog, { meta: poker, rules: pokerRules, open: true, mode: 'popover', onClose: noop, id: 'rules-1' }));
    const dialog = tagWith(html, 'how-to-play-popover');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-label="How to play Poker"');
    expect(dialog).toContain('id="rules-1"');
    expect(dialog).not.toContain('aria-modal');
    expect(dialog).toContain('tabindex="-1"');
    expect(tagWith(html, 'how-to-play-close')).toContain('aria-label="Close"');
    expect(tagWith(html, 'how-to-play-card')).toContain('data-mode="popover"');
    expect(html).toContain('data-testid="rules-name"');
    expect(html).toContain('>Poker<');
    expect(html).toContain(pokerRules.summary.replace(/ (\S+)$/, ' $1'));
    expect(html.match(/data-testid="rules-section"/g)).toHaveLength(5);
    expect(html).toContain('How a hand goes');
    expect(html).toContain('data-glyph="poker"');
    // No backdrop: the room under it stays usable, and it hangs off the button.
    expect(html).not.toContain('backdrop');
    expect(ruleOf(lobbyCss, '.how-to-play__popover')).toContain('position: absolute');
    expect(ruleOf(lobbyCss, '.how-to-play__scroll')).toContain('overflow-y: auto');
    expect(ruleOf(lobbyCss, '.how-to-play__popover::before')).toContain('rotate(45deg)');
  });

  it('is the bottom sheet on a phone or tablet, named after the game, with the same card inside', () => {
    const html = renderToString(createElement(HowToPlayDialog, { meta: template, rules: templateRules, open: true, mode: 'sheet', onClose: noop }));
    const sheet = tagWith(html, 'how-to-play-sheet');
    expect(sheet).toContain('role="dialog"');
    expect(sheet).toContain('aria-modal="true"');
    expect(sheet).toContain('aria-label="How to play Click Race"');
    expect(html).toContain('data-testid="how-to-play-sheet-close"');
    expect(html).toContain('data-testid="how-to-play-sheet-backdrop"');
    expect(html).toContain('>How to play<');
    expect(tagWith(html, 'how-to-play-card')).toContain('data-mode="sheet"');
    expect(html).toContain('>Click\u00a0Race<');
    expect(html).toContain('How a round goes');
    expect(html.match(/data-testid="rules-section"/g)).toHaveLength(5);
    expect(html).not.toContain('how-to-play-popover');
  });

  it('opens under the button while the footer leaves room, else whichever way is roomier, and over the footer only on a short screen', () => {
    // 1440x900, the host: 313px to the footer is enough to hang under the button.
    expect(popoverRoom(313, 323, 475)).toEqual({ above: false, maxHeight: 313 });
    // 1024x768, the host: 181px to the footer, 363px over the button: it opens upwards and leaves Start in reach.
    expect(popoverRoom(181, 363, 341)).toEqual({ above: true, maxHeight: 363 });
    // Under the button when that is the roomier side, even when short.
    expect(popoverRoom(250, 120, 400)).toEqual({ above: false, maxHeight: 250 });
    // A screen too short either way: down over the footer, with the floor.
    expect(popoverRoom(40, 120, 330)).toEqual({ above: false, maxHeight: 330 });
    expect(popoverRoom(40, 180, 150)).toEqual({ above: true, maxHeight: 200 });
    // The scroll box shows a shadow at an edge with more to read, so a short box reads as scrollable.
    expect(ruleOf(lobbyCss, '.how-to-play__scroll')).toContain('--color-scroll-shadow');
  });

  it('renders nothing while closed, in either shape', () => {
    for (const mode of ['popover', 'sheet'] as const) {
      expect(renderToString(createElement(HowToPlayDialog, { meta: poker, rules: pokerRules, open: false, mode, onClose: noop }))).toBe('');
    }
  });
});
