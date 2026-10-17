import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { closeResults, createParty, enterNameIfAsked, joinByLink, leaveLobby, readyAll, roomTabTitle } from './party';

/**
 * The front door and the routing around it: Join a room and Create a room and nothing else, the four code
 * boxes (typing, paste, keys, errors), create → name step → lobby with the game picker, invite
 * deep links, the old per-game pages redirecting home, the theme, phone and desktop widths, and
 * a whole Click Race (the hidden template game) between two players.
 */
test.describe.configure({ mode: 'serial' });

const PORTRAIT = { width: 390, height: 844 };
const MIN_BUTTON = 48;

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  errors: string[];
}

const players: Player[] = [];
let host: Player;
let guest: Player;
let phone: Player;
let scribbleCode = '';

async function newPlayer(browser: Browser, name: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<Player> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`${name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${name}: ${msg.text()}`);
  });
  const player: Player = { name, context, page, errors };
  players.push(player);
  return player;
}

async function scoreOf(page: Page, name: string): Promise<number> {
  const raw = await page.locator(`[data-testid="player-item"][data-name="${name}"]`).getAttribute('data-score');
  return Number(raw ?? 'NaN');
}

async function noHorizontalOverflow(page: Page, width: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function boxes(page: Page): Promise<string[]> {
  return Promise.all([0, 1, 2, 3].map((i) => page.getByTestId(`code-input-${i}`).inputValue()));
}

async function focusedBox(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
}

/** Pastes `text` into the first box the way a browser would: a bubbling ClipboardEvent carrying the text. */
async function paste(page: Page, text: string): Promise<void> {
  await page.getByTestId('code-input-0').focus();
  await page.getByTestId('code-input-0').evaluate((el, t) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
}

function unknownCode(): string {
  return scribbleCode === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  guest = await newPlayer(browser, 'Gus');
  phone = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the front door has exactly two action paths, four visible boxes and no catalogue or menu', async () => {
  await host.page.goto('/');
  await expect(host.page).toHaveTitle('boredgames.io');
  // Connected: no connection notice at all (it only shows once the link has been gone a moment).
  await expect(host.page.getByTestId('home-create')).toBeVisible();
  await expect(host.page.getByTestId('connection-notice')).toHaveCount(0);
  await expect(host.page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // The wordmark is outlined vector art with an accessible name, never live text or a controller icon.
  const header = host.page.getByTestId('site-header');
  await expect(header.getByRole('img', { name: 'boredgames.io' })).toBeVisible();
  // "bored" + ".i", "games", and the gear that stands in for the "o".
  await expect(header.locator('svg[data-testid="wordmark"] > path')).toHaveCount(3);
  await expect(header.locator('svg[data-testid="wordmark"] text')).toHaveCount(0);
  await expect(header.locator('.brand__mark')).toHaveCount(0);
  // The theme lives in the settings menu behind the gear, not as a header button of its own; the gear is the "o" of ".io".
  await expect(header.getByTestId('settings-menu')).toBeVisible();
  await expect(header.getByRole('button', { name: 'Settings' })).toHaveCount(1);
  const gear = await header.locator('.wordmark__gear').boundingBox();
  const gearButton = await header.getByTestId('settings-menu').boundingBox();
  expect(Math.abs((gear?.x ?? 0) + (gear?.width ?? 0) / 2 - ((gearButton?.x ?? 0) + (gearButton?.width ?? 0) / 2)), 'the button is centred on the gear').toBeLessThanOrEqual(1.5);
  expect(Math.abs((gear?.y ?? 0) + (gear?.height ?? 0) / 2 - ((gearButton?.y ?? 0) + (gearButton?.height ?? 0) / 2))).toBeLessThanOrEqual(1.5);
  await expect(host.page.getByTestId('theme-toggle')).toHaveCount(0);
  // The two phones are the logo's icon, inside the same SVG, left of the text.
  await expect(header.locator('svg[data-testid="wordmark"] .wordmark__icon')).toHaveCount(1);
  await expect(host.page.locator('.home__mascots')).toHaveCount(0);

  // No tagline, no sub-line, no footer.
  await expect(host.page.getByText('Less bored')).toHaveCount(0);
  await expect(host.page.getByText('A room code is all it takes')).toHaveCount(0);
  await expect(host.page.getByText('Made for one more round.')).toHaveCount(0);
  await expect(host.page.locator('footer')).toHaveCount(0);

  // One column as on the brand board: the boxes and Join, then Create a room right under it. "Join a
  // room" names the boxes for screen readers only. No panel boxes, no visible heading, no helper
  // line. Nothing else to click on the page.
  const start = host.page.locator('.home__start > *');
  await expect(start).toHaveCount(2);
  await expect(start.nth(0)).toHaveAttribute('data-testid', 'join-panel');
  await expect(start.nth(1)).toHaveAttribute('data-testid', 'create-panel');
  await expect(host.page.getByRole('heading', { name: 'Join a room' })).toHaveClass('sr-only');
  await expect(host.page.getByRole('region', { name: 'Join a room' })).toHaveAttribute('data-testid', 'join-panel');
  expect((await host.page.getByRole('heading', { name: 'Join a room' }).boundingBox())?.height ?? 0, 'not shown on screen').toBeLessThanOrEqual(1);
  await expect(host.page.getByRole('heading', { name: 'Create a room' })).toHaveCount(0);
  await expect(host.page.getByText("Pick the game once you’re in.")).toHaveCount(0);
  await expect(host.page.locator('.home .card')).toHaveCount(0);
  await expect(host.page.locator('nav')).toHaveCount(0);
  await expect(host.page.getByTestId('game-card')).toHaveCount(0);
  await expect(host.page.getByRole('link')).toHaveCount(1); // the wordmark

  // Four separate boxes before anything is clicked, labelled, empty, with faint A/B/C/D placeholders.
  const group = host.page.getByRole('group', { name: 'Room code' });
  await expect(group).toBeVisible();
  for (const [i, letter] of ['A', 'B', 'C', 'D'].entries()) {
    const box = host.page.getByTestId(`code-input-${i}`);
    await expect(box).toBeVisible();
    await expect(box).toHaveValue('');
    await expect(box).toHaveAttribute('placeholder', letter);
    await expect(box).toHaveAttribute('aria-label', `Letter ${i + 1}`);
    await expect(box).toHaveAttribute('autocapitalize', 'characters');
    await expect(box).toHaveAttribute('autocomplete', 'off');
    await expect(box).toHaveAttribute('inputmode', 'text');
  }
  await expect(host.page.getByTestId('home-join')).toHaveText('Join');
  await expect(host.page.getByTestId('home-create')).toHaveText('Create a room');
  // Join is the lime primary with ink text; Create a room is outlined on the panel colour. Nothing glows.
  const style = (id: string) =>
    host.page.getByTestId(id).evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, shadow: s.boxShadow };
    });
  expect(await style('home-join')).toEqual({ bg: 'rgb(199, 233, 118)', color: 'rgb(20, 21, 20)', shadow: 'none' });
  expect(await style('home-create')).toEqual({ bg: 'rgb(32, 34, 31)', color: 'rgb(241, 240, 232)', shadow: 'none' });
  await expect(host.page.getByTestId('home-create')).toHaveCSS('border-top-color', 'rgb(116, 125, 111)');
  // Space Grotesk code boxes, Inter text, all self-hosted.
  await expect(host.page.locator('body')).toHaveCSS('font-family', /^Inter/);
  await expect(host.page.getByTestId('code-input-0')).toHaveCSS('font-family', /^"Space Grotesk"/);
  expect(await host.page.evaluate(() => document.fonts.check('700 16px "Space Grotesk"'))).toBe(true);

  // Join a room is compact: no empty band between the boxes and the button while there is no error.
  const lastBox = await host.page.getByTestId('code-input-3').boundingBox();
  const joinButton = await host.page.getByTestId('home-join').boundingBox();
  expect((joinButton?.y ?? 0) - ((lastBox?.y ?? 0) + (lastBox?.height ?? 0))).toBeLessThanOrEqual(25);
  await expect(host.page.getByTestId('room-preview')).toHaveAttribute('aria-live', 'polite');
});

test('typing uppercases and advances; Backspace and the arrow keys move between the boxes; nothing submits by itself', async () => {
  const page = guest.page;
  await page.goto('/');
  await page.getByTestId('code-input-0').click();
  await page.keyboard.type('ab', { delay: 20 });
  expect(await boxes(page)).toEqual(['A', 'B', '', '']);
  expect(await focusedBox(page)).toBe('code-input-2');

  await page.keyboard.press('Backspace'); // the empty third box: back to the second, which is cleared
  expect(await boxes(page)).toEqual(['A', '', '', '']);
  expect(await focusedBox(page)).toBe('code-input-1');
  await page.keyboard.press('ArrowLeft');
  expect(await focusedBox(page)).toBe('code-input-0');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await focusedBox(page)).toBe('code-input-2');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('c', { delay: 20 });
  expect(await boxes(page)).toEqual(['A', 'C', '', '']);

  // A complete code is not sent on its own: four characters typed, nothing happens until Join room or Enter.
  await page.getByTestId('code-input-0').click();
  await page.keyboard.type(unknownCode(), { delay: 20 });
  expect(await boxes(page)).toEqual(unknownCode().split(''));
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('name-step')).toHaveCount(0);
  await expect(page.getByTestId('join-error')).toHaveCount(0);
  await expect(page.getByTestId('home-join')).toBeEnabled();
});

test('an incomplete code and an excluded character show a field error with the code kept and the first invalid box focused', async () => {
  const page = guest.page;
  await page.goto('/');
  await page.getByTestId('code-input-0').click();
  await page.keyboard.type('ab', { delay: 20 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('code-hint')).toContainText('Enter all 4 characters');
  expect(await boxes(page)).toEqual(['A', 'B', '', '']);
  expect(await focusedBox(page)).toBe('code-input-2');
  await expect(page.getByTestId('code-input-0')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('room-preview')).toHaveAttribute('aria-live', 'polite');

  // The Join button says the same thing.
  await page.getByTestId('home-join').click();
  await expect(page.getByTestId('code-hint')).toContainText('Enter all 4 characters');
  await expect(page.getByTestId('name-step')).toHaveCount(0);

  // A letter the alphabet excludes (0, 1, I, L, O) is refused and explained; the rest stays.
  await page.getByTestId('code-input-2').click();
  await page.keyboard.type('0', { delay: 20 });
  await expect(page.getByTestId('code-hint')).toContainText(/never I, L or O/);
  expect(await boxes(page)).toEqual(['A', 'B', '', '']);
});

test('pasting a code, or a whole invite link, fills the four boxes', async () => {
  const page = guest.page;
  await page.goto('/');
  await paste(page, 'wx-5k');
  expect(await boxes(page)).toEqual(['W', 'X', '5', 'K']);
  expect(await focusedBox(page)).toBe('code-input-3');
  await expect(page.getByTestId('code-hint')).toHaveCount(0);

  // An invite link from before the rename ('skribble' is Scribble's pre-rename slug) pastes the same way.
  await paste(page, 'https://boredgames.io/skribble/ab2k');
  expect(await boxes(page)).toEqual(['A', 'B', '2', 'K']);
  await paste(page, `${page.url().replace(/\/$/, '')}/${unknownCode()}`);
  expect(await boxes(page)).toEqual(unknownCode().split(''));
});

test('create → "Who’s playing?" → the lobby, where picking a game comes first', async () => {
  await host.page.goto('/');
  await host.page.getByTestId('home-create').click();
  // A first visit asks for a name and a face before anything is sent.
  await expect(host.page.getByTestId('name-step')).toBeVisible();
  await expect(host.page.getByRole('heading', { name: "Who’s playing?" })).toBeVisible();
  await expect(host.page.getByTestId('room-code')).toHaveCount(0);
  await expect(host.page.getByTestId('avatar-picker')).toBeVisible();
  // Every one of the 50 faces and 12 colours is a 44px target (e2e/avatars.spec.ts covers the grid and the pictures).
  const tiles = await host.page.locator('.emoji-choice, .avatar-picker__group .swatch').evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
  expect(tiles).toHaveLength(62);
  expect(Math.min(...tiles)).toBeGreaterThanOrEqual(44);
  await expect(host.page.getByTestId('home-continue')).toHaveText('Continue');
  await host.page.getByTestId('home-continue').click();
  await expect(host.page.getByRole('alert')).toContainText(/pick a name/i);
  await host.page.getByTestId('home-name').fill(host.name);
  await host.page.getByTestId('home-continue').click();

  // A real room on the first live game, the picker at the top of the lobby, the host already able to switch.
  scribbleCode = (await host.page.getByTestId('room-code').textContent())?.replace(/\s+/g, '') ?? '';
  expect(scribbleCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  await expect(host.page).toHaveURL(new RegExp(`/scribble/${scribbleCode}$`));
  await expect(host.page).toHaveTitle(roomTabTitle(scribbleCode));
  await expect(host.page.getByTestId('site-header').getByRole('img', { name: 'boredgames.io' })).toBeVisible();
  const picker = host.page.getByTestId('game-picker');
  await expect(picker).toHaveAttribute('data-game', 'scribble');
  await expect(host.page.getByRole('heading', { name: 'Pick a game' })).toHaveCount(1);
  await expect(picker.locator('button[data-testid="game-tile"]')).toHaveCount(5);
  // The logo and the room bar come first, then the picker.
  await expect(host.page.locator('.lobby__top > section')).toHaveAttribute('data-testid', 'room-bar');
  await expect(host.page.getByTestId('room-bar').getByTestId('room-code')).toHaveText(scribbleCode);
  await expect(picker.locator('[data-testid="game-tile"][data-game="scribble"]')).toContainText('Scribble');
  await expect(picker.locator('[data-testid="game-tile"] svg[data-glyph]')).toHaveCount(5);
  expect(await (await host.page.request.get(`/api/rooms/${scribbleCode}`)).json()).toMatchObject({ exists: true, players: 1, gameId: 'scribble' });
  await expect(host.page.locator(`[data-testid="player-item"][data-name="${host.name}"]`)).toBeVisible();
  await expect(host.page.getByTestId('start-game')).toBeDisabled();

  // The name is remembered: the next create skips the step.
  await leaveLobby(host.page);
  await expect(host.page).toHaveURL(/\/$/);
  await expect(host.page.getByTestId('home-create')).toBeVisible();
  await host.page.getByTestId('home-create').click();
  await expect(host.page.getByTestId('name-step')).toHaveCount(0);
  // Settle on the room the server really seated the host in (the old seat is let go asynchronously).
  await expect
    .poll(async () => {
      const shown = (await host.page.getByTestId('room-code').textContent())?.replace(/\s+/g, '') ?? '';
      const preview = (await (await host.page.request.get(`/api/rooms/${shown}`)).json()) as { exists: boolean; players?: number };
      return preview.exists && preview.players === 1 ? shown : '';
    })
    .not.toBe('');
  scribbleCode = (await host.page.getByTestId('room-code').textContent())?.replace(/\s+/g, '') ?? '';
  await expect(host.page).toHaveURL(new RegExp(`/scribble/${scribbleCode}$`));
});

test('a second browser joins the real room by code; an unknown code is refused with the code kept and the first box focused', async () => {
  const page = guest.page;
  await page.goto('/');
  await page.getByTestId('code-input-0').click();
  await page.keyboard.type(unknownCode(), { delay: 20 });
  await page.keyboard.press('Enter');
  await enterNameIfAsked(page, guest.name);
  await expect(page.getByTestId('join-error')).toContainText(/couldn’t find a room/i);
  expect(await boxes(page)).toEqual(unknownCode().split(''));
  expect(await focusedBox(page)).toBe('code-input-0');
  await expect(page.getByTestId('home-join')).toBeEnabled();
  await expect(page.getByTestId('room-code')).toHaveCount(0);

  // Editing the code clears the error; the real code joins (the name is saved now, so no step).
  await page.getByTestId('code-input-0').click();
  await page.keyboard.type(scribbleCode, { delay: 20 });
  await expect(page.getByTestId('join-error')).toHaveCount(0);
  await expect(page.getByTestId('room-preview')).toContainText(/1 player in the party · Scribble/);
  await page.getByTestId('home-join').click();
  await expect(page.getByTestId('name-step')).toHaveCount(0);
  await expect(page.getByTestId('room-code')).toHaveText(scribbleCode);
  await expect(page).toHaveURL(new RegExp(`/scribble/${scribbleCode}$`));
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  await expect(page.getByTestId('game-picker-note')).toHaveText(`${host.name} picks the game`);
  // Copying the invite link is in the gear's menu, next to Leave room.
  await page.getByTestId('settings-menu').click();
  await expect(page.getByTestId('copy-link')).toBeVisible();
  await expect(page.getByTestId('leave-room')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-popover')).toHaveCount(0);
});

test('Back and the wordmark link leave the room and land on the front door', async () => {
  await guest.page.goBack();
  await expect(guest.page).toHaveURL(/\/$/);
  await expect(guest.page.getByTestId('join-panel')).toBeVisible();
  await expect(guest.page.getByTestId('room-code')).toHaveCount(0);
  await expect(host.page.getByTestId('player-item')).toHaveCount(1);

  await joinByLink(guest.page, guest.name, `/scribble/${scribbleCode}`, scribbleCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  await guest.page.getByTestId('brand-link').click();
  await expect(guest.page).toHaveURL(/\/$/);
  await expect(guest.page).toHaveTitle('boredgames.io');
  await expect(guest.page.getByTestId('create-panel')).toBeVisible();
  await expect(host.page.getByTestId('player-item')).toHaveCount(1);
  expect(await (await guest.page.request.get(`/api/rooms/${scribbleCode}`)).json()).toMatchObject({ exists: true, players: 1 });
});

test('deep links fill the boxes and focus Join room; the old per-game pages and unknown pages come home', async () => {
  // '/:slug/:CODE' (the invite link)
  await phone.page.goto(`/scribble/${scribbleCode}`);
  expect(await boxes(phone.page)).toEqual(scribbleCode.split(''));
  await expect(phone.page.getByTestId('home-join')).toBeFocused();
  // An invite from before the rename ('skribble' is Scribble's pre-rename slug) still works: the address bar is rewritten in place.
  await phone.page.goto(`/skribble/${scribbleCode}`);
  await expect(phone.page).toHaveURL(new RegExp(`/scribble/${scribbleCode}$`));
  expect(await boxes(phone.page)).toEqual(scribbleCode.split(''));
  await expect(phone.page.getByTestId('home-join')).toBeFocused();
  await expect(phone.page.getByTestId('room-code')).toHaveCount(0);
  // the slug is informational: a link for another game of the same room fills the same boxes
  await phone.page.goto(`/spygame/${scribbleCode}`);
  expect(await boxes(phone.page)).toEqual(scribbleCode.split(''));
  // legacy '/:CODE' and '/?room='
  await phone.page.goto(`/${scribbleCode.toLowerCase()}`);
  expect(await boxes(phone.page)).toEqual(scribbleCode.split(''));
  await expect(phone.page.getByTestId('home-join')).toBeFocused();
  await phone.page.goto(`/?room=${scribbleCode}`);
  expect(await boxes(phone.page)).toEqual(scribbleCode.split(''));

  // '/:slug' redirects to '/', with empty boxes and both panels.
  await phone.page.goto('/scribble');
  await expect(phone.page).toHaveURL(/\/$/);
  // Scribble's pre-rename slug too.
  await phone.page.goto('/skribble');
  await expect(phone.page).toHaveURL(/\/$/);
  await expect(phone.page.getByTestId('create-panel')).toBeVisible();
  expect(await boxes(phone.page)).toEqual(['', '', '', '']);
  await phone.page.goto('/quipgame');
  await expect(phone.page).toHaveURL(/\/$/);

  // An unknown page falls back to the front door with a note.
  await phone.page.goto('/no-such-page');
  await expect(phone.page.getByTestId('toast')).toContainText(/does not exist/i);
  await expect(phone.page).toHaveURL(/\/$/);
  await expect(phone.page.getByTestId('join-panel')).toBeVisible();
  // So do the pages of games the site no longer has, with or without a room code (never read as the code 'HANG').
  for (const path of ['/hangman', `/battleships/${scribbleCode}`]) {
    await phone.page.goto(path);
    await expect(phone.page.getByTestId('toast')).toContainText(/does not exist/i);
    await expect(phone.page).toHaveURL(/\/$/);
    expect(await boxes(phone.page)).toEqual(['', '', '', '']);
  }

  // Enter on a filled deep link joins (the phone has no saved name yet: the step shows).
  await joinByLink(phone.page, phone.name, `/${scribbleCode}`, scribbleCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  await leaveLobby(phone.page);
  await expect(phone.page).toHaveURL(/\/$/);
  await expect(host.page.getByTestId('player-item')).toHaveCount(1);
});

test('the hidden template game plays a whole Click Race between two players', async () => {
  await leaveLobby(host.page);
  const code = await createParty(host.page, host.name, 'template');
  await expect(host.page.getByTestId('game-picker')).toHaveAttribute('data-game', 'template');
  // The template game can be played alone, so the host may start right away; wait for the guest anyway.
  await expect(host.page.getByTestId('start-game')).toBeEnabled();

  await joinByLink(guest.page, guest.name, `/template/${code}`, code);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);

  // Platform fields first, then the game's own rows; only the host sees and edits them.
  await host.page.getByTestId('settings-targetClicks').fill('10');
  await expect(host.page.getByTestId('settings-value-targetClicks')).toHaveText('10');
  await expect(host.page.getByTestId('settings-value-timeLimit')).toHaveText('30s');
  await expect(host.page.getByTestId('settings-maxPlayers')).toHaveCount(0);
  // Click Race never reads the content mode, so the lobby does not offer it.
  await expect(host.page.getByTestId('settings-contentMode')).toHaveCount(0);
  await expect(guest.page.getByTestId('settings-panel')).toHaveCount(0);

  await readyAll([guest.page]);
  await host.page.getByTestId('start-game').click();
  for (const p of [host, guest]) {
    await expect(p.page.getByTestId('click-button')).toBeVisible();
    await expect(p.page.getByTestId('race-row')).toHaveCount(2);
    await expect(p.page.getByTestId('timer')).toBeVisible();
  }

  // The top bar: a chip per player and a timer ring whose arc starts whole.
  await expect(host.page.getByTestId('player-chip')).toHaveCount(2);
  await expect(host.page.getByTestId('timer').locator('.timer__arc')).toHaveAttribute('stroke-dashoffset', /^[0-9.]+$/);
  // The back arrow asks before leaving; Stay keeps the player in the game.
  await guest.page.getByTestId('game-back').click();
  await expect(guest.page.getByTestId('game-leave-confirm')).toBeVisible();
  await guest.page.getByTestId('game-leave-no').click();
  await expect(guest.page.getByTestId('leave-sheet')).toHaveCount(0);
  await expect(guest.page.getByTestId('click-button')).toBeVisible();

  // A few guest taps, then the host races to the target and wins.
  for (let i = 0; i < 3; i++) await guest.page.getByTestId('click-button').click();
  await expect(host.page.locator('[data-testid="race-row"][data-name="Gus"]')).toHaveAttribute('data-clicks', '3');
  for (let i = 0; i < 10; i++) await host.page.getByTestId('click-button').click();

  // The race is over: both are back in the lobby (scores reset there) with the results over it.
  for (const p of [host, guest]) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible();
    await expect(end).toContainText(`${host.name} wins!`);
    await expect(end.getByTestId('results-entry')).toHaveCount(2);
    await expect(end.locator('[data-testid="results-entry"][data-rank="1"]')).toContainText('100 pts');
    await expect(end.locator('[data-testid="results-entry"][data-rank="2"]')).toContainText('3 pts');
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    expect(await scoreOf(p.page, host.name)).toBe(0);
    expect(await scoreOf(p.page, guest.name)).toBe(0);
  }
  for (const id of ['back-to-lobby', 'podium-leave', 'play-again']) await expect(guest.page.getByTestId(id)).toHaveCount(0);
  await expect(host.page.getByTestId('overlay-game-end')).toContainText('You won!');
  await expect(guest.page.getByTestId('overlay-game-end')).toContainText('You came 2nd');

  // The results are a modal dialog: they take the focus and keep Tab inside, away from the lobby under them.
  await expect(host.page.getByTestId('overlay-game-end')).toHaveAttribute('aria-modal', 'true');
  const focusInside = () => host.page.evaluate(() => document.activeElement?.closest('[data-testid="overlay-game-end"]') instanceof HTMLElement);
  await expect.poll(focusInside).toBe(true);
  for (let i = 0; i < 4; i++) {
    await host.page.keyboard.press('Tab');
    expect(await focusInside(), `Tab ${i + 1} stays in the results`).toBe(true);
  }

  for (const p of [host, guest]) await closeResults(p.page);
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
  for (const p of [host, guest]) await leaveLobby(p.page);
});

test('the settings menu switches to the light theme and the choice survives a reload; dark is the default', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const pageColor = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const panelColor = () => page.getByTestId('home-create').evaluate((el) => getComputedStyle(el).backgroundColor);
  const games = page.getByTestId('site-header').locator('.wordmark__accent');
  const outline = page.getByTestId('site-header').locator('.wordmark__accent-outline');
  expect(await pageColor()).toBe('rgb(20, 21, 20)');
  expect(await panelColor()).toBe('rgb(32, 34, 31)');
  // "games" in the wordmark is the lime on dark and a cut of it on light, never outlined.
  await expect(games).toHaveCSS('color', 'rgb(199, 233, 118)');
  await expect(outline).toHaveCount(0);

  await page.getByTestId('settings-menu').click();
  await expect(page.getByTestId('settings-popover')).toBeVisible();
  await expect(page.getByTestId('theme-dark')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('theme-light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await pageColor()).toBe('rgb(245, 246, 239)');
  await expect.poll(panelColor).toBe('rgb(255, 255, 255)');
  await expect(page.getByTestId('home-join')).toHaveCSS('background-color', 'rgb(199, 233, 118)');
  await expect(games).toHaveCSS('color', 'rgb(199, 233, 118)');
  // Escape closes the menu and gives the focus back to the gear.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-popover')).toHaveCount(0);
  await expect(page.getByTestId('settings-menu')).toBeFocused();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('settings-menu').click();
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // A tap outside closes it.
  await page.getByTestId('join-panel').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('settings-popover')).toHaveCount(0);
  await context.close();
});

for (const width of [320, 390, 700, 768, 1024, 1440]) {
  test(`at ${width}px nothing overflows, the buttons are 48px and the boxes 64 to 112px tall, in one centred column`, async ({ browser }) => {
    const height = width >= 1024 ? 900 : width >= 768 ? 1024 : 844;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByTestId('home-create')).toBeVisible();
    await expect(page.getByTestId('connection-notice')).toHaveCount(0);
    await noHorizontalOverflow(page, width);
    for (const id of ['home-join', 'home-create']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box?.height ?? 0, `${id} is at least ${MIN_BUTTON}px tall`).toBeGreaterThanOrEqual(MIN_BUTTON);
      expect((box?.x ?? 0) + (box?.width ?? 0), `${id} fits the viewport`).toBeLessThanOrEqual(width + 0.5);
    }
    let right = 0;
    for (let i = 0; i < 4; i++) {
      const box = await page.getByTestId(`code-input-${i}`).boundingBox();
      expect(box?.height ?? 0, `box ${i} height`).toBeGreaterThanOrEqual(64);
      expect(box?.height ?? 0, `box ${i} height`).toBeLessThanOrEqual(112);
      expect(box?.y ?? -1, 'the four boxes share one row').toBe((await page.getByTestId('code-input-0').boundingBox())?.y ?? -2);
      right = Math.max(right, (box?.x ?? 0) + (box?.width ?? 0));
    }
    expect(right).toBeLessThanOrEqual(width + 0.5);
    const headerButton = await page.getByTestId('settings-menu').boundingBox();
    expect((headerButton?.x ?? 0) + (headerButton?.width ?? 0)).toBeLessThanOrEqual(width + 0.5);

    // Every width: one centred column at most 460px wide, Join and then Create a room right under it, full width.
    const join = await page.getByTestId('join-panel').boundingBox();
    const joinBtn = await page.getByTestId('home-join').boundingBox();
    const createBtn = await page.getByTestId('home-create').boundingBox();
    expect(joinBtn?.width ?? 0).toBeLessThanOrEqual(460.5);
    expect(Math.abs((joinBtn?.x ?? 0) + (joinBtn?.width ?? 0) / 2 - width / 2), 'the column is centred').toBeLessThanOrEqual(1);
    // No visible heading over the boxes: the logo, then the boxes straight away.
    expect((await page.locator('#join-heading').boundingBox())?.height ?? 0).toBeLessThanOrEqual(1);
    expect(createBtn?.x).toBe(joinBtn?.x);
    expect(createBtn?.width).toBe(joinBtn?.width);
    const gap = (createBtn?.y ?? 0) - ((joinBtn?.y ?? 0) + (joinBtn?.height ?? 0));
    expect(gap, 'Create a room sits right under Join').toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(16);
    // The logo (the phones, then the text) fills the column, above Join a room. From 1024px it is
    // bigger than the column (two fifths of the screen, at most 600px) and centred over it.
    const mark = await page.getByTestId('site-header').getByTestId('wordmark').boundingBox();
    if (width >= 1024) {
      expect(Math.abs((mark?.width ?? 0) - Math.min(width * 0.4, 600)), 'the logo is two fifths of the screen').toBeLessThanOrEqual(1);
      expect(mark?.width ?? 0, 'and wider than the column').toBeGreaterThan((joinBtn?.width ?? 0) + 40);
      expect(Math.abs((mark?.x ?? 0) + (mark?.width ?? 0) / 2 - width / 2), 'centred over the column').toBeLessThanOrEqual(1);
    } else {
      expect(Math.abs((mark?.width ?? 0) - (joinBtn?.width ?? 0))).toBeLessThanOrEqual(1);
    }
    const icon = await page.getByTestId('site-header').locator('.wordmark__icon').boundingBox();
    expect(icon?.x ?? -1, 'the icon starts the logo').toBeLessThanOrEqual((mark?.x ?? 0) + (mark?.width ?? 0) * 0.05);
    expect((icon?.x ?? 0) + (icon?.width ?? 0), 'and stays left of the text').toBeLessThanOrEqual((mark?.x ?? 0) + (mark?.width ?? 0) * 0.2);
    // The icon is centred on "bored", from the top of the "b" to the baseline, a little taller with
    // its outlines and shadows, and does not hang down with the "g" of "games".
    const letters = await page.getByTestId('site-header').locator('[data-testid="wordmark"] > path').first().boundingBox();
    const games = await page.getByTestId('site-header').locator('.wordmark__accent').boundingBox();
    const centre = (box: typeof icon) => (box?.y ?? 0) + (box?.height ?? 0) / 2;
    expect(icon?.height ?? 0, 'at least as tall as "bored"').toBeGreaterThanOrEqual(letters?.height ?? Infinity);
    expect(icon?.height ?? 0, 'but not much taller').toBeLessThanOrEqual((letters?.height ?? 0) * 1.35);
    expect(Math.abs(centre(icon) - centre(letters)), 'centred on "bored"').toBeLessThanOrEqual((mark?.height ?? 0) * 0.03);
    expect((icon?.y ?? 0) + (icon?.height ?? 0), 'well above the bottom of the "g"').toBeLessThanOrEqual((games?.y ?? 0) + (games?.height ?? 0) - (mark?.height ?? 0) * 0.1);
    expect((mark?.y ?? 0) + (mark?.height ?? 0), 'the logo stays above Join a room').toBeLessThanOrEqual(join?.y ?? 0);
    // As much air between the logo and the boxes as the column's rhythm allows: clearly apart, never a gap the page falls into.
    const firstBox = await page.getByTestId('code-input-0').boundingBox();
    const air = (firstBox?.y ?? 0) - ((mark?.y ?? 0) + (mark?.height ?? 0));
    expect(air, 'the logo and the boxes stand apart').toBeGreaterThanOrEqual(24);
    expect(air).toBeLessThanOrEqual(72);
    // The column sits in the middle of the page, top to bottom, on every screen.
    const top = (await page.getByTestId('site-header').boundingBox())?.y ?? 0;
    const below = height - ((createBtn?.y ?? 0) + (createBtn?.height ?? 0));
    expect(top, 'the column is pushed down from the top').toBeGreaterThanOrEqual(100);
    if (width >= 768) {
      expect(Math.abs(top - below), 'as much room above the column as below it').toBeLessThanOrEqual(24);
    }
    if (width < 768) {
      expect((createBtn?.y ?? 0) + (createBtn?.height ?? 0), 'Create a room sits inside the first screen').toBeLessThanOrEqual(height);
      // A phone keeps it a little above the middle, so the boxes and buttons read as centred.
      expect(below - top, 'a little more room below the column than above it').toBeGreaterThanOrEqual(0);
      expect(below - top).toBeLessThanOrEqual(height * 0.12);
    }

    // The name step fits too.
    await page.getByTestId('home-create').click();
    await expect(page.getByTestId('name-step')).toBeVisible();
    await noHorizontalOverflow(page, width);
    const nameBox = await page.getByTestId('home-name').boundingBox();
    expect(nameBox?.height ?? 0).toBeGreaterThanOrEqual(MIN_BUTTON);
    await context.close();
  });
}

test('a create or join the server never answers is reported where the user is: under the name step, then on the boxes with Join focused', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // The socket link is cut before it reaches the server: the client keeps reconnecting, every request times out as OFFLINE.
  await page.routeWebSocket(/\/ws$/, (route) => route.close({ code: 1006, reason: 'cut' }));
  await page.goto('/');
  // While the socket stays down the one connection notice says so, at the top of the page and never beside the logo.
  await expect(page.getByTestId('connection-notice')).toHaveAttribute('data-status', /connecting|reconnecting/);
  await expect(page.getByTestId('site-header').getByTestId('connection-notice')).toHaveCount(0);

  // Create: a first visit goes through "Who's playing?"; the failure must show there, not only after Back.
  await page.getByTestId('home-create').click();
  await expect(page.getByTestId('name-step')).toBeVisible();
  await page.getByTestId('home-name').fill('Olga');
  await page.getByTestId('home-continue').click();
  await expect(page.getByTestId('home-continue')).toContainText(/Waiting for connection/);
  await expect(page.getByTestId('create-error')).toContainText(/can’t reach the server/i, { timeout: 15_000 });
  await expect(page.getByTestId('name-step')).toBeVisible();
  await expect(page.getByTestId('home-continue')).toBeEnabled();
  await expect(page.getByTestId('home-continue')).toHaveText('Continue');
  await expect(page.getByTestId('home-name')).toHaveValue('Olga');
  await expect(page.getByRole('alert')).toHaveCount(1);

  // Join from the name step: back to the boxes with the code kept and the focus on Join room (never on <body>).
  await page.getByTestId('home-back').click();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('code-input-0').click();
  await page.keyboard.type(unknownCode(), { delay: 20 });
  await page.getByTestId('home-join').click();
  await expect(page.getByTestId('name-step')).toBeVisible();
  await page.getByTestId('home-name').fill('Olga');
  await page.getByTestId('home-continue').click();
  await expect(page.getByTestId('join-error')).toContainText(/can’t reach the server/i, { timeout: 15_000 });
  await expect(page.getByTestId('room-preview')).toHaveAttribute('aria-live', 'polite');
  expect(await boxes(page)).toEqual(unknownCode().split(''));
  await expect(page.getByTestId('home-join')).toBeEnabled();
  await expect(page.getByTestId('home-join')).toBeFocused();
  await context.close();
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
