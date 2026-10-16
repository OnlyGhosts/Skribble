import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../store/usePlatformStore');
const { player, resetStore, room, welcome } = await import('../../test/fixtures');
const { SettingsPanel } = await import('./SettingsPanel');
const { Timer } = await import('./Timer');
const { PodiumOverlay } = await import('./PodiumOverlay');
const { WaitingOverlay, missingPlayers, waitingTitle } = await import('./WaitingOverlay');
const { ReconnectingBanner, reconnectLabel } = await import('./ReconnectingBanner');
const { gameById } = await import('@shared/platform/games');
const { Home, cleanName, firstInvalidBox, focusAfterRefusal, homeView, initialGame, previewLine } = await import('../screens/Home');
const { Wordmark } = await import('./Wordmark');
const { WORDMARK_BOX, WORDMARK_GEAR_CENTRE, WORDMARK_GEAR_POSITION } = await import('../brand/wordmark');
const { PlayerList } = await import('./PlayerList');
const { BoredArt, HappyArt, MASCOTS_VIEWBOX, PHONE_BORED_VIEWBOX, PHONE_HAPPY_VIEWBOX, PhoneBored, PhoneHappy } = await import('./Mascots');
const { SiteHeader } = await import('./SiteHeader');
const { connectionLabel, shownConnectionLabel } = await import('./ConnectionPill');
const { ReadyControls, readyState } = await import('./ReadyControls');
const { AvatarPicker } = await import('./AvatarPicker');
const { GamePicker } = await import('./GamePicker');
const { noOrphan } = await import('../lib/format');
const { Lobby } = await import('../screens/Lobby');
const { GAME_LIST } = await import('@shared/platform/games');
const { AVATAR_COLORS, AVATAR_EMOJIS } = await import('@shared/platform/avatar');
const { arcFraction, remainingMs } = await import('../lib/useCountdown');
const { GameTopBar, RoundStatus } = await import('./GameTopBar');
const { CHIP_GAP, CHIP_WIDTH, chipCapacity, chipLayout, chipOrder, chipStatus } = await import('./PlayerChips');
const { ResultNext, ResultPoints, earnersOf } = await import('./RoundResult');

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

/** The whole `@media <query> { ... }` block, braces balanced. */
function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query} {`);
  if (start < 0) throw new Error(`no @media ${query}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unbalanced @media ${query}`);
}

/** Attributes of the first tag carrying `data-testid="<id>"` in the markup. */
function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid=${testId} in ${html}`);
  return match[0];
}

/** Every tag carrying `data-testid="<id>"`, in document order. */
function tagsWith(html: string, testId: string): string[] {
  return html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`, 'g')) ?? [];
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
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

  it('draws the whole lime arc when a deadline first appears and turns danger only in the last 5 seconds', () => {
    usePlatformStore.setState({ clockOffset: 0 });
    const fresh = renderToString(createElement(Timer, { endsAt: Date.now() + 8_000, warnUnder: 10 }));
    expect(fresh).toMatch(/class="timer__arc"[^>]*stroke-dashoffset="0\.00"/);
    expect(tagWith(fresh, 'timer')).not.toContain('timer--urgent');
    const last = renderToString(createElement(Timer, { endsAt: Date.now() + 4_000, warnUnder: 10 }));
    expect(tagWith(last, 'timer')).toContain('timer--urgent');
    // A clock that is never urgent (a summary's countdown) stays lime to the end.
    const summary = renderToString(createElement(Timer, { endsAt: Date.now() + 2_000, warnUnder: 0 }));
    expect(tagWith(summary, 'timer')).not.toContain('timer--urgent');
    // Plain seconds up to 99, m:ss beyond.
    expect(fresh).toMatch(/class="timer__value">8</);
    expect(renderToString(createElement(Timer, { endsAt: Date.now() + 150_000 }))).toContain('2:30');
  });

  it('empties the arc in proportion to the time left of the countdown as first seen', () => {
    expect(arcFraction(5_000, 10_000)).toBe(0.5);
    expect(arcFraction(12_000, 10_000)).toBe(1);
    expect(arcFraction(0, 10_000)).toBe(0);
    expect(arcFraction(3_000, 0)).toBe(0);
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

describe('front door', () => {
  it('shows the rejoining spinner or the form, never both once the rejoin has dragged on', () => {
    expect(homeView(false, false)).toBe('form');
    expect(homeView(false, true)).toBe('form');
    expect(homeView(true, false)).toBe('rejoining');
    expect(homeView(true, true)).toBe('stale');
  });

  it('starts a new party on the first live game of the registry', () => {
    expect(initialGame().id).toBe('scribble');
    expect(initialGame().status).toBe('live');
    expect(initialGame(gameById('template')).id).toBe('template');
  });

  it('focuses the first empty box after a failed submit, or the first box when a complete code was refused', () => {
    expect(firstInvalidBox('')).toBe(0);
    expect(firstInvalidBox('AB')).toBe(2);
    expect(firstInvalidBox('A C')).toBe(1);
    expect(firstInvalidBox('ABCD')).toBe(0);
  });

  it('sends the focus to the first invalid box for a code error and to Join room for every other refusal, never to <body>', () => {
    expect(focusAfterRefusal('ROOM_NOT_FOUND', 'AB2K')).toBe(0);
    expect(focusAfterRefusal('INVALID_CODE', 'AB')).toBe(2);
    for (const code of ['ROOM_FULL', 'OFFLINE', 'TIMEOUT', 'RATE_LIMITED', 'INTERNAL'] as const) {
      expect(focusAfterRefusal(code, 'AB2K'), code).toBe('join');
    }
  });

  it('previews a running game as open to watch, and only a full room as closed', () => {
    const base = { exists: true, gameId: 'poker', players: 3, maxPlayers: 23 } as const;
    expect(previewLine({ ...base, inProgress: false, joinable: true })).toEqual({ text: '3 players in the party · Poker', ok: true });
    expect(previewLine({ ...base, inProgress: true, joinable: true })).toEqual({ text: 'Poker in progress · 3\u00a0players.', ok: true, note: 'Join to watch.' });
    expect(previewLine({ ...base, players: 1, inProgress: true, joinable: false })).toEqual({ text: 'Room is full. (1 player in the party)', ok: false });
    expect(previewLine({ exists: false })).toBeNull();
    for (const p of [true, false]) expect(previewLine({ ...base, inProgress: p, joinable: true })?.text).not.toMatch(/closed/);
  });

  it('has no tagline, sub-line or footer: the logo, Join a room and Create a room only', () => {
    const html = renderToString(createElement(Home, { code: null, game: null }));
    // One column as on the brand board: no panel boxes, no "Create a room" heading, no helper line.
    expect(html).not.toContain('Pick the game once you');
    expect(html).not.toContain('id="create-heading"');
    expect(tagWith(html, 'join-panel')).not.toContain('card');
    expect(html).toMatch(/data-testid="home-create"[^>]*>Create a room</);
    expect(html.indexOf('data-testid="home-join"')).toBeLessThan(html.indexOf('data-testid="home-create"'));
    expect(html).not.toContain('Less bored');
    expect(html).not.toContain('Get your people together');
    expect(html).not.toContain('one more round');
    expect(html).not.toContain('<footer');
    expect(html).toContain('data-testid="join-panel"');
    expect(html).toContain('data-testid="create-panel"');
    // The status line under the boxes stays in the DOM as a polite live region, empty until there is something to say.
    expect(tagWith(html, 'room-preview')).toContain('aria-live="polite"');
    expect(html).toMatch(/data-testid="room-preview"><\/div>/);
  });

  it('gives the empty status line no height and keeps the same single centred column on desktop', () => {
    const css = stylesheet('home.css');
    expect(ruleOf(css, '.code-field .code-preview:empty')).toContain('margin-top: -8px');
    expect(ruleOf(css, '.code-field')).toContain('gap: 8px');
    expect(ruleOf(css, '.home')).toContain('--home-column: 328px');
    expect(ruleOf(css, '.home')).toContain('width: min(calc(var(--home-column) + 2 * var(--home-gutter)), 100%)');
    expect(ruleOf(css, '.home')).toContain('margin: 0 auto');
    // Nothing widens the column or splits it into side-by-side panels on a wide screen.
    const desktop = mediaBlock(css, '(min-width: 768px)');
    expect(desktop.slice(desktop.indexOf('{'))).not.toMatch(/[^-]width:/);
    expect(desktop).not.toContain('grid-template-columns');
    // On every screen, phones included, the column sits in the middle of the page, top to bottom.
    expect(ruleOf(css, '.home')).toContain('justify-content: center');
    // From 1024px only the logo grows past the column (two fifths of the screen, at most 600px), centred over it.
    const wide = mediaBlock(css, '(min-width: 1024px)');
    expect(wide).toContain('--home-logo: clamp(var(--home-column), 40vw, 600px)');
    expect(wide).toContain('width: var(--home-logo)');
    expect(wide).toContain('margin-inline: calc((100% - var(--home-logo)) / 2)');
    expect(wide).not.toContain('--home-column:');
  });

  it('shows the phones only as the logo icon, not as a separate decoration beside it', () => {
    const html = renderToString(createElement(Home, { code: null, game: null }));
    expect(html).not.toContain('home__mascots');
    expect(html.match(/class="wordmark__icon"/g)?.length).toBe(1);
  });

  it('lights a typed box of the room code up lime, as the lobby shows the code', () => {
    const filled = ruleOf(stylesheet('home.css'), '.home .code-input__box:not(:placeholder-shown)');
    expect(filled).toContain('background: var(--color-primary)');
    expect(filled).toContain('color: var(--color-primary-contrast)');
    expect(ruleOf(stylesheet('home.css'), '.panel__code')).toContain('background: var(--color-primary)');
  });

  it('cleans a name the way the handlers want it', () => {
    expect(cleanName('  Pia   Lee ')).toBe('Pia Lee');
    expect(cleanName('   ')).toBe('');
  });
});

describe('wordmark and mascots', () => {
  it('renders the outlined wordmark as vector paths with "boredgames.io" as its accessible name, never as live text', () => {
    const html = renderToString(createElement(Wordmark));
    expect(html).toContain('<title');
    expect(html).toContain('boredgames.io</title>');
    expect(html).toContain('role="img"');
    // Three text paths after the icon: "bored" + ".i", "games", and the gear that is the "o" of ".io".
    expect(html.match(/<path [^>]*fill="currentColor"/g)?.length).toBe(3);
    expect(html).toContain('class="wordmark__accent"');
    expect(html).toContain('class="wordmark__gear"');
    // On light, "games" stays lime and a copy of it underneath draws an ink outline; dark has no outline.
    expect(html).toMatch(/<path class="wordmark__accent-outline" d="[^"]+" fill="none">/);
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.wordmark__accent-outline')).toContain('display: none');
    expect(ruleOf(css, ":root[data-theme='light'] .wordmark__accent")).toContain('color: var(--color-primary)');
    expect(ruleOf(css, ":root[data-theme='light'] .wordmark__accent-outline")).toContain('stroke: var(--color-primary-contrast)');
    expect(html).not.toContain('<text');
    expect(html).not.toMatch(/font-family/);
    // "games" follows the theme: lime on dark, the deep olive cut on light.
    expect(ruleOf(stylesheet('components.css'), '.wordmark__accent')).toContain('color: var(--color-primary-text)');
  });

  it('renders the mascots flat and decorative: solid fills, an ink outline and shadow, no screen lines', () => {
    for (const [Mascot, viewBox] of [
      [PhoneBored, PHONE_BORED_VIEWBOX],
      [PhoneHappy, PHONE_HAPPY_VIEWBOX],
    ] as const) {
      const html = renderToString(createElement(Mascot));
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/gradient|filter|opacity/);
      expect(html.match(/<rect /g)?.length).toBe(2);
      expect(html).toContain(`viewBox="${viewBox}"`);
    }
    expect(renderToString(createElement(PhoneBored))).toContain('#A699D5');
    expect(renderToString(createElement(PhoneHappy))).toContain('#C7E976');
  });

  it('draws every shape of the Illustrator file in branding/mascots, on its artboard', () => {
    const source = readFileSync(fileURLToPath(new URL('../../../../branding/mascots/boredgames-mascots.svg', import.meta.url)), 'utf8');
    expect(source).toContain(`viewBox="${MASCOTS_VIEWBOX}"`);
    const pair = renderToString(createElement('svg', null, createElement(BoredArt), createElement(HappyArt)));
    const shapes = [...source.matchAll(/<(rect|path)[^>]*>/g)].map((m) => m[0]);
    expect(shapes).toHaveLength(12);
    expect(pair.match(/<(rect|path) /g)).toHaveLength(12);
    for (const shape of shapes) {
      for (const [, name, value] of shape.matchAll(/ (d|x|y|width|height|rx|transform)="([^"]+)"/g)) {
        expect(pair, `${name}="${value}"`).toContain(`${name}="${value}"`);
      }
    }
  });

  it('places the settings button on the gear "o": its centre matches the gear inside the logo box', () => {
    expect(WORDMARK_GEAR_POSITION.left).toBe(`${(((WORDMARK_GEAR_CENTRE.x - WORDMARK_BOX.x) / WORDMARK_BOX.width) * 100).toFixed(2)}%`);
    // The "o" was the last glyph: the gear sits near the right end, about mid-height.
    expect(parseFloat(WORDMARK_GEAR_POSITION.left)).toBeGreaterThan(94);
    expect(parseFloat(WORDMARK_GEAR_POSITION.top)).toBeGreaterThan(40);
    expect(parseFloat(WORDMARK_GEAR_POSITION.top)).toBeLessThan(55);
    const html = renderToString(createElement(SiteHeader));
    expect(html).toContain(`--gear-x:${WORDMARK_GEAR_POSITION.left}`);
    expect(tagWith(html, 'settings-menu')).toContain('class="settings-menu__logo-gear"');
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.settings-menu__logo-gear')).toContain('left: var(--gear-x)');
    expect(ruleOf(css, '.settings-menu__logo-gear')).toContain('width: 44px');
  });

  it('puts the logo (no controller icon, no live site name) in the site header, its gear "o" being the settings button', () => {
    const html = renderToString(createElement(SiteHeader));
    expect(html).toContain('data-testid="wordmark"');
    // No second gear: the header's only settings control is the one on the logo.
    expect(html.match(/aria-label="Settings"/g)?.length).toBe(1);
    expect(html).not.toContain('class="icon-btn"');
    expect(html).not.toContain('brand__mark');
    // The only "boredgames.io" in the markup is the SVG's accessible title, never a live-text span.
    expect(html.replace(/<title[^>]*>boredgames\.io<\/title>/, '')).not.toContain('boredgames.io');
    expect(tagWith(html, 'settings-menu')).toContain('aria-label="Settings"');
    // The theme lives in the settings menu, not as a header button of its own.
    expect(html).not.toContain('theme-toggle');
  });

  it('shows the connection pill only while the socket is not connected (no "Connected" badge)', () => {
    expect(connectionLabel('connected')).toBeNull();
    expect(connectionLabel('reconnecting')).toBe('Reconnecting…');
    expect(connectionLabel('connecting')).toBe('Connecting…');
    // A first connect waits out its grace in JS, so reduced motion (which cuts CSS animations short) cannot flash it.
    expect(shownConnectionLabel('connecting', false)).toBeNull();
    expect(shownConnectionLabel('connecting', true)).toBe('Connecting…');
    expect(shownConnectionLabel('reconnecting', false)).toBe('Reconnecting…');
    expect(shownConnectionLabel('connected', true)).toBeNull();
    expect(stylesheet('components.css')).not.toMatch(/conn-pill--connecting\s*\{[^}]*animation/);
    // react-dom/server reads the store's initial state, which is connecting: nothing on first paint.
    const html = renderToString(createElement(SiteHeader));
    expect(html).not.toContain('connection-status');
    expect(html).not.toContain('Connected<');
  });

  it('ships no pre-Pocket-Party assets: no old game icons, nothing in the old purple', () => {
    const pub = fileURLToPath(new URL('../../../public', import.meta.url));
    expect(existsSync(`${pub}/icons/games`)).toBe(false);
    const svgs = (readdirSync(pub, { recursive: true }) as string[]).filter((f) => f.endsWith('.svg'));
    for (const f of svgs) expect(readFileSync(`${pub}/${f}`, 'utf8').toLowerCase(), f).not.toContain('#6c5ce7');
  });

  it('draws every game with its own line glyph on its accent token, never an emoji', () => {
    const tokens = stylesheet('tokens.css');
    for (const g of GAME_LIST) {
      expect(tokens).toContain(`--game-${g.id}: ${g.accent};`);
    }
    const html = renderToString(createElement(GamePicker, { room: room(), isHost: true }));
    for (const g of GAME_LIST.filter((x) => x.status === 'live')) expect(html).toContain(`data-glyph="${g.id}"`);
    expect(html).toContain('Scribble');
    // A name of more words keeps its last two together, so a narrow tile never leaves "Game" alone.
    expect(html).toContain('The Spy\u00a0Game');
    expect(noOrphan('Adults only. Crude and filthy.')).toBe('Adults only. Crude and\u00a0filthy.');
    expect(noOrphan('Scribble')).toBe('Scribble');
    expect(html).not.toContain('✏️');
    expect(tagWith(html, 'game-tile')).toContain('aria-checked="true"');
    // Three to a row, a short last row stretching to fill; the picked tile is the lilac fill with ink.
    const lobby = stylesheet('lobby.css');
    expect(ruleOf(lobby, '.game-picker__list .game-tile')).toContain('flex: 1 1 calc(33.33% - 6px)');
    expect(ruleOf(lobby, '.game-tile.is-selected')).toContain('background: var(--color-secondary)');
    expect(ruleOf(lobby, '.game-tile.is-selected')).toContain('color: var(--color-secondary-contrast)');
  });
});

describe('platform settings', () => {
  it('offers the two content modes (no Cheeky) to the host, with the adults-only tag on Unhinged', () => {
    const html = renderToString(createElement(SettingsPanel, { room: room(), game: null }));
    expect(html).not.toContain('settings-maxPlayers');
    expect(tagWith(html, 'settings-contentMode')).toContain('data-value="family"');
    for (const mode of ['family', 'unhinged']) expect(tagWith(html, `content-mode-${mode}`)).not.toContain('disabled');
    expect(html).not.toContain('content-mode-cheeky');
    expect(html).not.toContain('Cheeky');
    // Each blurb keeps its last two words together: no word alone on its last line.
    expect(html).toContain('Clean content for any\u00a0table.');
    expect(html).toContain('Adults only. Crude and\u00a0filthy.');
    expect(tagWith(html, 'content-mode-family')).toContain('aria-checked="true"');
    expect(html).toContain('18+');
    expect(html).toContain('Adults only');
    // Joining mid-game always means watching: there is no switch for it.
    expect(html).not.toContain('allowMidGameJoin');
    expect(html).not.toContain('mid-game');
  });

  it('keeps the adults-only tag legible in both themes', () => {
    const css = stylesheet('lobby.css');
    const tag = ruleOf(css, '.content-mode__age');
    expect(tag).toContain('color: var(--color-danger-text)');
    expect(tag).toContain('background: var(--color-danger-soft)');
    expect(tag).not.toContain('#fff');
  });

  it('echoes no chosen value beside a title (the picked card says it) and gives every setting the same rhythm', () => {
    const unhinged = room({ settings: { ...room().settings, contentMode: 'unhinged' } });
    const html = renderToString(createElement(SettingsPanel, { room: unhinged, game: null }));
    expect(html).not.toContain('setting__value');
    expect(html).not.toContain('settings-value-contentMode');
    expect(tagWith(html, 'content-mode-unhinged')).toContain('aria-checked="true"');
    expect(html).not.toContain('Only the host can change settings.');
    const css = stylesheet('components.css');
    // 12px from a title to its options, 24px from one setting to the next.
    expect(css).toMatch(/\n\.settings \{[^}]*gap: var\(--space-5\)/);
    expect(css).toMatch(/\n\.setting \{[^}]*gap: var\(--space-3\)/);
    expect(css).not.toContain('.setting__value');
    // A slider's value sits in the control, in the text colour rather than the brand's.
    expect(ruleOf(css, '.range-field__value')).toContain('color: var(--color-text)');
  });
});

describe('content mode only where it matters', () => {
  it('shows the content mode for the games that read it and hides it (keeping the stored value) for the others', () => {
    for (const g of GAME_LIST) {
      const r = room({ gameId: g.id, settings: { ...room().settings, contentMode: 'unhinged' } });
      const html = renderToString(createElement(SettingsPanel, { room: r, game: null }));
      expect(html.includes('data-testid="settings-contentMode"'), g.id).toBe(g.contentModes);
      expect(r.settings.contentMode).toBe('unhinged');
    }
  });

  it("reads a stale 'cheeky' snapshot as Family", () => {
    const stale = room({ settings: { ...room().settings, contentMode: 'cheeky' as 'family' } });
    const html = renderToString(createElement(SettingsPanel, { room: stale, game: null }));
    expect(tagWith(html, 'settings-contentMode')).toContain('data-value="family"');
    expect(tagWith(html, 'content-mode-family')).toContain('aria-checked="true"');
  });
});

describe('ready controls', () => {
  const html = (overrides: Parameters<typeof player>[1], context: 'lobby' | 'podium' = 'lobby') =>
    renderToString(createElement(ReadyControls, { me: player('bob', { participating: false, ...overrides }), context }));
  const buttons = (markup: string) => markup.match(/<button[^>]*>/g) ?? [];

  it("not ready: one I'm ready over a secondary Sit this one out button", () => {
    const markup = html({});
    expect(readyState(player('bob'))).toBe('notReady');
    expect(buttons(markup)).toHaveLength(2);
    expect(tagWith(markup, 'ready-toggle')).toContain('aria-pressed="false"');
    expect(markup).toContain('I&#x27;m ready');
    expect(tagWith(markup, 'sitout-toggle')).toContain('btn btn--secondary');
    expect(markup).toContain('Sit this one out');
    expect(markup).not.toContain('Count me in');
    // The secondary buttons share one row, equal widths, each at least 44px tall.
    const css = stylesheet('lobby.css');
    expect(ruleOf(css, '.ready-controls__more')).toContain('grid-auto-columns: minmax(0, 1fr)');
    expect(ruleOf(css, '.ready-controls__more .btn')).toContain('min-height: 44px');
    expect(stylesheet('components.css')).not.toContain('.text-btn');
  });

  it('puts extra buttons (the room\'s Change my look) in the same row, sitting out included', () => {
    const extra = createElement('button', { type: 'button', className: 'btn btn--secondary', 'data-testid': 'edit-profile' }, 'Change my look');
    for (const overrides of [{}, { sittingOut: true }]) {
      const markup = renderToString(createElement(ReadyControls, { me: player('bob', overrides), context: 'lobby', extra }));
      const row = markup.slice(markup.indexOf('ready-controls__more'));
      expect(row).toContain('data-testid="edit-profile"');
    }
  });

  it("ready: the same button checked (You're ready, tap to undo) and the same Sit this one out", () => {
    const markup = html({ ready: true });
    expect(buttons(markup)).toHaveLength(2);
    expect(tagWith(markup, 'ready-toggle')).toContain('aria-pressed="true"');
    expect(tagWith(markup, 'ready-toggle')).not.toContain('disabled');
    expect(markup).toContain('You&#x27;re ready');
    expect(markup).toContain('Sit this one out');
  });

  it('sitting out: only Count me in, with the hint; no disabled ready button', () => {
    const markup = html({ sittingOut: true });
    expect(readyState(player('bob', { sittingOut: true }))).toBe('sittingOut');
    expect(buttons(markup)).toHaveLength(1);
    expect(markup).not.toContain('data-testid="ready-toggle"');
    expect(tagWith(markup, 'sitout-toggle')).toContain('btn--primary');
    expect(markup).toContain('Count me in');
    expect(markup).toContain('You&#x27;ll watch the next game.');
  });

  it('the host is in by pressing Start: in the lobby only the way out is left, on the podium their control says so', () => {
    const host = player('host', { participating: false });
    const lobby = renderToString(createElement(ReadyControls, { me: host, context: 'lobby' }));
    expect(lobby).not.toContain('data-testid="ready-toggle"');
    expect(buttons(lobby)).toHaveLength(1);
    expect(lobby).toContain('Sit this one out');
    const podium = renderToString(createElement(ReadyControls, { me: host, context: 'podium' }));
    expect(tagWith(podium, 'ready-toggle')).toContain('disabled');
    expect(podium).toContain('You start the game');
    expect(podium).not.toContain('—');
  });
});

describe('player rows', () => {
  it('label You and Host in text and never squeeze the name out of a narrow column', () => {
    const markup = renderToString(createElement(PlayerList, { room: room(), meId: 'host', isHost: true, mode: 'game', game: null }));
    expect(markup).toContain('>You</span>');
    expect(markup).toContain('Host</span>');
    expect(markup).toContain('player__name-text">host<');
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.player__name')).toContain('flex-wrap: wrap');
  });
});

describe('avatar picker', () => {
  it('shows every face and colour at once, with no scrolling box', () => {
    const markup = renderToString(createElement(AvatarPicker, { value: { color: 0, emoji: 0 }, onChange: () => undefined }));
    expect(markup.match(/class="emoji-choice/g)).toHaveLength(AVATAR_EMOJIS.length);
    expect(markup.match(/class="swatch/g)).toHaveLength(AVATAR_COLORS.length);
    expect(AVATAR_EMOJIS).toHaveLength(24);
    const css = stylesheet('components.css');
    expect(css).not.toMatch(/\.avatar-picker__emojis \{[^}]*(max-height|overflow)/);
    // 44px a choice wherever there is room; the 40px floor only on the narrowest phones.
    expect(ruleOf(css, '.avatar-picker__group')).toContain('minmax(44px, 1fr)');
    const narrow = css.slice(css.indexOf('@media (max-width: 340px)'));
    expect(narrow).toMatch(/^@media \(max-width: 340px\) \{\s*\.avatar-picker__group \{\s*grid-template-columns: repeat\(auto-fill, minmax\(40px, 1fr\)\);/);
    // A colour dot stays round: square up to 48px, never squashed by a height cap.
    expect(ruleOf(css, '.avatar-picker__group .swatch')).not.toContain('max-height');
  });
});

describe('lobby', () => {
  it('opens with the room code card (label, code, Copy and Share squares) above the game picker; the old invite card is gone', () => {
    // The card is outside every host-only branch, so host and guests get the same one.
    const markup = renderToString(createElement(Lobby, { room: room(), game: null }));
    const bar = markup.indexOf('data-testid="room-bar"');
    expect(bar).toBeGreaterThan(-1);
    expect(bar).toBeLessThan(markup.indexOf('data-testid="game-picker"'));
    expect(markup).toContain('aria-label="Room code A B C D"><span class="room-card__char">A</span><span class="room-card__char">B</span>');
    expect(markup.indexOf('>Room code</span>')).toBeLessThan(markup.indexOf('aria-label="Room code A B C D"'));
    for (const id of ['copy-code', 'share-invite']) expect(tagWith(markup, id)).toContain('room-card__btn');
    expect(markup).toContain('<span>Copy</span>');
    expect(markup).toContain('<span>Share</span>');
    expect(markup).not.toContain('code-card');
    expect(markup).not.toContain('Invite your friends');
    // Copying the invite link and leaving live in the gear's menu; the header shows only the wordmark and the gear.
    expect(markup).not.toContain('data-testid="copy-link"');
    expect(markup).not.toContain('data-testid="leave-room"');
    expect(tagWith(markup, 'settings-menu')).toBeTruthy();
  });

  it('shows each character of the room code on its own lime block with an ink letter, so it stands out to read aloud', () => {
    const char = ruleOf(stylesheet('lobby.css'), '.room-card__char');
    expect(char).toContain('background: var(--color-primary)');
    expect(char).toContain('color: var(--color-primary-contrast)');
    expect(ruleOf(stylesheet('lobby.css'), '.room-card__value')).toContain('display: flex');
  });

  it('keeps a full row of game tiles on a 320px phone, and the last row never leaves one tile alone as a banner', () => {
    const css = stylesheet('lobby.css');
    const tile = ruleOf(css, '.game-picker__list .game-tile');
    const gap = Number(ruleOf(css, '.game-picker__list').match(/gap: (\d+)px/)?.[1]);
    const min = Number(tile.match(/min-width: (\d+)px/)?.[1]);
    const [, percent, less] = tile.match(/flex: 1 1 calc\(([\d.]+)% - (\d+)px\)/) ?? [];
    const perRow = Math.floor(100 / Number(percent));
    // A row of tiles at their basis and the gaps between them fit the list, so none wraps early.
    expect(perRow * Number(less)).toBeGreaterThanOrEqual((perRow - 1) * gap);
    // A 320px screen leaves the list 304px: a row of tiles at their minimum and the gaps fit it.
    expect(perRow * min + (perRow - 1) * gap).toBeLessThanOrEqual(304);
    // The live games, alone or with a hidden one picked through '?game=', fill the last row with two or more.
    const live = GAME_LIST.filter((g) => g.status === 'live').length;
    for (const count of [live, live + 1]) expect(count % perRow, `${count} tiles`).not.toBe(1);
  });

  it('lists the players as rows: avatar, name, and a check with Ready on the right', () => {
    const state = room({ players: [player('host'), player('bob', { joinOrder: 1, ready: true }), player('carol', { joinOrder: 2, sittingOut: true })] });
    const markup = renderToString(createElement(Lobby, { room: state, game: null }));
    const rows = tagsWith(markup, 'player-item');
    expect(rows.map((r) => attr(r, 'data-status'))).toEqual(['ready', 'ready', 'sittingOut']);
    expect(markup.match(/class="player__check"/g)).toHaveLength(2);
    expect(markup).toContain('Sitting out');
    expect(tagWith(markup, 'player-count')).toContain('sr-only');
    // The status is the row's last item, so the tick and "Ready" sit at its right end, after the kick button.
    const bob = markup.slice(markup.indexOf('data-player-id="bob"'));
    expect(bob.indexOf('data-testid="votekick-player"')).toBeLessThan(bob.indexOf('data-testid="player-status"'));
    expect(bob.indexOf('data-testid="player-status"')).toBeLessThan(bob.indexOf('</li>'));
    expect(markup).not.toContain('player__actions--spacer');
  });

  const enter = (meId: string, state = room()) => {
    usePlatformStore.getState().handleServerMessage(welcome(meId, state));
    return renderToString(createElement(Lobby, { room: state, game: null }));
  };

  it('gives only the host the settings and the game grid; a guest sees the next game, the players and their own buttons', () => {
    const host = enter('host');
    expect(tagWith(host, 'settings-panel')).toBeTruthy();
    expect(tagsWith(host, 'game-tile').length).toBeGreaterThan(1);
    expect(host).not.toContain('lobby__grid--guest');
    const guest = enter('bob');
    expect(guest).not.toContain('data-testid="settings-panel"');
    expect(guest).not.toContain('settings-contentMode');
    expect(guest).not.toContain('content-mode');
    expect(guest).toContain('lobby__grid--guest');
    expect(tagsWith(guest, 'game-tile')).toHaveLength(1);
    expect(tagWith(guest, 'game-picker-note')).toBeTruthy();
    for (const id of ['room-bar', 'copy-code', 'share-invite', 'player-list', 'ready-toggle', 'sitout-toggle', 'edit-profile']) expect(tagWith(guest, id), id).toBeTruthy();
  });

  it('hands the settings to the new host as soon as the host changes', () => {
    const before = room({ players: [player('host'), player('bob', { joinOrder: 1 })] });
    expect(enter('bob', before)).not.toContain('data-testid="settings-panel"');
    const after = room({ hostId: 'bob', players: [player('bob', { joinOrder: 1, isHost: true })] });
    usePlatformStore.getState().handleServerMessage({ t: 'room', room: after });
    const markup = renderToString(createElement(Lobby, { room: after, game: null }));
    expect(tagWith(markup, 'settings-panel')).toBeTruthy();
    expect(tagsWith(markup, 'game-tile').length).toBeGreaterThan(1);
    expect(tagWith(markup, 'start-game')).toBeTruthy();
  });

  it('has no chat: no chat box, log or input for the host or a guest', () => {
    for (const id of ['host', 'bob']) {
      const markup = enter(id);
      for (const gone of ['chat-log', 'chat-input', 'chat-send', 'chat-toggle', 'lobby__chat']) expect(markup, `${id} ${gone}`).not.toContain(gone);
      expect(markup).not.toMatch(/>Chat</);
    }
  });

  it('turns Sit this one out and Change my look into secondary buttons beside each other, under Ready or Start', () => {
    for (const id of ['host', 'bob']) {
      const markup = enter(id);
      const footer = markup.slice(markup.indexOf('data-testid="lobby-footer"'));
      const row = footer.slice(footer.indexOf('ready-controls__more'));
      expect(tagWith(row, 'sitout-toggle'), id).toContain('btn btn--secondary');
      expect(tagWith(row, 'edit-profile'), id).toContain('btn btn--secondary');
      expect(row.indexOf('data-testid="sitout-toggle"')).toBeLessThan(row.indexOf('data-testid="edit-profile"'));
      expect(footer.indexOf(id === 'host' ? 'data-testid="start-game"' : 'data-testid="ready-toggle"')).toBeLessThan(footer.indexOf('ready-controls__more'));
    }
  });

  it('centres the logo on a phone, the connection pill out of the flow so it never pushes the logo aside', () => {
    const css = stylesheet('lobby.css');
    const phone = mediaBlock(css, '(max-width: 760px), (min-aspect-ratio: 3/2) and (max-height: 520px)');
    expect(phone).toMatch(/\.lobby \.site-header \{[^}]*justify-content: center/);
    expect(phone).toMatch(/\.lobby \.site-header__actions \{[^}]*position: absolute/);
    expect(phone).toMatch(/\.lobby \.settings-menu--logo \.settings-menu__panel \{[^}]*left: calc\(50% - /);
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

  it('celebrates the winner by name and points, tells each player their place, ranks the podium with the winner in the middle and lists everyone', () => {
    const html = renderToString(createElement(PodiumOverlay, { ...ended('bob'), isHost: false }));
    expect(tagWith(html, 'overlay-game-end')).toContain('data-winner="true"');
    expect(html).toContain('bob wins!');
    expect(html).toContain('>30 points<');
    expect(html).toContain('You won!');
    expect(html).toContain('data-testid="confetti"');
    // The small happy phone, decorative.
    expect(html).toMatch(/<svg class="mascot podium-hero__mascot"[^>]*aria-hidden="true"/);
    expect(tagsWith(html, 'podium-step').map((t) => attr(t, 'data-rank'))).toEqual(['2', '1', '3']);
    expect(tagsWith(html, 'podium-entry').map((t) => attr(t, 'data-rank'))).toEqual(['1', '2', '3']);
    const third = renderToString(createElement(PodiumOverlay, { ...ended('host'), isHost: true }));
    expect(third).toContain('You came 3rd');
    expect(tagWith(third, 'overlay-game-end')).toContain('data-winner="false"');
    const second = renderToString(createElement(PodiumOverlay, { ...ended('carol'), isHost: false }));
    expect(second).toContain('You came 2nd');
    const spectator = renderToString(createElement(PodiumOverlay, { ...ended('dan'), isHost: false }));
    expect(spectator).toContain('You watched this one');
  });

  it('prints the standings like the headline: grouped thousands and "1 pt" for a single point', async () => {
    const { pointsShort } = await import('../lib/format');
    expect(pointsShort(1)).toBe('1 pt');
    expect(pointsShort(0)).toBe('0 pts');
    expect(pointsShort(1100)).toBe('1,100 pts');
    const state = room({
      phase: 'ended',
      players: [player('host', { score: 1100 }), player('bob', { score: 1, joinOrder: 1 })],
      podium: [
        { playerId: 'host', score: 1100, rank: 1 },
        { playerId: 'bob', score: 1, rank: 2 },
      ],
    });
    const html = renderToString(createElement(PodiumOverlay, { room: state, meId: 'bob', isHost: false }));
    expect(html).toContain('>1,100 points<');
    expect(html).toContain('>1,100 pts<');
    expect(html).toContain('>1 pt<');
    expect(html).not.toContain('1 pts');
    expect(html).not.toContain('1100 pts');
    const list = renderToString(createElement(PlayerList, { room: room({ phase: 'playing', players: [player('host', { score: 1 }), player('bob', { score: 1100, joinOrder: 1 })] }), meId: 'host', isHost: true, mode: 'game', game: null }));
    expect(list).toContain('>1 pt<');
    expect(list).toContain('>1,100 pts<');
  });

  it('draws no focus ring around the podium card it focuses on opening (a container, not a control)', () => {
    expect(ruleOf(stylesheet('components.css'), '.podium-card:focus-visible')).toContain('outline: none');
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
    expect(host).toContain('You start the game');
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

describe('GameTopBar', () => {
  const noop = () => undefined;
  const players = [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2, connected: false }), player('dan', { joinOrder: 3, participating: false })];
  const bar = (isPhone: boolean) =>
    renderToString(
      createElement(GameTopBar, {
        meta: gameById('spygame'),
        room: room({ gameId: 'spygame', phase: 'playing', players }),
        isPhone,
        testId: 'spygame-header',
        status: 'Round 2/5',
        statusData: { 'data-round': 2 },
        clock: createElement('span', { 'data-testid': 'clock' }),
        players: { label: 'Scores', open: false, onOpen: noop },
        menu: { open: false, onOpen: noop },
      }),
    );

  it('reads back, name and round and options on the first row, then the player chips and the timer ring; there is no chat button', () => {
    const html = bar(true);
    expect(html).toContain('The Spy Game');
    expect(attr(tagWith(html, 'round-indicator'), 'data-round')).toBe('2');
    expect(html).toContain('Round 2/5');
    expect(html).not.toContain('chat-toggle');
    const order = ['game-back', 'round-indicator', 'game-menu', 'players-toggle', 'clock'].map((id) => html.indexOf(`data-testid="${id}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(tagWith(html, 'players-toggle')).toContain('aria-label="Scores (4)"');
    expect(tagWith(html, 'game-back')).toContain('aria-label="Leave game"');
    // Leaving asks first; the confirmation is a sheet that is closed until the arrow is tapped.
    expect(html).not.toContain('data-testid="leave-room"');
    expect(html).not.toContain('data-testid="leave-sheet"');
  });

  it('keeps the game name whole on a phone: the status is short and on one line, "Round" giving way first on the narrowest', () => {
    const html = renderToString(createElement(RoundStatus, { round: 1, total: 5 }));
    expect(html).toBe('<span class="gbar__wide">Round </span>1<!-- -->/<!-- -->5');
    const css = stylesheet('gamebar.css');
    // The name never shrinks faster than the status (it used to give way four times as fast and read "The Spy Ga...").
    expect(ruleOf(css, '.gbar__name')).toContain('flex: 0 1 auto');
    const status = ruleOf(css, '.gbar--phone:not(.gbar--compact) .gbar__status');
    expect(status).toContain('flex: none');
    expect(status).toContain('white-space: nowrap');
    expect(css).toMatch(/@media \(max-width: 360px\) \{[^@]*\.gbar--phone \.gbar__wide \{\s*display: none;/);
  });

  it('gives every player a chip with a status badge: the platform says Ready, Away and Watching', () => {
    const html = bar(true);
    const chips = tagsWith(html, 'player-chip');
    expect(chips.map((c) => attr(c, 'data-label'))).toEqual(['Ready', 'Ready', 'Away', 'Watching']);
    expect(chips.map((c) => attr(c, 'data-status'))).toEqual(['ready', 'ready', 'muted', 'muted']);
  });

  it('packs into one row when compact (a card table on a phone): a players button with the count and no chips', () => {
    const compact = (clock?: ReturnType<typeof createElement>) =>
      renderToString(
        createElement(GameTopBar, {
          meta: gameById('blackjack'),
          room: room({ gameId: 'blackjack', phase: 'playing', players }),
          isPhone: true,
          testId: 'blackjack-header',
          status: 'Round 2',
          clock,
          players: { open: false, onOpen: noop },
          menu: { open: false, onOpen: noop },
          compact: true,
        }),
      );
    const html = compact();
    expect(tagWith(html, 'blackjack-header')).toContain('gbar--compact');
    expect(tagWith(html, 'players-toggle')).toContain('aria-label="Players (4)"');
    expect(html).toContain('gbar__count-n">4<');
    expect(tagsWith(html, 'player-chip')).toHaveLength(0);
    expect(html).not.toContain('gbar__clock');
    const order = ['game-back', 'round-indicator', 'players-toggle', 'game-menu'].map((id) => html.indexOf(`data-testid="${id}"`));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // A clock (The Spy Game's round clock) sits small in the same row, before the players button.
    const clocked = compact(createElement('span', { 'data-testid': 'clock' }));
    expect(clocked).toContain('gbar__clock gbar__clock--row');
    const withClock = ['round-indicator', 'clock', 'players-toggle', 'game-menu'].map((id) => clocked.indexOf(`data-testid="${id}"`));
    expect(withClock.every((i) => i >= 0)).toBe(true);
    expect([...withClock].sort((x, y) => x - y)).toEqual(withClock);
    expect(tagsWith(clocked, 'player-chip')).toHaveLength(0);
  });

  it('has the gear and no options button on a desktop, and no chat button', () => {
    const html = bar(false);
    expect(html).toContain('data-testid="settings-menu"');
    expect(html).toContain('data-testid="game-back"');
    expect(html).not.toContain('data-testid="game-menu"');
    expect(html).not.toContain('data-testid="chat-toggle"');
    const css = stylesheet('gamebar.css');
    expect(ruleOf(css, '.gbar__btn')).toContain('width: 44px');
    // The chips never scroll: what does not fit goes into the "+K" chip.
    expect(ruleOf(css, '.chips')).toContain('overflow: hidden');
  });
});

describe('player chips', () => {
  it('fit as many chips as the row holds and fold the rest into "+K"', () => {
    expect(chipCapacity(CHIP_WIDTH)).toBe(1);
    expect(chipCapacity(4 * CHIP_WIDTH + 3 * CHIP_GAP)).toBe(4);
    expect(chipCapacity(4 * CHIP_WIDTH + 3 * CHIP_GAP - 1)).toBe(3);
    expect(chipCapacity(0)).toBe(1);
    expect(chipLayout(4, 4)).toEqual({ shown: 4, more: 0 });
    expect(chipLayout(5, 4)).toEqual({ shown: 3, more: 2 });
    expect(chipLayout(50, 4)).toEqual({ shown: 3, more: 47 });
    expect(chipLayout(3, 1)).toEqual({ shown: 0, more: 3 });
  });

  it('put the players taking part first, in join order', () => {
    const list = [player('a', { joinOrder: 2 }), player('b', { joinOrder: 0, participating: false }), player('c', { joinOrder: 1 })];
    expect(chipOrder(list).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it("use the game's own status when it has one", () => {
    const r = room({ phase: 'playing' });
    const game = { meta: gameById('scribble'), Screen: () => null, playerStatus: () => ({ label: 'Drawing', icon: null, tone: 'active' as const }) };
    expect(chipStatus(r, player('host'), game).label).toBe('Drawing');
    expect(chipStatus(r, player('host', { connected: false }), game).label).toBe('Away');
    expect(chipStatus(r, player('host'), null).label).toBe('Ready');
  });
});

describe('RoundResult', () => {
  it('lists who scored, highest first with role tags and +points, then what comes next', () => {
    const players = [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 })];
    const earners = earnersOf(players, { host: 50, bob: 120, carol: 0 });
    expect(earners.map((e) => e.player.id)).toEqual(['bob', 'host']);
    const rows = earners.map(({ player: p, points }) => ({ id: p.id, player: p, name: p.name, points, tag: p.id === 'host' ? 'drawer' : undefined }));
    const html = renderToString(createElement(ResultPoints, { rows, label: 'Points', rowTestId: 'row', empty: 'Nobody scored.' }));
    expect(tagsWith(html, 'row')).toHaveLength(2);
    expect(html).toContain('+120');
    expect(html).toContain('drawer');
    expect(renderToString(createElement(ResultPoints, { rows: [], label: 'Points', empty: 'Nobody scored.' }))).toContain('Nobody scored.');
    const paused = renderToString(createElement(ResultNext, { noun: 'Next turn', endsAt: null, paused: true, settling: false, testId: 'next' }));
    expect(tagWith(paused, 'next')).toContain('data-countdown="paused"');
    expect(paused).toContain('Next turn is paused');
  });
});
