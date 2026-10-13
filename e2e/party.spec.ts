import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { expectReadyCount, readyAll } from './party';

/**
 * The party stays together across games. Four players (one on a phone) create a Click Race
 * party at /template, ready up and play to the podium; the winner is celebrated and nobody is
 * thrown out by a stray Enter; everyone readies up on the podium; the host goes back to the lobby
 * and switches the party to The Spy Game (the URL follows on every phone, nobody rejoins); one
 * player sits the next game out, the host sets Unhinged, the other three play a one-round Spy
 * Game while the fourth watches, and the party lands back in the lobby. Serial: the tests build
 * on each other.
 */
test.describe.configure({ mode: 'serial' });

const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const PORTRAIT = { width: 390, height: 844 };
const MIN_TARGET = 44;

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Uncaught exceptions and console errors, checked at the end. */
  errors: string[];
}

const players: Player[] = [];
let host: Player;
let pia: Player;
let quinn: Player;
let rae: Player;
let code = '';

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

const guests = (): Player[] => players.filter((p) => p !== host);

async function joinByCode(p: Player, slug: string): Promise<void> {
  await p.page.goto(`/${slug}`);
  await p.page.getByTestId('home-name').fill(p.name);
  await p.page.getByTestId('code-input-0').pressSequentially(code, { delay: 20 });
  await p.page.getByTestId('home-join').click();
  await expect(p.page.getByTestId('room-code')).toHaveText(code);
}

async function noHorizontalOverflow(page: Page, width: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function expectInsideViewport(page: Page, testId: string, size: { width: number; height: number }): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} has a box`).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width + 0.5);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height + 0.5);
}

/** The session the client keeps for its seat: the proof a page is still in the room. */
async function seatCode(page: Page): Promise<string | null> {
  return page.evaluate(() => (JSON.parse(sessionStorage.getItem('boredgames.session') ?? 'null') as { code?: string } | null)?.code ?? null);
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  quinn = await newPlayer(browser, 'Quinn');
  rae = await newPlayer(browser, 'Rae');
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host creates a Click Race party, three friends join, and the lobby shows the game picker', async () => {
  await host.page.goto('/template');
  await host.page.getByTestId('home-name').fill(host.name);
  await host.page.getByTestId('home-create').click();
  code = ((await host.page.getByTestId('room-code').textContent()) ?? '').replace(/\s+/g, '');
  expect(code).toMatch(ROOM_CODE_RE);
  await expect(host.page).toHaveURL(new RegExp(`/template/${code}$`));
  for (const g of guests()) await joinByCode(g, 'template');
  for (const p of players) await expect(p.page.getByTestId('player-item')).toHaveCount(4);

  // The host picks from tappable cards (the hidden template game is offered only because it is the current one).
  const picker = host.page.getByTestId('game-picker');
  await expect(picker).toHaveAttribute('data-game', 'template');
  await expect(picker.locator('[data-testid="game-tile"][data-game="template"]')).toHaveAttribute('aria-checked', 'true');
  await expect(picker.locator('[data-testid="game-tile"][data-game="spygame"]')).toHaveAttribute('aria-checked', 'false');
  await expect(picker.getByTestId('game-tile')).toHaveCount(4);
  // Everyone else sees the current game and who decides.
  await expect(pia.page.getByTestId('game-picker-note')).toHaveText(`${host.name} picks the game`);
  await expect(pia.page.getByTestId('game-picker').getByTestId('game-tile')).toHaveCount(1);
  await expect(pia.page.locator('button[data-testid="game-tile"]')).toHaveCount(0);

  // The phone lobby: picker, ready controls and content modes fit the screen with 44px targets.
  await noHorizontalOverflow(pia.page, PORTRAIT.width);
  for (const id of ['game-tile', 'ready-toggle', 'sitout-toggle', 'content-mode-family']) {
    const box = await pia.page.getByTestId(id).first().boundingBox();
    expect(box?.height ?? 0, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect((box?.x ?? 0) + (box?.width ?? 0), `${id} fits the phone width`).toBeLessThanOrEqual(PORTRAIT.width + 0.5);
  }
});

test('players ready up: the count follows, Start waits for enough ready players and names who is not', async () => {
  // Click Race needs one player: the host alone (ready by pressing Start) could begin, but the others are not ready.
  await expect(host.page.getByTestId('player-count')).toHaveText('1 of 4 ready');
  await expectReadyCount(host.page, 1);
  for (const g of guests()) await expect(g.page.locator(`[data-testid="player-item"][data-name="${g.name}"]`)).toHaveAttribute('data-status', 'notReady');

  // Starting now would sit the others out: the host is asked first and waits.
  await host.page.getByTestId('start-game').click();
  await expect(host.page.getByTestId('start-confirm')).toContainText(`${pia.name}, ${quinn.name} and ${rae.name}`);
  await host.page.getByTestId('start-wait').click();
  await expect(host.page.getByTestId('start-confirm')).toHaveCount(0);

  await readyAll(guests().map((g) => g.page));
  await expect(host.page.getByTestId('player-count')).toHaveText('4 of 4 ready');
  await expectReadyCount(host.page, 4);
  for (const p of players) await expect(p.page.locator(`[data-testid="player-item"][data-name="${pia.name}"]`)).toHaveAttribute('data-status', 'ready');
  await expect(host.page.getByTestId('start-game')).toContainText('Start · 4 ready');
});

test('the race is played to the podium: the winner is celebrated, Enter changes nothing, everyone readies up for the next game', async () => {
  await host.page.getByTestId('settings-targetClicks').fill('10');
  await expect(quinn.page.getByTestId('settings-value-targetClicks')).toHaveText('10');
  await host.page.getByTestId('start-game').click();
  for (const p of players) await expect(p.page.getByTestId('click-button')).toBeVisible();
  for (let i = 0; i < 2; i++) await quinn.page.getByTestId('click-button').click();
  for (let i = 0; i < 10; i++) await host.page.getByTestId('click-button').click();

  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible();
    await expect(end.getByTestId('podium-headline')).toHaveText(`${host.name} wins!`);
    await expect(end.getByTestId('podium-entry')).toHaveCount(4);
    await expect(end.getByTestId('confetti')).toBeAttached();
  }
  await expect(host.page.getByTestId('overlay-game-end')).toHaveAttribute('data-winner', 'true');
  await expect(host.page.getByTestId('podium-place')).toHaveText('You won!');
  await expect(quinn.page.getByTestId('podium-place')).toHaveText('You came 2nd');
  await expect(quinn.page.getByTestId('overlay-game-end')).toHaveAttribute('data-winner', 'false');
  await expect(host.page.getByTestId('play-again')).toBeVisible();
  await expect(host.page.getByTestId('back-to-lobby')).toBeVisible();
  await expect(pia.page.getByTestId('back-to-lobby')).toHaveCount(0);
  await expect(pia.page.getByTestId('podium-waiting')).toContainText(host.name);

  // The phone podium fits the screen.
  await noHorizontalOverflow(pia.page, PORTRAIT.width);
  await expectInsideViewport(pia.page, 'podium-card', PORTRAIT);
  const readyBox = await pia.page.getByTestId('overlay-game-end').getByTestId('ready-toggle').boundingBox();
  expect(readyBox?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET);

  // The regression: Enter after the podium (the thumb still on the keyboard's send key) leaves nobody.
  for (const p of players) {
    await expect.poll(() => p.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)).toBe('podium-card');
    await p.page.keyboard.press('Enter');
    await p.page.keyboard.press('Enter');
    await p.page.waitForTimeout(400);
    await expect(p.page.getByTestId('overlay-game-end')).toBeVisible();
    await expect(p.page).toHaveURL(new RegExp(`/template/${code}$`));
    expect(await seatCode(p.page)).toBe(code);
    await expect(p.page.getByTestId('podium-leave')).toHaveCount(0);
  }

  // Everyone presses "Ready for the next game".
  await readyAll(players.map((p) => p.page));
  for (const p of players) await expect(p.page.getByTestId('podium-ready-count')).toHaveText('4 of 4 ready');
});

test('back to lobby keeps the party, and the host switches it to The Spy Game: the URL follows everywhere, nobody rejoins', async () => {
  await host.page.getByTestId('back-to-lobby').click();
  for (const p of players) {
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    await expect(p.page.getByTestId('player-item')).toHaveCount(4);
    await expect(p.page).toHaveURL(new RegExp(`/template/${code}$`));
  }
  await expect(host.page.getByTestId('player-count')).toHaveText('4 of 4 ready');

  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="spygame"]').click();
  for (const p of players) {
    await expect(p.page).toHaveURL(new RegExp(`/spygame/${code}$`));
    await expect(p.page).toHaveTitle(`The Spy Game · room ${code}`);
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    await expect(p.page.getByTestId('player-item')).toHaveCount(4);
    await expect(p.page.getByTestId('game-picker')).toHaveAttribute('data-game', 'spygame');
    await expect(p.page.getByTestId('chat-log')).toContainText('switched the party to The Spy Game');
    await expect(p.page.getByTestId('home-join')).toHaveCount(0);
    expect(await seatCode(p.page)).toBe(code);
  }
  await expect(host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="spygame"]')).toHaveAttribute('aria-checked', 'true');
  await expect(pia.page.getByTestId('game-picker').getByTestId('game-tile')).toHaveAttribute('data-game', 'spygame');
  await expect(host.page.getByTestId('settings-rounds')).toBeVisible();
  await expect(host.page.getByTestId('settings-targetClicks')).toHaveCount(0);
  // Ready flags carried over; the Spy Game's own settings start fresh.
  await expect(host.page.getByTestId('player-count')).toHaveText('4 of 4 ready');
  await expect(quinn.page.getByTestId('settings-value-rounds')).toHaveText('5');
});

test('one player sits out, the host sets Unhinged, three play a one-round Spy Game while the fourth watches from the party', async () => {
  test.setTimeout(90_000);
  await rae.page.getByTestId('sitout-toggle').click();
  await expect(rae.page.getByTestId('ready-controls')).toHaveAttribute('data-sitting-out', 'true');
  await expect(rae.page.getByTestId('ready-toggle')).toBeDisabled();
  for (const p of players) await expect(p.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`)).toHaveAttribute('data-status', 'sittingOut');
  await expect(host.page.getByTestId('player-count')).toHaveText('3 of 3 ready');

  await host.page.getByTestId('content-mode-unhinged').click();
  for (const p of players) await expect(p.page.getByTestId('settings-value-contentMode')).toHaveText('Unhinged');
  await expect(pia.page.getByTestId('settings-contentMode')).toHaveAttribute('data-value', 'unhinged');
  await expect(pia.page.getByTestId('content-mode-unhinged')).toBeDisabled();
  await expect(pia.page.getByTestId('content-mode-unhinged')).toContainText('18+');

  await host.page.getByTestId('settings-rounds').fill('1');
  await expect(quinn.page.getByTestId('settings-value-rounds')).toHaveText('1');
  await readyAll([pia.page, quinn.page]);
  await expectReadyCount(host.page, 3);
  await expect(host.page.getByTestId('start-confirm')).toHaveCount(0);
  await host.page.getByTestId('start-game').click();

  const playing = [host, pia, quinn];
  for (const p of playing) await expect(p.page.getByTestId('spygame-role')).toBeVisible();
  // The sitting-out player watches from inside the room: a spectator role, their seat intact.
  await expect(rae.page.getByTestId('spygame-role')).toHaveAttribute('data-role', 'spectator');
  await expect(rae.page).toHaveURL(new RegExp(`/spygame/${code}$`));
  await expect(rae.page.getByTestId('home-join')).toHaveCount(0);
  await expect(host.page.getByTestId('chat-log')).toContainText(`${rae.name} sits this one out`);
  await rae.page.getByTestId('players-toggle').click();
  await expect(rae.page.getByTestId('players-sheet').getByTestId('player-item')).toHaveCount(4);
  await expect(rae.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`).getByTestId('player-sitting-out')).toBeVisible();
  await rae.page.getByTestId('players-sheet-close').click();
  const roles = await Promise.all(playing.map(async (p) => (await p.page.getByTestId('spygame-role').getAttribute('data-role')) ?? ''));
  expect(roles.filter((r) => r === 'spy')).toHaveLength(1);
  expect(roles.filter((r) => r === 'agent')).toHaveLength(2);

  // The spy ends the round by naming the location; the podium follows, then the lobby.
  const spy = playing[roles.indexOf('spy')];
  const agent = playing[roles.indexOf('agent')];
  const locationId = (await agent.page.getByTestId('spygame-location').getAttribute('data-location-id')) ?? '';
  expect(locationId).not.toBe('');
  const tile = spy.page.locator(`[data-testid="guess-tile"][data-location-id="${locationId}"]`);
  await tile.click();
  await tile.click();
  await expect(host.page.getByTestId('spygame-next-round')).toContainText('Show results');
  await host.page.getByTestId('spygame-next-round').click();
  for (const p of players) await expect(p.page.getByTestId('overlay-game-end')).toBeVisible();
  await expect(spy.page.getByTestId('podium-place')).toHaveText('You won!');
  await expect(rae.page.getByTestId('podium-place')).toHaveText('You sat this one out');
  await expect(rae.page.getByTestId('overlay-game-end').getByTestId('podium-entry')).toHaveCount(3);

  await host.page.getByTestId('back-to-lobby').click();
  for (const p of players) {
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    await expect(p.page.getByTestId('player-item')).toHaveCount(4);
    await expect(p.page).toHaveURL(new RegExp(`/spygame/${code}$`));
  }
  // The sit-out choice persists until Rae comes back in.
  await expect(rae.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`)).toHaveAttribute('data-status', 'sittingOut');
  await rae.page.getByTestId('sitout-toggle').click();
  await expect(rae.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`)).toHaveAttribute('data-status', 'notReady');
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
