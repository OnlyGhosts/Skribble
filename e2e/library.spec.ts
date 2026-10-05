import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * The library and the routing around it: the game cards, joining by code from the front page,
 * legacy bare-code links, and a whole Click Race (the hidden template game) between two players.
 */
test.describe.configure({ mode: 'serial' });

const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const PORTRAIT = { width: 390, height: 844 };
const MIN_TARGET = 44;

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

async function readCode(page: Page): Promise<string> {
  const code = ((await page.getByTestId('room-code').textContent()) ?? '').replace(/\s+/g, '');
  expect(code).toMatch(ROOM_CODE_RE);
  return code;
}

async function scoreOf(page: Page, name: string): Promise<number> {
  const raw = await page.locator(`[data-testid="player-item"][data-name="${name}"]`).getAttribute('data-score');
  return Number(raw ?? 'NaN');
}

async function noHorizontalOverflow(page: Page, width: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  guest = await newPlayer(browser, 'Gus');
  phone = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the library shows the live Skribble card and hides the template game', async () => {
  await host.page.goto('/');
  await expect(host.page).toHaveTitle('Bored Games');
  await expect(host.page.getByTestId('site-header')).toContainText('Bored Games');
  const cards = host.page.getByTestId('game-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute('data-game', 'skribble');
  await expect(cards.first()).toContainText('Skribble');
  await expect(cards.first()).toContainText('2-20 players');
  await expect(host.page.getByTestId('game-card-more')).toBeVisible();
  await expect(host.page.getByTestId('code-input-0')).toBeVisible();

  // A card leads to the game's home without a full page load.
  await cards.first().click();
  await expect(host.page).toHaveURL(/\/skribble$/);
  await expect(host.page.getByTestId('home-create')).toBeVisible();
  await expect(host.page.getByTestId('site-header')).toContainText('Skribble');
  await expect(host.page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
});

test('a code typed in the library leads to that game’s home and joins the room', async () => {
  await host.page.getByTestId('home-name').fill(host.name);
  await host.page.getByTestId('home-create').click();
  skribbleCode = await readCode(host.page);
  await expect(host.page).toHaveURL(new RegExp(`/skribble/${skribbleCode}$`));

  await guest.page.goto('/');
  await guest.page.getByTestId('code-input-0').pressSequentially(skribbleCode, { delay: 20 });
  await expect(guest.page).toHaveURL(new RegExp(`/skribble/${skribbleCode}$`));
  await expect(guest.page.getByTestId('invite-banner')).toContainText(skribbleCode);
  await expect(guest.page.getByTestId('code-input-3')).toHaveValue(skribbleCode[3]);
  await expect(guest.page.getByTestId('room-preview')).toContainText(/1\/12 players/);
  await guest.page.getByTestId('home-name').fill(guest.name);
  await guest.page.getByTestId('home-join').click();
  await expect(guest.page.getByTestId('room-code')).toHaveText(skribbleCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  await expect(guest.page.getByTestId('copy-link')).toBeVisible();
});

test('Back and the brand link leave the room and land where the user came from', async () => {
  // The guest arrived from the library: Back goes there and releases the seat right away.
  await guest.page.goBack();
  await expect(guest.page).toHaveURL(/\/$/);
  await expect(guest.page.getByTestId('game-grid')).toBeVisible();
  await expect(guest.page.getByTestId('room-code')).toHaveCount(0);
  await expect(host.page.getByTestId('player-item')).toHaveCount(1);

  // The brand link does the same from inside a room.
  await guest.page.goto(`/skribble/${skribbleCode}`);
  await guest.page.getByTestId('home-join').click();
  await expect(guest.page.getByTestId('room-code')).toHaveText(skribbleCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  await guest.page.getByTestId('brand-link').click();
  await expect(guest.page).toHaveURL(/\/$/);
  await expect(guest.page).toHaveTitle('Bored Games');
  await expect(guest.page.getByTestId('game-grid')).toBeVisible();
  await expect(host.page.getByTestId('player-item')).toHaveCount(1);
  expect(await (await guest.page.request.get(`/api/rooms/${skribbleCode}`)).json()).toMatchObject({ exists: true, players: 1 });

  // A join error stays on the page that raised it.
  const unknown = skribbleCode === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
  await guest.page.goto('/skribble');
  await guest.page.getByTestId('code-input-0').pressSequentially(unknown, { delay: 20 });
  await guest.page.getByTestId('home-join').click();
  await expect(guest.page.getByTestId('join-error')).toBeVisible();
  await guest.page.getByTestId('brand-link').click();
  await expect(guest.page.getByTestId('game-grid')).toBeVisible();
  await guest.page.goBack();
  await expect(guest.page).toHaveURL(/\/skribble$/);
  await expect(guest.page.getByTestId('home-join')).toBeVisible();
  await expect(guest.page.getByTestId('join-error')).toHaveCount(0);

  // Back in the room for the tests that follow.
  await guest.page.goto(`/skribble/${skribbleCode}`);
  await guest.page.getByTestId('home-join').click();
  await expect(guest.page.getByTestId('room-code')).toHaveText(skribbleCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
});

test('an unknown code typed in the library is reported, and an unknown page falls back to the library', async () => {
  await phone.page.goto('/');
  const unknown = skribbleCode === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
  await phone.page.getByTestId('code-input-0').pressSequentially(unknown, { delay: 20 });
  await expect(phone.page.getByTestId('room-preview')).toContainText(/no room with this code/i);
  await expect(phone.page).toHaveURL(/\/$/);

  await phone.page.goto('/no-such-game');
  await expect(phone.page.getByTestId('toast')).toContainText(/does not exist/i);
  await expect(phone.page).toHaveURL(/\/$/);
  await expect(phone.page.getByTestId('game-grid')).toBeVisible();
});

test('a legacy bare-code link redirects to the game’s join link; an unknown one lands in the library', async () => {
  await guest.page.getByTestId('leave-room').click();
  await expect(guest.page).toHaveURL(/\/skribble$/);

  await guest.page.goto(`/${skribbleCode}`);
  await expect(guest.page).toHaveURL(new RegExp(`/skribble/${skribbleCode}$`));
  await expect(guest.page.getByTestId('invite-banner')).toContainText(skribbleCode);

  const unknown = skribbleCode === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
  await guest.page.goto(`/${unknown}`);
  await expect(guest.page).toHaveURL(/\/$/);
  await expect(guest.page.getByTestId('toast')).toContainText(unknown);
  await expect(guest.page.getByTestId('game-grid')).toBeVisible();
});

test('the hidden template game plays a whole Click Race between two players', async () => {
  await host.page.getByTestId('leave-room').click();
  await host.page.goto('/template');
  await expect(host.page.getByTestId('site-header')).toContainText('Click Race');
  await expect(host.page.getByTestId('home-name')).toHaveValue(host.name);
  await host.page.getByTestId('home-create').click();
  const code = await readCode(host.page);
  await expect(host.page).toHaveURL(new RegExp(`/template/${code}$`));
  // The template game can be played alone, so the host may start right away; wait for the guest anyway.
  await expect(host.page.getByTestId('start-game')).toBeEnabled();

  await guest.page.goto(`/template/${code}`);
  await expect(guest.page.getByTestId('invite-banner')).toContainText(code);
  await guest.page.getByTestId('home-join').click();
  await expect(guest.page.getByTestId('room-code')).toHaveText(code);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);

  // Platform fields first, then the game's own rows; only the host edits.
  await host.page.getByTestId('settings-targetClicks').fill('10');
  await expect(guest.page.getByTestId('settings-value-targetClicks')).toHaveText('10');
  await expect(guest.page.getByTestId('settings-targetClicks')).toHaveCount(0);
  await expect(guest.page.getByTestId('settings-value-timeLimit')).toHaveText('30s');
  await expect(guest.page.getByTestId('settings-allowMidGameJoin')).toBeDisabled();

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
  await expect(guest.page.getByTestId('podium-leave')).toBeVisible();

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
});

test('the library and a game home fit a phone screen with 44px targets', async () => {
  await phone.page.goto('/');
  await noHorizontalOverflow(phone.page, PORTRAIT.width);
  const card = phone.page.getByTestId('game-card').first();
  await expect(card).toBeVisible();
  const cardBox = await card.boundingBox();
  expect(cardBox?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET);
  expect((cardBox?.x ?? 0) + (cardBox?.width ?? 0)).toBeLessThanOrEqual(PORTRAIT.width + 0.5);
  const joinBox = await phone.page.getByTestId('library-join').boundingBox();
  expect(joinBox?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET);
  const headerButton = await phone.page.locator('.site-header__actions button').last().boundingBox();
  expect((headerButton?.x ?? 0) + (headerButton?.width ?? 0)).toBeLessThanOrEqual(PORTRAIT.width + 0.5);

  await card.click();
  await expect(phone.page).toHaveURL(/\/skribble$/);
  await noHorizontalOverflow(phone.page, PORTRAIT.width);
  for (const id of ['home-create', 'home-join', 'home-name', 'code-input-0']) {
    const box = await phone.page.getByTestId(id).boundingBox();
    expect(box?.height ?? 0, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
  }
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
