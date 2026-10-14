import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createParty, enterNameIfAsked, joinByLink, readyAll } from './party';

/**
 * The front door and the routing around it: two action panels and nothing else, the four code
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
let skribbleCode = '';

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
  return skribbleCode === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
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
  await expect(host.page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
  await expect(host.page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // The wordmark is outlined vector art with an accessible name, never live text or a controller icon.
  const header = host.page.getByTestId('site-header');
  await expect(header.getByRole('img', { name: 'boredgames.io' })).toBeVisible();
  await expect(header.locator('svg[data-testid="wordmark"] path')).toHaveCount(2);
  await expect(header.locator('svg[data-testid="wordmark"] text')).toHaveCount(0);
  await expect(header.locator('.brand__mark')).toHaveCount(0);
  await expect(header.getByTestId('theme-toggle')).toBeVisible();

  await expect(host.page.getByRole('heading', { level: 1 })).toHaveText('Less bored.More games.');
  await expect(host.page.getByText('Get your people together. A room code is all it takes.')).toBeVisible();

  // Two panels, in order: Join then Create. Nothing else to click on the page.
  const panels = host.page.locator('.home__panels > section');
  await expect(panels).toHaveCount(2);
  await expect(panels.nth(0)).toHaveAttribute('data-testid', 'join-panel');
  await expect(panels.nth(1)).toHaveAttribute('data-testid', 'create-panel');
  await expect(host.page.getByRole('heading', { name: 'Join a room' })).toBeVisible();
  await expect(host.page.getByRole('heading', { name: 'Create a room' })).toBeVisible();
  await expect(host.page.getByText('Start something. Send the code.')).toBeVisible();
  await expect(host.page.locator('nav')).toHaveCount(0);
  await expect(host.page.getByTestId('game-card')).toHaveCount(0);
  await expect(host.page.getByRole('link')).toHaveCount(1); // the wordmark
  await expect(host.page.getByText('Made for one more round.')).toBeVisible();

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
  await expect(host.page.getByTestId('home-join')).toHaveText('Join room');
  await expect(host.page.getByTestId('home-create')).toHaveText('Create room');
  // The lime primary carries ink text; the one glowing thing on the page is the button itself.
  const createStyle = await host.page.getByTestId('home-create').evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color, shadow: s.boxShadow };
  });
  expect(createStyle).toEqual({ bg: 'rgb(199, 233, 118)', color: 'rgb(20, 21, 20)', shadow: 'none' });
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
  await expect(host.page.getByRole('heading', { name: "Who's playing?" })).toBeVisible();
  await expect(host.page.getByTestId('room-code')).toHaveCount(0);
  await expect(host.page.getByTestId('avatar-picker')).toBeVisible();
  await expect(host.page.getByTestId('home-continue')).toHaveText('Create room');
  await host.page.getByTestId('home-continue').click();
  await expect(host.page.getByRole('alert')).toContainText(/pick a name/i);
  await host.page.getByTestId('home-name').fill(host.name);
  await host.page.getByTestId('home-continue').click();

  // A real room on the first live game, the picker at the top of the lobby, the host already able to switch.
  skribbleCode = (await host.page.getByTestId('room-code').textContent())?.replace(/\s+/g, '') ?? '';
  expect(skribbleCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  await expect(host.page).toHaveURL(new RegExp(`/skribble/${skribbleCode}$`));
  await expect(host.page).toHaveTitle(`boredgames.io · ${skribbleCode}`);
  await expect(host.page.getByTestId('site-header').getByRole('img', { name: 'boredgames.io' })).toBeVisible();
  const picker = host.page.getByTestId('game-picker');
  await expect(picker).toHaveAttribute('data-game', 'skribble');
  await expect(host.page.getByRole('heading', { name: 'Pick a game' })).toBeVisible();
  await expect(picker.locator('button[data-testid="game-tile"]')).toHaveCount(3);
  await expect(host.page.locator('.lobby > section').first()).toHaveAttribute('data-testid', 'game-picker');
  expect(await (await host.page.request.get(`/api/rooms/${skribbleCode}`)).json()).toMatchObject({ exists: true, players: 1, gameId: 'skribble' });
  await expect(host.page.locator(`[data-testid="player-item"][data-name="${host.name}"]`)).toBeVisible();
  await expect(host.page.getByTestId('start-game')).toBeDisabled();

  // The name is remembered: the next create skips the step.
  await host.page.getByTestId('leave-room').click();
  await expect(host.page).toHaveURL(/\/$/);
  await expect(host.page.getByTestId('home-create')).toBeVisible();
  await host.page.getByTestId('home-create').click();
  await expect(host.page.getByTestId('name-step')).toHaveCount(0);
  skribbleCode = (await host.page.getByTestId('room-code').textContent())?.replace(/\s+/g, '') ?? '';
  await expect(host.page).toHaveURL(new RegExp(`/skribble/${skribbleCode}$`));
});

test('a second browser joins the real room by code; an unknown code is refused with the code kept and the first box focused', async () => {
  const page = guest.page;
  await page.goto('/');
  await page.getByTestId('code-input-0').click();
  await page.keyboard.type(unknownCode(), { delay: 20 });
  await page.keyboard.press('Enter');
  await enterNameIfAsked(page, guest.name);
  await expect(page.getByTestId('join-error')).toContainText(/couldn't find a room/i);
  expect(await boxes(page)).toEqual(unknownCode().split(''));
  expect(await focusedBox(page)).toBe('code-input-0');
  await expect(page.getByTestId('home-join')).toBeEnabled();
  await expect(page.getByTestId('room-code')).toHaveCount(0);

  // Editing the code clears the error; the real code joins (the name is saved now, so no step).
  await page.getByTestId('code-input-0').click();
  await page.keyboard.type(skribbleCode, { delay: 20 });
  await expect(page.getByTestId('join-error')).toHaveCount(0);
  await expect(page.getByTestId('room-preview')).toContainText(/1 player in the party · Skribble/);
  await page.getByTestId('home-join').click();
  await expect(page.getByTestId('name-step')).toHaveCount(0);
  await expect(page.getByTestId('room-code')).toHaveText(skribbleCode);
  await expect(page).toHaveURL(new RegExp(`/skribble/${skribbleCode}$`));
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  await expect(page.getByTestId('game-picker-note')).toHaveText(`${host.name} picks the game`);
  await expect(page.getByTestId('copy-link')).toBeVisible();
});

test('Back and the wordmark link leave the room and land on the front door', async () => {
  await guest.page.goBack();
  await expect(guest.page).toHaveURL(/\/$/);
  await expect(guest.page.getByTestId('join-panel')).toBeVisible();
  await expect(guest.page.getByTestId('room-code')).toHaveCount(0);
  await expect(host.page.getByTestId('player-item')).toHaveCount(1);

  await joinByLink(guest.page, guest.name, `/skribble/${skribbleCode}`, skribbleCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  await guest.page.getByTestId('brand-link').click();
  await expect(guest.page).toHaveURL(/\/$/);
  await expect(guest.page).toHaveTitle('boredgames.io');
  await expect(guest.page.getByTestId('create-panel')).toBeVisible();
  await expect(host.page.getByTestId('player-item')).toHaveCount(1);
  expect(await (await guest.page.request.get(`/api/rooms/${skribbleCode}`)).json()).toMatchObject({ exists: true, players: 1 });
});

test('deep links fill the boxes and focus Join room; the old per-game pages and unknown pages come home', async () => {
  // '/:slug/:CODE' (the invite link)
  await phone.page.goto(`/skribble/${skribbleCode}`);
  expect(await boxes(phone.page)).toEqual(skribbleCode.split(''));
  await expect(phone.page.getByTestId('home-join')).toBeFocused();
  await expect(phone.page.getByTestId('room-code')).toHaveCount(0);
  // the slug is informational: a link for another game of the same room fills the same boxes
  await phone.page.goto(`/spygame/${skribbleCode}`);
  expect(await boxes(phone.page)).toEqual(skribbleCode.split(''));
  // legacy '/:CODE' and '/?room='
  await phone.page.goto(`/${skribbleCode.toLowerCase()}`);
  expect(await boxes(phone.page)).toEqual(skribbleCode.split(''));
  await expect(phone.page.getByTestId('home-join')).toBeFocused();
  await phone.page.goto(`/?room=${skribbleCode}`);
  expect(await boxes(phone.page)).toEqual(skribbleCode.split(''));

  // '/:slug' redirects to '/', with empty boxes and both panels.
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

  // Enter on a filled deep link joins (the phone has no saved name yet: the step shows).
  await joinByLink(phone.page, phone.name, `/${skribbleCode}`, skribbleCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  await phone.page.getByTestId('leave-room').click();
  await expect(phone.page).toHaveURL(/\/$/);
  await expect(host.page.getByTestId('player-item')).toHaveCount(1);
});

test('the hidden template game plays a whole Click Race between two players', async () => {
  await host.page.getByTestId('leave-room').click();
  const code = await createParty(host.page, host.name, 'template');
  await expect(host.page.getByTestId('game-picker')).toHaveAttribute('data-game', 'template');
  // The template game can be played alone, so the host may start right away; wait for the guest anyway.
  await expect(host.page.getByTestId('start-game')).toBeEnabled();

  await joinByLink(guest.page, guest.name, `/template/${code}`, code);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);

  // Platform fields first, then the game's own rows; only the host edits.
  await host.page.getByTestId('settings-targetClicks').fill('10');
  await expect(guest.page.getByTestId('settings-value-targetClicks')).toHaveText('10');
  await expect(guest.page.getByTestId('settings-targetClicks')).toHaveCount(0);
  await expect(guest.page.getByTestId('settings-value-timeLimit')).toHaveText('30s');
  await expect(guest.page.getByTestId('settings-allowMidGameJoin')).toBeDisabled();
  await expect(guest.page.getByTestId('settings-maxPlayers')).toHaveCount(0);
  await expect(guest.page.getByTestId('content-mode-family')).toBeDisabled();

  await readyAll([guest.page]);
  await host.page.getByTestId('start-game').click();
  for (const p of [host, guest]) {
    await expect(p.page.getByTestId('click-button')).toBeVisible();
    await expect(p.page.getByTestId('race-row')).toHaveCount(2);
    await expect(p.page.getByTestId('timer')).toBeVisible();
  }
  await expect(host.page.getByTestId('chat-log')).toContainText('The game has started!');

  // A few guest taps, then the host races to the target and wins.
  for (let i = 0; i < 3; i++) await guest.page.getByTestId('click-button').click();
  await expect(host.page.locator('[data-testid="race-row"][data-name="Gus"]')).toHaveAttribute('data-clicks', '3');
  for (let i = 0; i < 10; i++) await host.page.getByTestId('click-button').click();

  for (const p of [host, guest]) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible();
    await expect(end).toContainText(`${host.name} wins!`);
    await expect(end.getByTestId('podium-entry')).toHaveCount(2);
    await expect(end.locator('[data-testid="podium-entry"][data-rank="1"]')).toContainText('100 pts');
    await expect(end.locator('[data-testid="podium-entry"][data-rank="2"]')).toContainText('3 pts');
  }
  await expect(guest.page.getByTestId('back-to-lobby')).toHaveCount(0);
  await expect(guest.page.getByTestId('podium-leave')).toHaveCount(0);
  await expect(guest.page.getByTestId('overlay-game-end').getByTestId('ready-toggle')).toBeVisible();
  await expect(host.page.getByTestId('overlay-game-end')).toContainText('You won!');
  await expect(guest.page.getByTestId('overlay-game-end')).toContainText('You came 2nd');

  // The podium is a modal dialog: it takes the focus and keeps Tab inside, away from the game screen under it.
  await expect(host.page.getByTestId('overlay-game-end')).toHaveAttribute('aria-modal', 'true');
  const focusInside = () => host.page.evaluate(() => document.activeElement?.closest('[data-testid="overlay-game-end"]') instanceof HTMLElement);
  await expect.poll(focusInside).toBe(true);
  for (let i = 0; i < 4; i++) {
    await host.page.keyboard.press('Tab');
    expect(await focusInside(), `Tab ${i + 1} stays in the podium`).toBe(true);
  }

  await host.page.getByTestId('back-to-lobby').click();
  for (const p of [host, guest]) {
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    expect(await scoreOf(p.page, host.name)).toBe(0);
    expect(await scoreOf(p.page, guest.name)).toBe(0);
  }
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
  for (const p of [host, guest]) await p.page.getByTestId('leave-room').click();
});

test('the theme toggle switches to the light variant and the choice survives a reload; dark is the default', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const pageColor = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const panelColor = () => page.getByTestId('join-panel').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await pageColor()).toBe('rgb(20, 21, 20)');
  expect(await panelColor()).toBe('rgb(32, 34, 31)');
  expect(await page.evaluate(() => getComputedStyle(document.body, '::before').content)).toBe('none');
  // "More games." is the brand lilac itself on dark (#A699D5), the darker cut only on off-white.
  const accent = page.locator('.hero__accent');
  await expect(accent).toHaveCSS('color', 'rgb(166, 153, 213)');

  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await pageColor()).toBe('rgb(241, 240, 232)');
  expect(await panelColor()).toBe('rgb(255, 255, 255)');
  await expect(page.getByTestId('home-create')).toHaveCSS('background-color', 'rgb(199, 233, 118)');
  await expect(accent).toHaveCSS('color', 'rgb(90, 74, 156)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await context.close();
});

for (const width of [320, 390, 700, 768, 1440]) {
  test(`at ${width}px nothing overflows, the buttons are 48px and the boxes 56–64px tall`, async ({ browser }) => {
    const height = width >= 1024 ? 900 : width >= 768 ? 1024 : 844;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
    await noHorizontalOverflow(page, width);
    for (const id of ['home-join', 'home-create']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box?.height ?? 0, `${id} is at least ${MIN_BUTTON}px tall`).toBeGreaterThanOrEqual(MIN_BUTTON);
      expect((box?.x ?? 0) + (box?.width ?? 0), `${id} fits the viewport`).toBeLessThanOrEqual(width + 0.5);
    }
    let right = 0;
    for (let i = 0; i < 4; i++) {
      const box = await page.getByTestId(`code-input-${i}`).boundingBox();
      expect(box?.height ?? 0, `box ${i} height`).toBeGreaterThanOrEqual(56);
      expect(box?.height ?? 0, `box ${i} height`).toBeLessThanOrEqual(64);
      expect(box?.y ?? -1, 'the four boxes share one row').toBe((await page.getByTestId('code-input-0').boundingBox())?.y ?? -2);
      right = Math.max(right, (box?.x ?? 0) + (box?.width ?? 0));
    }
    expect(right).toBeLessThanOrEqual(width + 0.5);
    const headerButton = await page.locator('.site-header__actions button').last().boundingBox();
    expect((headerButton?.x ?? 0) + (headerButton?.width ?? 0)).toBeLessThanOrEqual(width + 0.5);

    // Desktop: the two panels side by side with their buttons on one baseline; phones: Join above Create.
    const join = await page.getByTestId('join-panel').boundingBox();
    const create = await page.getByTestId('create-panel').boundingBox();
    const joinBtn = await page.getByTestId('home-join').boundingBox();
    const createBtn = await page.getByTestId('home-create').boundingBox();
    if (width >= 768) {
      expect(join?.y).toBe(create?.y);
      expect(Math.abs((joinBtn?.y ?? 0) + (joinBtn?.height ?? 0) - ((createBtn?.y ?? 0) + (createBtn?.height ?? 0)))).toBeLessThanOrEqual(1);
      expect(Math.abs((join?.width ?? 0) - (create?.width ?? 0))).toBeLessThanOrEqual(1);
    } else {
      expect(join?.x).toBe(create?.x);
      expect((join?.y ?? 0) + (join?.height ?? 0)).toBeLessThanOrEqual(create?.y ?? 0);
    }
    // The mascots show only while the hero is two-column; single-column (large phones, small tablets in
    // portrait included) they would take a row of their own and push Create below the fold.
    await expect(page.locator('.hero__mascots')).toBeVisible({ visible: width >= 768 });
    if (width < 768) {
      expect((createBtn?.y ?? 0) + (createBtn?.height ?? 0), 'Create room sits inside the first screen').toBeLessThanOrEqual(height);
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
  await expect(page.getByTestId('connection-status')).not.toHaveAttribute('data-status', 'connected');

  // Create: a first visit goes through "Who's playing?"; the failure must show there, not only after Back.
  await page.getByTestId('home-create').click();
  await expect(page.getByTestId('name-step')).toBeVisible();
  await page.getByTestId('home-name').fill('Olga');
  await page.getByTestId('home-continue').click();
  await expect(page.getByTestId('home-continue')).toContainText(/Waiting for connection/);
  await expect(page.getByTestId('create-error')).toContainText(/can't reach the server/i, { timeout: 15_000 });
  await expect(page.getByTestId('name-step')).toBeVisible();
  await expect(page.getByTestId('home-continue')).toBeEnabled();
  await expect(page.getByTestId('home-continue')).toHaveText('Create room');
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
  await expect(page.getByTestId('join-error')).toContainText(/can't reach the server/i, { timeout: 15_000 });
  await expect(page.getByTestId('room-preview')).toHaveAttribute('aria-live', 'polite');
  expect(await boxes(page)).toEqual(unknownCode().split(''));
  await expect(page.getByTestId('home-join')).toBeEnabled();
  await expect(page.getByTestId('home-join')).toBeFocused();
  await context.close();
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
