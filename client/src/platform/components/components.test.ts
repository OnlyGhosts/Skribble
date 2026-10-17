import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { GameResults, RoomState } from '@shared/platform/protocol';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../store/usePlatformStore');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');
const { SettingsPanel } = await import('./SettingsPanel');
const { snapToStep } = await import('./SettingControls');
const { Timer } = await import('./Timer');
const { ResultsPopup } = await import('./ResultsPopup');
const { EndGameConfirm, ExitActions, LeaveConfirm, endGameNote, leaveNote } = await import('./GameExit');
const { WaitingOverlay, clockText, missingPlayers, waitingHint, waitingTitle } = await import('./WaitingOverlay');
const { ConnectionNotice, NoticeCard } = await import('./ConnectionNotice');
const { gameById } = await import('@shared/platform/games');
const { Home, QuietHome, REJOIN_QUIET_MS, cleanName, firstInvalidBox, focusAfterRefusal, homeView, initialGame, previewLine } = await import('../screens/Home');
const { Wordmark } = await import('./Wordmark');
const { WORDMARK_BOX, WORDMARK_GEAR_CENTRE, WORDMARK_GEAR_POSITION } = await import('../brand/wordmark');
const { PlayerList } = await import('./PlayerList');
const { BoredArt, HappyArt, MASCOTS_VIEWBOX, PHONE_BORED_VIEWBOX, PHONE_HAPPY_VIEWBOX, PhoneBored, PhoneHappy } = await import('./Mascots');
const { SiteHeader } = await import('./SiteHeader');
const { noticeFor } = await import('../lib/connectionNotice');
const { ReadyControls, readyState } = await import('./ReadyControls');
const { AvatarPicker } = await import('./AvatarPicker');
const { GamePicker } = await import('./GamePicker');
const { RulesCard } = await import('./HowToPlay');
const { noOrphan } = await import('../lib/format');
const { Lobby } = await import('../screens/Lobby');
const { GAME_LIST } = await import('@shared/platform/games');
const { AVATAR_COLORS, AVATAR_FACES } = await import('@shared/platform/avatar');
const { Avatar } = await import('./Avatar');
const { arcFraction, remainingMs } = await import('../lib/useCountdown');
const { GameMenuSheet, GameTopBar, RoundStatus } = await import('./GameTopBar');
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

/** The visible text inside the element carrying `data-testid="<id>"` (tags and React's text separators dropped). */
function textOf(html: string, testId: string): string {
  const start = html.indexOf(tagWith(html, testId));
  const tag = tagWith(html, testId).match(/^<(\w+)/)?.[1] ?? 'div';
  let depth = 0;
  let i = start;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    i = m.index + m[0].length;
    if (depth === 0) break;
  }
  return html.slice(start, i).replace(/<!-- -->/g, '').replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").trim();
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

  it('counts down a hold with a limit (The Spy Game’s away spy), without the player count when enough are connected', () => {
    expect(clockText(90)).toBe('1:30');
    expect(clockText(5)).toBe('0:05');
    expect(waitingHint(null)).toBe('The game carries on by itself as soon as they are back.');
    expect(waitingHint(75)).toBe('If they are not back in 1:15, the game goes on without them.');
    usePlatformStore.setState({ clockOffset: 0 });
    const spyAway = room({
      phase: 'playing',
      players: [player('host'), player('bob', { joinOrder: 1, connected: false }), player('carol', { joinOrder: 2 }), player('dan', { joinOrder: 3 })],
      waiting: { reason: 'players', missing: ['bob'], needed: 3, connected: 3, until: Date.now() + 90_000 },
    });
    const html = renderToString(createElement(WaitingOverlay, { room: spyAway, waiting: spyAway.waiting!, isHost: true }));
    expect(html).toContain('If they are not back in 1:30, the game goes on without them.');
    expect(html).not.toContain('data-testid="waiting-count"');
    expect(html).toContain('Remove bob');
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

  it('stacks above the phone bottom sheets (the hold can start while one is open) and below the toasts, like the results popup', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles/components.css', import.meta.url)), 'utf8');
    const sheet = zIndexOf(css, '.sheet');
    const toasts = zIndexOf(css, '.toasts');
    expect(zIndexOf(css, '.waiting-overlay')).toBeGreaterThan(sheet);
    expect(zIndexOf(css, '.results-popup')).toBeGreaterThan(sheet);
    // What happens while a card is up ("Pia left the room") still shows: the toasts stay above both cards, under the connection notice.
    expect(toasts).toBeGreaterThan(zIndexOf(css, '.waiting-overlay'));
    expect(toasts).toBeGreaterThan(zIndexOf(css, '.results-popup'));
    expect(toasts).toBeLessThan(zIndexOf(css, '.conn-notice'));
    // On a phone the notice drops under the top bar's first row, like the toasts, clear of the back arrow and the game's name.
    expect(css).toMatch(/@media \(max-width: 760px\) \{\s*\.conn-notice \{\s*top: calc\(64px \+ env\(safe-area-inset-top\)\);/);
    // The remove buttons keep a 44px target and let a long name wrap instead of overflowing the card.
    const remove = css.slice(css.indexOf('.waiting__remove .btn {'));
    expect(remove.slice(0, remove.indexOf('}'))).toMatch(/min-height: 44px/);
    expect(remove.slice(0, remove.indexOf('}'))).toMatch(/white-space: normal/);
  });
});

describe('connection notice', () => {
  it('says plainly what is happening, with room for a second line', () => {
    const notice = noticeFor('reconnecting', false, true);
    expect(notice).toEqual({ status: 'reconnecting', title: 'Reconnecting…', detail: 'Your place in the room is kept.' });
    const html = renderToString(createElement(NoticeCard, { notice: notice! }));
    expect(tagWith(html, 'connection-notice')).toContain('data-status="reconnecting"');
    expect(html).toContain('class="conn-notice__title">Reconnecting…</strong>');
    expect(html).toContain('class="conn-notice__detail">Your place in the room is kept.</span>');
    // Off the room, one line is enough.
    expect(renderToString(createElement(NoticeCard, { notice: noticeFor('reconnecting', false, false)! }))).not.toContain('conn-notice__detail');
  });

  it('says a restart carries the game on, in two lines with no word alone on the last', () => {
    expect(noticeFor('restarting', false, true)).toEqual({ status: 'restarting', title: 'The server is restarting.', detail: 'Your game will carry\u00a0on.' });
    expect(noticeFor('restarting', true, false)?.status).toBe('restarting');
  });

  it('keeps an empty live region on first paint, so a screen reader hears it arrive', () => {
    const html = renderToString(createElement(ConnectionNotice));
    expect(html).toBe('<div class="conn-notice" role="status" aria-live="polite"></div>');
  });

  it('sits at the top of the screen over everything, inverted so it never reads cream on cream', () => {
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.conn-notice')).toContain('position: fixed');
    expect(zIndexOf(css, '.conn-notice')).toBeGreaterThan(zIndexOf(css, '.waiting-overlay'));
    expect(zIndexOf(css, '.conn-notice')).toBeGreaterThan(zIndexOf(css, '.results-popup'));
    expect(ruleOf(css, '.conn-notice__card')).toContain('background: var(--notice-bg)');
    expect(css).not.toMatch(/conn-pill|reconnect-banner/);
  });
});

describe('front door', () => {
  it('keeps quiet for the first moment of a rejoin, then shows the spinner or the form, never both once the rejoin has dragged on', () => {
    expect(REJOIN_QUIET_MS).toBe(700);
    expect(homeView(false, false, true)).toBe('form');
    expect(homeView(false, true, false)).toBe('form');
    expect(homeView(true, false, true)).toBe('quiet');
    expect(homeView(true, false, false)).toBe('rejoining');
    expect(homeView(true, true, false)).toBe('stale');
    expect(homeView(true, true, true)).toBe('stale');
  });

  it('shows the bare page, not the logo and a "Rejoining" flash, while a reload is still being answered', () => {
    const html = renderToString(createElement(QuietHome));
    expect(html).toContain('data-testid="home-quiet"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('rejoining-banner');
    expect(html).not.toContain('join-panel');
    expect(html).not.toContain('wordmark');
    expect(html).not.toContain('spinner');
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
    // "Join a room" names the boxes' section for screen readers only: on screen the boxes and Join say it.
    expect(html).toMatch(/<h2 class="sr-only" id="join-heading">Join a room<\/h2>/);
    expect(tagWith(html, 'join-panel')).toContain('aria-labelledby="join-heading"');
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

describe('the light theme', () => {
  /** The declarations of the light theme's token block. */
  const lightBlock = () => {
    const tokens = stylesheet('tokens.css');
    const start = tokens.indexOf(":root[data-theme='light'] {");
    expect(start).toBeGreaterThan(0);
    return tokens.slice(start, tokens.indexOf('}', start));
  };

  it('is the same system on an off-white page: white panels, raised surfaces in a pale lime, the brand cut darker for text', () => {
    const light = lightBlock();
    expect(light).toContain('--color-bg: #f5f6ef;');
    expect(light).toContain('--color-surface: #ffffff;');
    // Never the grey-green that made the raised surfaces look dirty.
    expect(light).not.toContain('#edf0e5');
    expect(light).toContain('--color-surface-2: #eaf0d9;');
    expect(light).toContain('--color-primary: #c7e976;');
    expect(light).toContain('--color-primary-text: #3d6b0f;');
    // The page dims clearly behind a card (ink at three fifths), never to a murky grey.
    expect(light).toContain('--overlay-bg: rgba(26, 34, 23, 0.6);');
  });

  it('gives a lime fill an edge, a disabled button a border and a player colour a wash, through tokens the dark theme leaves invisible', () => {
    const tokens = stylesheet('tokens.css');
    const dark = tokens.slice(0, tokens.indexOf(":root[data-theme='light']"));
    const light = lightBlock();
    expect(dark).toContain('--color-primary-edge: #c7e976;');
    expect(light).toContain('--color-primary-edge: #a9cf47;');
    expect(dark).toContain('--avatar-wash: transparent;');
    expect(light).toMatch(/--avatar-wash: rgb\(255 255 255 \/ 0\.\d+\);/);
    expect(dark).toContain('--btn-disabled-bg: #2b2e29;');
    expect(dark).toContain('--btn-disabled-border: #2b2e29;');
    expect(light).toContain('--btn-disabled-border: #d4d8cb;');
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.btn:disabled')).toContain('background: var(--btn-disabled-bg)');
    expect(ruleOf(css, '.btn:disabled')).toContain('border-color: var(--btn-disabled-border)');
    expect(ruleOf(css, '.btn--primary')).toContain('border-color: var(--color-primary-edge)');
    expect(ruleOf(css, '.avatar')).toContain('var(--avatar-wash)');
    expect(ruleOf(css, '.avatar-picker__group .swatch.is-selected')).toContain('var(--avatar-wash)');
    expect(ruleOf(stylesheet('lobby.css'), '.room-card__char')).toContain('var(--color-primary-edge)');
    expect(ruleOf(stylesheet('table.css'), '.tbl-panel .btn:disabled')).toContain('background: var(--btn-disabled-bg)');
  });

  it('keeps the felt on a light table: a pale green with white seats and ribbon, so cards never sit white on white', () => {
    const felt = ruleOf(stylesheet('table.css'), ":root[data-theme='light'] .tbl-felt");
    expect(felt).toContain('--color-surface: #e2e9d1');
    expect(felt).toContain('--color-surface-2: #ffffff');
    expect(ruleOf(stylesheet('table.css'), '.tbl-felt')).toContain('background: var(--color-surface)');
    expect(ruleOf(stylesheet('table.css'), '.tbl-ribbon__band')).toContain('background: var(--color-surface-2)');
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
    expect(html).not.toContain('<text');
    expect(html).not.toMatch(/font-family/);
    // "games" follows the theme through the mark token: the lime on dark, the lime cut to 3:1 on light, and never an outline (it swelled the letters into a blob on phones).
    expect(html).not.toContain('wordmark__accent-outline');
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.wordmark__accent')).toContain('color: var(--color-primary-mark)');
    expect(css).not.toMatch(/\.wordmark__accent[^{]*\{[^}]*stroke/);
    const tokens = stylesheet('tokens.css');
    expect(tokens).toContain('--color-primary-mark: #c7e976;');
    expect(tokens.slice(tokens.indexOf(":root[data-theme='light']"))).toContain('--color-primary-mark: #c7e976;');
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

  it('puts no connection badge beside the logo: the one connection notice lives at the top of the page', () => {
    const html = renderToString(createElement(SiteHeader));
    expect(html).not.toContain('connection-');
    expect(html).not.toContain('Connect');
  });

  it('ships no pre-Pocket-Party assets: no old game icons, nothing in the old purple', () => {
    const pub = fileURLToPath(new URL('../../../public', import.meta.url));
    expect(existsSync(`${pub}/icons/games`)).toBe(false);
    const svgs = (readdirSync(pub, { recursive: true }) as string[]).filter((f) => f.endsWith('.svg'));
    for (const f of svgs) expect(readFileSync(`${pub}/${f}`, 'utf8').toLowerCase(), f).not.toContain('#6c5ce7');
  });

  it('draws every game on an illustrated tile: its picture over its name on the footer strip, the picked one lilac with an ink check', () => {
    const tokens = stylesheet('tokens.css');
    for (const g of GAME_LIST) {
      expect(tokens).toContain(`--game-${g.id}: ${g.accent};`);
    }
    // The pictures are drawn in the mascots' palette through tokens the same in both themes; the strip flips from graphite to ink on light.
    expect(tokens).toContain('--game-paper: #f7f5ec;');
    expect(tokens.match(/--tile-foot-bg: #[0-9a-f]{6};/g)).toHaveLength(2);
    const html = renderToString(createElement(GamePicker, { room: room(), isHost: true, game: null }));
    // The picture slot comes before the name on every tile (the module's Art fills it once the games are registered: client/src/games/art.test.ts).
    expect(html.match(/<span class="game-tile__art">/g)).toHaveLength(GAME_LIST.filter((x) => x.status === 'live').length);
    expect(html).toContain('<span class="game-tile__art"></span><span class="game-tile__name">Scribble</span>');
    // The strip gets the plain name, so a two-line name splits evenly ("The Spy" over "Game" at 320px); the rules card still keeps the last two words together.
    expect(html).toContain('<span class="game-tile__name">The Spy Game</span>');
    expect(html).not.toContain('\u00a0');
    expect(noOrphan('Adults only. Crude and filthy.')).toBe('Adults only. Crude and\u00a0filthy.');
    expect(noOrphan('Scribble')).toBe('Scribble');
    expect(html).not.toContain('✏️');
    expect(tagWith(html, 'game-tile')).toContain('aria-checked="true"');
    // Only the picked tile wears the check badge.
    expect(html.match(/class="game-tile__check"/g)).toHaveLength(1);
    expect(html.indexOf('game-tile__check')).toBeLessThan(html.indexOf('data-game="spygame"'));
    // The line glyph still names the game at the top of How to play.
    expect(renderToString(createElement(RulesCard, { meta: gameById('poker'), rules: { summary: '', round: '', scoring: '', end: '', settings: '', watchers: '' }, mode: 'popover' }))).toContain('data-glyph="poker"');
    // Three to a row, a short last row stretching to fill; one neutral panel with the name on its strip; the picked tile is the lilac fill with ink.
    const lobby = stylesheet('lobby.css');
    expect(ruleOf(lobby, '.game-picker__list .game-tile')).toContain('flex: 1 1 calc(33.33% - 6px)');
    expect(ruleOf(lobby, '.game-tile')).toContain('background: var(--color-surface)');
    expect(ruleOf(lobby, '.game-tile')).toContain('overflow: hidden');
    expect(ruleOf(lobby, '.game-tile__art')).toContain('height: 84px');
    expect(ruleOf(lobby, '.game-tile__art .game-art')).toContain('max-width: 96px');
    expect(ruleOf(lobby, '.game-tile__name')).toContain('background: var(--tile-foot-bg)');
    expect(ruleOf(lobby, '.game-tile__name')).toContain('color: var(--tile-foot-fg)');
    expect(ruleOf(lobby, '.game-tile__name')).toContain('font-family: var(--font-display)');
    expect(ruleOf(lobby, '.game-tile.is-selected')).toContain('background: var(--color-secondary)');
    expect(ruleOf(lobby, '.game-tile.is-selected')).toContain('color: var(--color-secondary-contrast)');
    expect(ruleOf(lobby, '.game-tile.is-selected .game-tile__name')).toContain('background: var(--color-secondary)');
    expect(ruleOf(lobby, '.game-tile.is-selected .game-tile__name')).toContain('border-top-color: color-mix(in srgb, var(--game-ink) 35%, transparent)');
    // Only an unpicked tile lifts under the pointer: an unscoped button hover would outrank .is-selected and swap the picked tile's lilac for the hover surface.
    expect(lobby).not.toMatch(/button\.game-tile:hover/);
    expect(ruleOf(lobby, 'button.game-tile:not(.is-selected):hover')).toContain('background: var(--color-surface-2)');
    expect(lobby).not.toMatch(/rgba?\(/);
    expect(ruleOf(lobby, '.game-tile__check')).toContain('background: var(--game-ink)');
    expect(ruleOf(lobby, '.game-tile__check')).toContain('color: var(--color-secondary)');
    // A phone gives the picture a little less room; the narrowest phones shrink the name so "The Spy Game" fits its tile.
    expect(mediaBlock(lobby, '(max-width: 760px)')).toMatch(/\.game-tile__art \{[^}]*height: 72px/);
    expect(lobby).toMatch(/@media \(max-width: 359px\) \{[^@]*\.game-tile__name \{[^}]*font-size: 0.75rem/);
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
    // 10px from a title to its control, the hint 4px under the control, 32px from one setting to the next.
    expect(css).toMatch(/\n\.settings \{[^}]*gap: var\(--space-6\)/);
    expect(css).toMatch(/\n\.setting \{[^}]*gap: 10px/);
    expect(ruleOf(css, '.setting__hint')).toContain('margin-top: -6px');
    // A slider's hint comes up under the track: the range input is 44px tall with the track in its middle.
    expect(ruleOf(css, '.range-field + .setting__hint')).toContain('margin-top: -14px');
    // A word list's count and Upload sit right under the box.
    expect(ruleOf(css, '.word-list__foot')).toContain('margin-top: -4px');
    // The small upload button is still a 44px target on a phone.
    expect(ruleOf(css, '.word-list__upload')).toContain('min-height: 44px');
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
  const html = (overrides: Parameters<typeof player>[1]) => renderToString(createElement(ReadyControls, { me: player('bob', { participating: false, ...overrides }) }));
  const buttons = (markup: string) => markup.match(/<button[^>]*>/g) ?? [];

  it("not ready: one I’m ready over a secondary Sit this one out button", () => {
    const markup = html({});
    expect(readyState(player('bob'))).toBe('notReady');
    expect(buttons(markup)).toHaveLength(2);
    expect(tagWith(markup, 'ready-toggle')).toContain('aria-pressed="false"');
    expect(markup).toContain('I’m ready');
    expect(tagWith(markup, 'sitout-toggle')).toContain('btn btn--secondary');
    expect(markup).toContain('Sit this one out');
    expect(markup).not.toContain('Count me in');
    // The secondary buttons share one row, equal widths, each at least 44px tall.
    const css = stylesheet('lobby.css');
    expect(ruleOf(css, '.ready-controls__more')).toContain('grid-auto-columns: minmax(0, 1fr)');
    expect(ruleOf(css, '.ready-controls__more .btn')).toContain('min-height: 44px');
    expect(stylesheet('components.css')).not.toContain('.text-btn');
  });

  it('puts extra buttons (the room’s Change my look) in the same row, sitting out included', () => {
    const extra = createElement('button', { type: 'button', className: 'btn btn--secondary', 'data-testid': 'edit-profile' }, 'Change my look');
    for (const overrides of [{}, { sittingOut: true }]) {
      const markup = renderToString(createElement(ReadyControls, { me: player('bob', overrides), extra }));
      const row = markup.slice(markup.indexOf('ready-controls__more'));
      expect(row).toContain('data-testid="edit-profile"');
    }
  });

  it("ready: the same button checked (You’re ready, tap to undo) and the same Sit this one out", () => {
    const markup = html({ ready: true });
    expect(buttons(markup)).toHaveLength(2);
    expect(tagWith(markup, 'ready-toggle')).toContain('aria-pressed="true"');
    expect(tagWith(markup, 'ready-toggle')).not.toContain('disabled');
    expect(markup).toContain('You’re ready');
    expect(markup).toContain('Sit this one out');
  });

  it('sitting out: only Count me in, with the hint; no disabled ready button', () => {
    const markup = html({ sittingOut: true });
    expect(readyState(player('bob', { sittingOut: true }))).toBe('sittingOut');
    expect(buttons(markup)).toHaveLength(1);
    expect(markup).not.toContain('data-testid="ready-toggle"');
    expect(tagWith(markup, 'sitout-toggle')).toContain('btn--primary');
    expect(markup).toContain('Count me in');
    expect(markup).toContain('You’ll watch the next game.');
  });

  it('the host is in by pressing Start: only the way out is left', () => {
    const host = player('host', { participating: false });
    const lobby = renderToString(createElement(ReadyControls, { me: host }));
    expect(lobby).not.toContain('data-testid="ready-toggle"');
    expect(buttons(lobby)).toHaveLength(1);
    expect(lobby).toContain('Sit this one out');
  });
});

describe('sliders', () => {
  it('glide under a finger and snap to the step when let go: the nearest step inside the range', () => {
    expect(snapToStep(3.4, 1, 10, 1)).toBe(3);
    expect(snapToStep(3.6, 1, 10, 1)).toBe(4);
    expect(snapToStep(0.2, 1, 10, 1)).toBe(1);
    expect(snapToStep(10.7, 1, 10, 1)).toBe(10);
    expect(snapToStep(12, 0, 100, 5)).toBe(10);
    expect(snapToStep(13, 0, 100, 5)).toBe(15);
    // The grid starts at the minimum, not at zero.
    expect(snapToStep(7.4, 5, 25, 5)).toBe(5);
    expect(snapToStep(7.6, 5, 25, 5)).toBe(10);
  });
});

describe('player rows', () => {
  it('mark your own row with a lime tint, not the word "you", and the host with a crown by the name, in the room and in a game', () => {
    const markup = renderToString(createElement(PlayerList, { room: room(), meId: 'host', isHost: true, mode: 'game', game: null }));
    expect(markup).not.toContain('player__you');
    expect(markup).toContain('<span class="sr-only">(you)</span>');
    expect(tagWith(markup, 'player-item')).toContain('player--me');
    expect(ruleOf(stylesheet('components.css'), '.player--me')).toContain('color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))');
    expect(markup).not.toContain('player__tag');
    expect(tagWith(markup, 'host-crown')).toContain('class="player__crown"');
    // An image role, so a screen reader hears the crown's label (a plain span would drop it).
    expect(tagWith(markup, 'host-crown')).toContain('role="img"');
    expect(tagWith(markup, 'host-crown')).toContain('aria-label="Host"');
    expect(markup).toContain('player__name-text">host<');
    const lobby = renderToString(createElement(PlayerList, { room: room(), meId: 'bob', isHost: false, mode: 'lobby', game: null }));
    expect(tagWith(lobby, 'host-crown')).toContain('class="player__crown"');
    expect(lobby).not.toContain('player__tag');
    expect(lobby).not.toMatch(/>\s*Host</);
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.player__name')).toContain('flex-wrap: wrap');
  });

  it('never cut a score or this turn’s points: the points take a second line when the column is narrow', () => {
    const meta = ruleOf(stylesheet('components.css'), '.player__meta');
    expect(meta).toContain('flex-wrap: wrap');
    expect(meta).not.toContain('overflow');
    expect(meta).toContain('white-space: nowrap');
  });

  it('put the kick button last, after the status, in a column that lines up down the list', () => {
    const state = room({ players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2, connected: false })] });
    const markup = renderToString(createElement(PlayerList, { room: state, meId: 'host', isHost: true, mode: 'lobby', game: null }));
    for (const id of ['bob', 'carol']) {
      const row = markup.slice(markup.indexOf(`data-player-id="${id}"`));
      const li = row.slice(0, row.indexOf('</li>'));
      expect(li.indexOf('data-testid="player-status"'), id).toBeGreaterThan(-1);
      expect(li.indexOf('data-testid="player-status"'), id).toBeLessThan(li.indexOf('data-testid="kick-player"'));
    }
    // Your own row keeps the button's column empty, so its status lines up with the others'.
    const mine = markup.slice(markup.indexOf('data-player-id="host"'));
    expect(mine.slice(0, mine.indexOf('</li>'))).toMatch(/data-testid="player-status".*player__actions--spacer/);
    // Alone in the room nobody has a kick button, so nothing is held free.
    const alone = renderToString(createElement(PlayerList, { room: room({ players: [player('host')] }), meId: 'host', isHost: true, mode: 'lobby', game: null }));
    expect(alone).not.toContain('player__actions');
    // In the room the button is a 44px target that always shows; the empty column is as wide.
    const lobby = stylesheet('lobby.css');
    expect(ruleOf(lobby, '.lobby__players .player__kick')).toMatch(/width: 44px;[^}]*height: 44px;[^}]*opacity: 1/);
    expect(ruleOf(lobby, '.lobby__players .player__actions--spacer')).toContain('width: 44px');
  });
});

describe('avatar picker', () => {
  it('shows every face and colour at once, with no scrolling box', () => {
    const markup = renderToString(createElement(AvatarPicker, { value: { color: 0, emoji: 0 }, onChange: () => undefined }));
    expect(markup.match(/class="emoji-choice/g)).toHaveLength(AVATAR_FACES.length);
    expect(markup.match(/class="swatch/g)).toHaveLength(AVATAR_COLORS.length);
    expect(AVATAR_FACES).toHaveLength(50);
    const css = stylesheet('components.css');
    expect(css).not.toMatch(/\.avatar-picker__emojis \{[^}]*(max-height|overflow)/);
    // A colour fills its column at a face's height, so the colours line up with the faces under them.
    expect(ruleOf(css, '.avatar-picker__group .swatch')).toMatch(/width: 100%;[^}]*height: 44px/);
    expect(ruleOf(css, '.emoji-choice')).toContain('height: 44px');
  });

  it('names each face and shows its picture, the chosen one checked', () => {
    const markup = renderToString(createElement(AvatarPicker, { value: { color: 3, emoji: 42 }, onChange: () => undefined }));
    const faces = markup.match(/<button[^>]*class="emoji-choice[^"]*"[^>]*>.*?<\/button>/g) ?? [];
    expect(faces).toHaveLength(50);
    faces.forEach((button, i) => {
      expect(button).toContain(`aria-label="${AVATAR_FACES[i].name}"`);
      // The button's label says what it is, so the picture inside is silent.
      expect(button).toContain(`src="/avatars/${AVATAR_FACES[i].file}.webp" alt=""`);
      expect(button).toContain(`aria-checked="${i === 42}"`);
    });
    expect(markup).toContain('alt="Your avatar: Dragon face"');
  });

  it('lays the faces out in full rows only: 5 or 10 equal columns, the colours 6 by 2 down to the name step on a 320px phone (4 by 3 narrower still), each 44px tall', () => {
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.avatar-picker')).toContain('container-type: inline-size');
    expect(ruleOf(css, '.avatar-picker__group')).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
    expect(ruleOf(css, '.avatar-picker__colors')).toContain('grid-template-columns: repeat(6, minmax(0, 1fr))');
    const columns = [...css.matchAll(/@container \((min|max)-width: ([\d.]+)px\) \{\s*\.avatar-picker__(emojis|colors) \{\s*grid-template-columns: repeat\((\d+), minmax\(0, 1fr\)\);/g)].map((m) => ({
      bound: m[1],
      width: Number(m[2]),
      group: m[3],
      count: Number(m[4]),
    }));
    expect(columns).toEqual([
      { bound: 'max', width: 247.98, group: 'colors', count: 4 },
      { bound: 'min', width: 476, group: 'emojis', count: 10 },
    ]);
    expect(ruleOf(css, '.avatar-picker__group')).toContain('gap: 4px');
    // Every count divides its list, and every column switch leaves each choice 44px or more with its 4px gaps.
    for (const { bound, width, group, count } of columns) {
      const items = group === 'emojis' ? AVATAR_FACES.length : AVATAR_COLORS.length;
      expect(items % count).toBe(0);
      if (bound === 'min') expect((width - 4 * (count - 1)) / count).toBeGreaterThanOrEqual(44);
      // Just past a max-width switch the six colour columns take over, each at least 38px wide (and 44px tall).
      else expect((Math.ceil(width) - 4 * 5) / 6).toBeGreaterThanOrEqual(38);
    }
    expect(css).not.toContain('auto-fill, minmax(44px');
  });
});

describe('avatar', () => {
  it('draws the face as its bundled picture on the colour, lazily, sized by the font size', () => {
    const markup = renderToString(createElement(Avatar, { avatar: { color: 7, emoji: 29 }, size: 'lg' }));
    expect(markup).toMatch(/^<span class="avatar avatar--lg" style="background:#3b82f6" aria-hidden="true"><img class="face-img" src="\/avatars\/alien\.webp" alt="" width="52" height="52" loading="lazy" decoding="async" draggable="false"\/><\/span>$/);
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.face-img')).toContain('width: 1.125em');
    expect(ruleOf(css, '.face-img')).toContain('height: 1.125em');
  });

  it('is read out only when given a label, which becomes the alt text', () => {
    const markup = renderToString(createElement(Avatar, { avatar: { color: 0, emoji: 0 }, label: 'Your avatar: Grinning face' }));
    expect(markup).not.toContain('aria-hidden');
    expect(markup).toContain('alt="Your avatar: Grinning face"');
  });

  it('keeps the old index of every saved avatar and falls back to the first face past the list', () => {
    expect(renderToString(createElement(Avatar, { avatar: { color: 0, emoji: 23 } }))).toContain('src="/avatars/lion.webp"');
    expect(renderToString(createElement(Avatar, { avatar: { color: 0, emoji: 77 } }))).toContain('src="/avatars/grinning-face.webp"');
  });

  it('has a picture for every size an avatar is drawn at, no larger than its 104px file at 2x', () => {
    const css = stylesheet('components.css');
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      const font = Number(ruleOf(css, `.avatar--${size}`).match(/font-size: (\d+)px/)?.[1]);
      expect(font * 1.125 * 2, size).toBeLessThanOrEqual(104);
    }
  });
});

describe('lobby', () => {
  it('opens with the room code (the tiles, Copy and Share, no label) above the game picker; the old invite card is gone', () => {
    // The code section is outside every host-only branch, so host and guests get the same one.
    const markup = renderToString(createElement(Lobby, { room: room(), game: null }));
    const bar = markup.indexOf('data-testid="room-bar"');
    expect(bar).toBeGreaterThan(-1);
    expect(bar).toBeLessThan(markup.indexOf('data-testid="game-picker"'));
    expect(markup).toContain('aria-label="Room code A B C D"><span class="room-card__char">A</span><span class="room-card__char">B</span>');
    // No visible "Room code" label: the lime tiles say it, and the group keeps the name for screen readers.
    expect(markup).not.toContain('>Room code</span>');
    expect(markup).not.toContain('room-card__label');
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

  it('is one header bar on a wider screen (a surface with the logo, the code and its buttons on one 44px line), split on a phone into the centred logo and the code card', () => {
    const markup = renderToString(createElement(Lobby, { room: room(), game: null }));
    const top = markup.slice(markup.indexOf('class="lobby__top"'));
    expect(top.indexOf('data-testid="site-header"')).toBeLessThan(top.indexOf('data-testid="room-bar"'));
    expect(top.indexOf('data-testid="room-bar"')).toBeLessThan(top.indexOf('data-testid="game-picker"'));
    // The code section is a part of the bar, never a card of its own beside the logo.
    expect(tagWith(markup, 'room-bar')).toContain('class="room-card"');
    const css = stylesheet('lobby.css');
    const bar = ruleOf(css, '.lobby__top');
    expect(bar).toMatch(/display: flex;[^}]*align-items: center/);
    expect(bar).toContain('background: var(--color-surface)');
    expect(bar).toContain('border: 1px solid var(--color-border)');
    expect(bar).toContain('border-radius: var(--radius-md)');
    expect(ruleOf(css, '.lobby__top .site-header')).toContain('min-height: 44px');
    expect(ruleOf(css, '.lobby__top .room-card')).toContain('flex: 1 1 auto');
    // The label and the tiles together, centred between the logo and the buttons; Copy and Share compact, 44px tall, with their hover and pressed states.
    expect(ruleOf(css, '.room-card__code')).toMatch(/align-items: center;[^}]*justify-content: center/);
    expect(ruleOf(css, '.room-card__btn')).toContain('min-height: 44px');
    expect(ruleOf(css, '.room-card__btn')).not.toContain('flex-direction: column');
    expect(ruleOf(css, '.room-card__btn:hover')).toContain('border-color: var(--color-border-strong)');
    expect(ruleOf(css, '.room-card__btn:active')).toContain('transform: translateY(1px)');
    // The gear's popover clears the bar's bottom edge (the logo's offset in the 44px line, 10px padding, 1px border) by 8px.
    expect(ruleOf(css, '.lobby .settings-menu--logo .settings-menu__panel')).toContain('top: calc(100% + (44px - var(--wordmark-height)) / 2 + 19px)');
    // A phone: the bar's surface moves to the card, the label over the tiles, the buttons squares; the popover hangs from the bare logo again.
    const phone = mediaBlock(css, '(max-width: 760px), (min-aspect-ratio: 3/2) and (max-height: 520px)');
    expect(phone).toMatch(/\.lobby__top \{[^}]*flex-direction: column/);
    expect(phone).toMatch(/\.lobby__top \{[^}]*background: none/);
    expect(phone).toMatch(/\.room-card \{[^}]*background: var\(--color-surface\)/);
    expect(phone).toMatch(/\.room-card \{[^}]*border-radius: var\(--radius-md\)/);
    expect(phone).toMatch(/\.room-card__code \{[^}]*flex-direction: column/);
    expect(phone).toMatch(/\.room-card__btn \{[^}]*flex-direction: column/);
    expect(phone).toMatch(/\.lobby \.settings-menu--logo \.settings-menu__panel \{[^}]*top: calc\(100% \+ 12px\)/);
  });

  it('pins Start, Ready and the row under them to the bottom of the screen, short page or long, its line across the whole page', () => {
    const markup = renderToString(createElement(Lobby, { room: room(), game: null }));
    // The footer sits outside the page's centred column, so its border spans the full width.
    const body = markup.indexOf('class="lobby__body"');
    const footer = markup.indexOf('data-testid="lobby-footer"');
    expect(body).toBeGreaterThan(-1);
    expect(markup.slice(body, footer)).toContain('data-testid="player-list"');
    const css = stylesheet('lobby.css');
    expect(ruleOf(css, '.lobby')).toMatch(/min-height: 100dvh;[^}]*flex-direction: column/);
    expect(ruleOf(css, '.lobby')).not.toContain('width:');
    expect(ruleOf(css, '.lobby__body')).toContain('flex: 1 0 auto');
    const bar = ruleOf(css, '.lobby__footer');
    expect(bar).toMatch(/position: sticky;[^}]*bottom: 0/);
    expect(bar).toContain('border-top: 1px solid var(--color-border)');
    expect(bar).not.toMatch(/margin|width/);
  });

  it('says nothing about being alone: the code card already asks to be shared', () => {
    const markup = renderToString(createElement(Lobby, { room: room({ players: [player('host')] }), game: null }));
    expect(markup).not.toContain('lobby-alone');
    expect(markup).not.toContain('No one else is here yet');
  });

  it('opens Change my look as a centred box over the dimmed page on a desktop, a drawer on tablets and phones', () => {
    const css = stylesheet('components.css');
    const desktop = mediaBlock(css, '(min-width: 1024px)');
    expect(desktop).toMatch(/\.sheet--dialog \{[^}]*justify-content: center;[^}]*align-items: center/);
    expect(desktop).toMatch(/\.sheet--dialog \.sheet__panel \{[^}]*border-radius: var\(--radius-lg\)/);
    expect(desktop).toMatch(/\.sheet--dialog \.sheet__handle \{[^}]*display: none/);
    expect(css).not.toMatch(/@media \((max|min)-width: (7\d\d|8\d\d|9\d\d)px\) \{[^@]*\.sheet--dialog/);
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
    // The kick button is the row's last item, after the status.
    const bob = markup.slice(markup.indexOf('data-player-id="bob"'));
    expect(bob.indexOf('data-testid="player-status"')).toBeLessThan(bob.indexOf('data-testid="votekick-player"'));
    expect(bob.indexOf('data-testid="votekick-player"')).toBeLessThan(bob.indexOf('</li>'));
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

  it('says on Start itself how many ready players the game still needs, with no line under it to come and go', () => {
    const short = enter('host', room({ players: [player('host', { ready: true }), player('bob', { joinOrder: 1 })] }));
    expect(short).toContain('>Start · 1 ready, needs 2</button>');
    expect(short).not.toContain('start-hint');
    expect(short).not.toContain('needs at least');
    const ready = enter('host', room({ players: [player('host', { ready: true }), player('bob', { joinOrder: 1, ready: true })] }));
    expect(ready).toContain('>Start · 2 ready</button>');
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

  it('centres the logo on a phone, with nothing beside it to push it aside', () => {
    const css = stylesheet('lobby.css');
    const phone = mediaBlock(css, '(max-width: 760px), (min-aspect-ratio: 3/2) and (max-height: 520px)');
    expect(phone).toMatch(/\.lobby \.site-header \{[^}]*justify-content: center/);
    expect(renderToString(createElement(SiteHeader, {}))).not.toContain('site-header__actions');
    expect(phone).toMatch(/\.lobby \.settings-menu--logo \.settings-menu__panel \{[^}]*left: calc\(50% - /);
  });
});

describe('results popup', () => {
  const AV = { color: 0, emoji: 0 };
  const results = (overrides: Partial<GameResults> = {}): GameResults => ({
    id: 'r1',
    gameId: 'scribble',
    reason: 'finished',
    entries: [
      { playerId: 'bob', name: 'bob', avatar: AV, score: 30, rank: 1 },
      { playerId: 'carol', name: 'carol', avatar: AV, score: 20, rank: 2 },
      { playerId: 'host', name: 'host', avatar: AV, score: 10, rank: 3 },
    ],
    ...overrides,
  });
  const popup = (meId: string | null, r: GameResults = results()) => renderToString(createElement(ResultsPopup, { results: r, meId, onClose: () => undefined }));

  it('celebrates the winner by name and points, tells each player their place, ranks the top three with the winner in the middle and lists everyone', () => {
    const html = popup('bob');
    expect(tagWith(html, 'overlay-game-end')).toContain('data-winner="true"');
    expect(html).toContain('Scribble · Game over');
    expect(html).toContain('bob wins!');
    expect(html).toContain('>30 points<');
    expect(html).toContain('You won!');
    expect(html).toContain('data-testid="confetti"');
    // The small happy phone, decorative.
    expect(html).toMatch(/<svg class="mascot results-hero__mascot"[^>]*aria-hidden="true"/);
    expect(tagsWith(html, 'results-step').map((t) => attr(t, 'data-rank'))).toEqual(['2', '1', '3']);
    expect(tagsWith(html, 'results-entry').map((t) => attr(t, 'data-rank'))).toEqual(['1', '2', '3']);
    expect(tagsWith(html, 'results-entry').map((t) => attr(t, 'data-name'))).toEqual(['bob', 'carol', 'host']);
    const third = popup('host');
    expect(third).toContain('You came 3rd');
    expect(tagWith(third, 'overlay-game-end')).toContain('data-winner="false"');
    expect(popup('carol')).toContain('You came 2nd');
    expect(popup('dan')).toContain('You watched this one');
    // A game that ran its course needs no reason line.
    expect(html).not.toContain('data-testid="results-reason"');
  });

  it('says why a game ended early, and crowns nobody when too few players were left', () => {
    const host = popup('bob', results({ reason: 'host' }));
    expect(textOf(host, 'results-reason')).toBe('The host ended the game.');
    expect(host).toContain('bob wins!');
    const short = popup('bob', results({ reason: 'players' }));
    expect(textOf(short, 'results-reason')).toBe('Too few players were left.');
    expect(short).toContain('Game over');
    expect(short).not.toContain('bob wins!');
    expect(short).not.toContain('data-testid="confetti"');
    expect(short).toContain('You were in the lead');
    expect(tagsWith(short, 'results-entry')).toHaveLength(3);
    // Nobody had scored when it was cut short: nobody was in the lead either.
    const blank = popup('carol', results({ reason: 'players', entries: results().entries.map((e) => ({ ...e, score: 0, rank: 1 })) }));
    expect(blank).toContain('Nobody scored');
    expect(blank).not.toContain('in the lead');
  });

  it('prints the standings like the headline: grouped thousands and "1 pt" for a single point', async () => {
    const { scoreShort, scoreWords } = await import('../lib/format');
    expect(scoreShort(1)).toBe('1 pt');
    expect(scoreShort(0)).toBe('0 pts');
    expect(scoreShort(1100)).toBe('1,100 pts');
    // A card table's score is its stack: chips, never points.
    expect(scoreShort(1, 'chips')).toBe('1 chip');
    expect(scoreShort(1040, 'chips')).toBe('1,040 chips');
    expect(scoreWords(1040, 'chips')).toBe('1,040 chips');
    expect(scoreWords(1)).toBe('1 point');
    const html = popup('bob', results({ entries: [
      { playerId: 'host', name: 'host', avatar: AV, score: 1100, rank: 1 },
      { playerId: 'bob', name: 'bob', avatar: AV, score: 1, rank: 2 },
    ] }));
    expect(html).toContain('>1,100 points<');
    expect(html).toContain('>1,100 pts<');
    expect(html).toContain('>1 pt<');
    expect(html).not.toContain('1 pts');
    expect(html).not.toContain('1100 pts');
    const list = renderToString(createElement(PlayerList, { room: room({ phase: 'playing', players: [player('host', { score: 1 }), player('bob', { score: 1100, joinOrder: 1 })] }), meId: 'host', isHost: true, mode: 'game', game: null }));
    expect(list).toContain('>1 pt<');
    expect(list).toContain('>1,100 pts<');
  });

  it('announces a tie instead of crowning the first of the tied players', () => {
    const html = popup('bob', results({ entries: [
      { playerId: 'host', name: 'host', avatar: AV, score: 30, rank: 1 },
      { playerId: 'bob', name: 'bob', avatar: AV, score: 30, rank: 1 },
    ] }));
    expect(html).toContain('host and bob tie!');
    expect(html).toContain('You tied for the win!');
    expect(html).toContain('>30 points each<');
    expect(html).not.toContain('host wins!');
  });

  it('closes with Back to the room or the X, and holds no ready, leave or host buttons: the lobby has those', () => {
    const html = popup('host');
    expect(textOf(html, 'results-done')).toBe('Back to the room');
    expect(tagWith(html, 'results-close')).toContain('aria-label="Close"');
    for (const id of ['ready-toggle', 'sitout-toggle', 'play-again', 'back-to-lobby', 'leave-room', 'podium-menu']) expect(html).not.toContain(`data-testid="${id}"`);
    // Back to the room stays below the scrolling standings, so a small phone never hides it.
    expect(html.indexOf('data-testid="results-done"')).toBeGreaterThan(html.lastIndexOf('data-testid="results-entry"'));
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.results-card')).toContain('overflow: hidden');
    expect(ruleOf(css, '.results-card__scroll')).toContain('overflow-y: auto');
    expect(ruleOf(css, '.results-card__scroll')).toContain('min-height: 0');
    expect(ruleOf(css, '.results-card__actions')).toContain('flex: none');
  });

  it('is a modal dialog whose card (never a button) takes the focus, with no focus ring around it', () => {
    const html = popup('host');
    const dialog = tagWith(html, 'overlay-game-end');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(tagWith(html, 'results-card')).toContain('tabindex="-1"');
    expect(ruleOf(stylesheet('components.css'), '.results-card:focus-visible')).toContain('outline: none');
    // The backdrop is not a stop on the keyboard's way round.
    expect(tagWith(html, 'results-backdrop')).toContain('tabindex="-1"');
  });

  it('shows over the lobby once a game ended, and the lobby is back under it when it closes', async () => {
    const { RoomScreen } = await import('../../App');
    const { registerGames } = await import('../registry');
    registerGames(registryOf({ Screen: () => null }));
    const players = [player('host'), player('bob', { joinOrder: 1 })];
    const lobby = room({ phase: 'lobby', players, results: results() });
    const store = usePlatformStore.getState();
    store.handleServerMessage(welcome('host', room({ phase: 'playing', players })));
    store.handleServerMessage({ t: 'room', room: lobby });
    const up = renderToString(createElement(RoomScreen, { room: lobby }));
    expect(up).toContain('data-testid="lobby"');
    expect(up).toContain('data-testid="overlay-game-end"');
    usePlatformStore.getState().closeResults();
    const closed = renderToString(createElement(RoomScreen, { room: lobby }));
    expect(closed).toContain('data-testid="lobby"');
    expect(closed).not.toContain('data-testid="overlay-game-end"');
    // Closed for good: the next snapshot (or a reload's welcome) of the same results does not bring it back.
    usePlatformStore.getState().handleServerMessage(welcome('host', room({ phase: 'lobby', players, results: results() })));
    expect(usePlatformStore.getState().results).toBeNull();
  });
});

describe('the ways out of a game', () => {
  const players = [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 }), player('dan', { joinOrder: 3, participating: false })];
  const playing = (overrides: Parameters<typeof room>[0] = {}) => room({ gameId: 'scribble', phase: 'playing', players, ...overrides });

  it('offers End game to the host only, styled as the serious action, and Leave room to everyone, each saying what it does', () => {
    const host = renderToString(createElement(ExitActions, { room: playing(), isHost: true, onPick: () => undefined }));
    expect(tagWith(host, 'end-game')).toContain('exit-action--end');
    expect(host).toContain('Ends it for everyone');
    expect(tagWith(host, 'leave-room')).not.toContain('exit-action--end');
    expect(host).toContain('Only you leave');
    expect(host.indexOf('data-testid="end-game"')).toBeLessThan(host.indexOf('data-testid="leave-room"'));
    const guest = renderToString(createElement(ExitActions, { room: playing(), isHost: false, onPick: () => undefined }));
    expect(guest).not.toContain('data-testid="end-game"');
    expect(guest).toContain('data-testid="leave-room"');
    // Asked for already (Blackjack ends after the hand): a note in its place, not a second button.
    const asked = renderToString(createElement(ExitActions, { room: playing({ endRequested: true }), isHost: true, onPick: () => undefined }));
    expect(asked).not.toContain('data-testid="end-game"');
    expect(textOf(asked, 'end-game-requested')).toContain('Ending soon');
    const css = stylesheet('components.css');
    expect(ruleOf(css, '.exit-action--end')).toContain('var(--color-danger)');
    expect(css).toMatch(/\n\.exit-action \{[^}]*min-height: 60px/);
  });

  it('asks before ending, in short plain words, with the game’s own note where it has one', () => {
    const html = renderToString(createElement(EndGameConfirm, { room: playing(), onCancel: () => undefined, testId: 'end-game' }));
    expect(html).toContain('End the game for everyone?');
    expect(html).toContain('Everyone sees the scores so far.');
    expect(textOf(html, 'end-game-yes')).toBe('End game');
    expect(tagWith(html, 'end-game-yes')).toContain('btn--danger-solid');
    expect(textOf(html, 'end-game-no')).toBe('Keep playing');
    expect(endGameNote(playing())).toBe('Everyone sees the scores so far.');
    for (const text of [html]) expect(text).not.toContain('—');
  });

  it('asks before leaving, and says whether the game goes on without you', () => {
    expect(leaveNote(playing(), 'bob')).toBe('The game goes on without you.');
    // Scribble needs two: with three in it, one leaving leaves enough; with two, it ends.
    expect(leaveNote(playing({ players: players.slice(0, 2) }), 'bob')).toBe('Too few would be left, so the game ends for everyone.');
    expect(leaveNote(playing(), 'dan')).toBe('The game goes on. You need the code to come back.');
    expect(leaveNote(room(), 'bob')).toBe("You’d need the code to come back in.");
    const html = renderToString(createElement(LeaveConfirm, { room: playing(), meId: 'bob', onCancel: () => undefined, testId: 'game-leave' }));
    expect(html).toContain('Leave the room?');
    expect(html).toContain('The game goes on without you.');
    expect(textOf(html, 'game-leave-yes')).toBe('Leave room');
    expect(textOf(html, 'game-leave-no')).toBe('Stay');
  });

  it('puts both in the phone’s options sheet, under the preferences', () => {
    usePlatformStore.getState().handleServerMessage(welcome('host', playing()));
    const host = renderToString(createElement(GameMenuSheet, { open: true, onClose: () => undefined }));
    expect(host.indexOf('data-testid="sound-toggle"')).toBeGreaterThan(-1);
    expect(host.indexOf('data-testid="sound-toggle"')).toBeLessThan(host.indexOf('data-testid="end-game"'));
    expect(host).toContain('data-testid="leave-room"');
    usePlatformStore.getState().handleServerMessage(welcome('bob', playing()));
    const guest = renderToString(createElement(GameMenuSheet, { open: true, onClose: () => undefined }));
    expect(guest).not.toContain('data-testid="end-game"');
    expect(guest).toContain('data-testid="leave-room"');
  });

  it('puts End game in the desktop top bar for the host, and both in the gear’s menu', () => {
    usePlatformStore.getState().handleServerMessage(welcome('host', playing()));
    const bar = (state: RoomState) =>
      renderToString(
        createElement(GameTopBar, {
          meta: gameById('scribble'),
          room: state,
          isPhone: false,
          testId: 'scribble-header',
          status: 'Round 1/3',
          players: { open: false, onOpen: () => undefined },
          menu: { open: false, onOpen: () => undefined },
        }),
      );
    const html = bar(playing());
    expect(textOf(html, 'end-game')).toBe('End game');
    expect(tagWith(html, 'end-game')).toContain('gbar-end');
    expect(textOf(bar(playing({ endRequested: true })), 'end-game-requested')).toBe('Ending soon');
    usePlatformStore.getState().handleServerMessage(welcome('bob', playing()));
    expect(bar(playing())).not.toContain('data-testid="end-game"');
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

  it('puts the round under the name on a phone, so the name, the round and the buttons each keep their own space', () => {
    expect(renderToString(createElement(RoundStatus, { round: 1, total: 5 }))).toBe('Round 1/5');
    const phone = bar(true);
    const title = phone.slice(phone.indexOf('class="gbar__title"'), phone.indexOf('data-testid="game-menu"'));
    expect(title.indexOf('The Spy Game')).toBeLessThan(title.indexOf('data-testid="round-indicator"'));
    // A desktop keeps the round on the right, outside the title.
    const desk = bar(false);
    const deskTitle = desk.slice(desk.indexOf('class="gbar__title"'));
    expect(deskTitle.slice(0, deskTitle.indexOf('</div>'))).not.toContain('round-indicator');
    const css = stylesheet('gamebar.css');
    expect(ruleOf(css, '.gbar--phone .gbar__title')).toContain('flex-direction: column');
    expect(ruleOf(css, '.gbar--phone .gbar__status')).toContain('white-space: nowrap');
    // The name never gives way to the round any more.
    expect(css).not.toMatch(/\.gbar__name \{\s*display: none/);
  });

  it('draws the players button as a pill with the people icon and the count, in a 44px target', () => {
    const html = renderToString(
      createElement(GameTopBar, {
        meta: gameById('poker'),
        room: room({ gameId: 'poker', phase: 'playing', players }),
        isPhone: true,
        testId: 'poker-header',
        players: { open: false, onOpen: noop },
        menu: { open: false, onOpen: noop },
        compact: true,
      }),
    );
    const button = html.slice(html.indexOf('data-testid="players-toggle"'));
    expect(button.slice(0, button.indexOf('</button>'))).toMatch(/class="gbar__count-pill"><svg[^]*class="gbar__count-n">4</);
    const css = stylesheet('gamebar.css');
    expect(ruleOf(css, '.gbar__count')).toContain('height: 44px');
    expect(ruleOf(css, '.gbar__count-pill')).toContain('border-radius: var(--radius-pill)');
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

  it("use the game’s own status when it has one", () => {
    const r = room({ phase: 'playing' });
    const game = { meta: gameById('scribble'), Screen: () => null, Art: () => null, rules: { summary: '', round: '', scoring: '', end: '', settings: '', watchers: '' }, playerStatus: () => ({ label: 'Drawing', icon: null, tone: 'active' as const }) };
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
    const paused = renderToString(createElement(ResultNext, { noun: 'Next turn', paused: true, settling: false, testId: 'next' }));
    expect(tagWith(paused, 'next')).toContain('data-countdown="paused"');
    expect(paused).toContain('Next turn is paused');
    // One countdown per screen: the top bar's ring counts; the result only says what comes next.
    const running = renderToString(createElement(ResultNext, { noun: 'Next turn', paused: false, settling: false, testId: 'next' }));
    expect(running).toContain('Next turn soon');
    expect(running).not.toContain('data-testid="timer"');
  });
});
