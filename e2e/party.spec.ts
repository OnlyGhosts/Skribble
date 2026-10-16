import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { closeResults, createParty, expectReadyCount, expectResults, joinByCode, leaveLobby, readyAll } from './party';

/**
 * The party stays together across games. Four players (one on a phone) create a Click Race
 * party at /template, ready up and play the race to its end: everyone lands back in the lobby with
 * the results over it, the winner celebrated, nobody thrown out by a stray Enter, a reload still
 * showing them, each closing them their own way; everyone readies up again, and the host switches
 * the party to The Spy Game (the URL follows on every phone, nobody rejoins); one
 * player sits the next game out, the host sets Unhinged, the other three play a one-round Spy
 * Game while the fourth watches, and the party lands back in the lobby. Serial: the tests build
 * on each other.
 */
test.describe.configure({ mode: 'serial' });

const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const PORTRAIT = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
/** playwright.config's default viewport, restored after a small-screen check. */
const DESKTOP = { width: 1280, height: 800 };
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
  code = await createParty(host.page, host.name, 'template');
  for (const g of guests()) await joinByCode(g.page, g.name, code);
  for (const p of players) await expect(p.page.getByTestId('player-item')).toHaveCount(4);

  // The host picks from tappable cards (the hidden template game is offered only because it is the current one).
  const picker = host.page.getByTestId('game-picker');
  await expect(picker).toHaveAttribute('data-game', 'template');
  await expect(picker.locator('[data-testid="game-tile"][data-game="template"]')).toHaveAttribute('aria-checked', 'true');
  await expect(picker.locator('[data-testid="game-tile"][data-game="spygame"]')).toHaveAttribute('aria-checked', 'false');
  await expect(picker.getByTestId('game-tile')).toHaveCount(6);
  // Everyone else sees the current game and who decides.
  await expect(pia.page.getByTestId('game-picker-note')).toHaveText(`${host.name} picks the game`);
  await expect(pia.page.getByTestId('game-picker').getByTestId('game-tile')).toHaveCount(1);
  await expect(pia.page.locator('button[data-testid="game-tile"]')).toHaveCount(0);

  // Click Race never reads the content mode, so nobody is offered one for it.
  for (const p of players) await expect(p.page.getByTestId('settings-contentMode')).toHaveCount(0);
  // Only the host has settings; the others just sit in the room with their ready buttons.
  await expect(host.page.getByTestId('settings-panel')).toBeVisible();
  for (const g of guests()) await expect(g.page.getByTestId('settings-panel')).toHaveCount(0);

  // The phone lobby: the room bar first, then the picker; ready controls fit the screen with 44px targets.
  await expect(pia.page.locator('.lobby > section').first()).toHaveAttribute('data-testid', 'room-bar');
  await noHorizontalOverflow(pia.page, PORTRAIT.width);
  for (const id of ['game-tile', 'ready-toggle', 'sitout-toggle', 'edit-profile', 'copy-code', 'share-invite', 'settings-menu']) {
    const box = await pia.page.getByTestId(id).first().boundingBox();
    expect(box?.height ?? 0, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect((box?.x ?? 0) + (box?.width ?? 0), `${id} fits the phone width`).toBeLessThanOrEqual(PORTRAIT.width + 0.5);
  }
  // Sit this one out and Change my look are buttons side by side, under I'm ready.
  const ready = await pia.page.getByTestId('ready-toggle').boundingBox();
  const sitOut = await pia.page.getByTestId('sitout-toggle').boundingBox();
  const look = await pia.page.getByTestId('edit-profile').boundingBox();
  expect(Math.abs((sitOut?.y ?? 0) - (look?.y ?? 1)), 'one row').toBeLessThanOrEqual(0.5);
  expect((sitOut?.x ?? 0) + (sitOut?.width ?? 0)).toBeLessThanOrEqual(look?.x ?? 0);
  expect(sitOut?.y ?? 0).toBeGreaterThan((ready?.y ?? 0) + (ready?.height ?? 0) - 0.5);
  await expect(pia.page.getByTestId('sitout-toggle')).toHaveClass(/btn--secondary/);
  await expect(pia.page.getByTestId('edit-profile')).toHaveClass(/btn--secondary/);
  // Change my look opens the editor in a sheet; Save closes it.
  await pia.page.getByTestId('edit-profile').click();
  await expect(pia.page.getByTestId('profile-sheet').getByTestId('profile-editor')).toBeVisible();
  await pia.page.getByTestId('save-profile').click();
  await expect(pia.page.getByTestId('profile-sheet')).toHaveCount(0);

  // On a phone the room's logo is centred at the top, the settings gear still on its "o".
  const header = pia.page.getByTestId('site-header');
  const mark = await header.getByTestId('wordmark').boundingBox();
  expect(Math.abs((mark?.x ?? 0) + (mark?.width ?? 0) / 2 - PORTRAIT.width / 2), 'the logo is centred').toBeLessThanOrEqual(1.5);
  const gear = await header.locator('.wordmark__gear').boundingBox();
  const gearButton = await header.getByTestId('settings-menu').boundingBox();
  expect(Math.abs((gear?.x ?? 0) + (gear?.width ?? 0) / 2 - ((gearButton?.x ?? 0) + (gearButton?.width ?? 0) / 2))).toBeLessThanOrEqual(1.5);
  await header.getByTestId('settings-menu').click();
  await expectInsideViewport(pia.page, 'settings-popover', PORTRAIT);
  await pia.page.keyboard.press('Escape');
  // The desktop keeps the logo at the left.
  const desk = await host.page.getByTestId('site-header').getByTestId('wordmark').boundingBox();
  expect(desk?.x ?? 999).toBeLessThan(100);
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

test('the race ends: everyone is back in the lobby with the results over it, the winner celebrated; Enter changes nothing', async () => {
  await host.page.getByTestId('settings-targetClicks').fill('10');
  await expect(host.page.getByTestId('settings-value-targetClicks')).toHaveText('10');
  await host.page.getByTestId('start-game').click();
  for (const p of players) await expect(p.page.getByTestId('click-button')).toBeVisible();
  for (let i = 0; i < 2; i++) await quinn.page.getByTestId('click-button').click();
  for (let i = 0; i < 10; i++) await host.page.getByTestId('click-button').click();

  for (const p of players) {
    await expectResults(p.page);
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end.getByTestId('results-headline')).toHaveText(`${host.name} wins!`);
    await expect(end.getByTestId('results-entry')).toHaveCount(4);
    await expect(end.getByTestId('confetti')).toBeAttached();
    // It ran its course: no reason line.
    await expect(end.getByTestId('results-reason')).toHaveCount(0);
    // Straight back to the lobby: no game screen under the popup, nothing holding anyone.
    await expect(p.page.getByTestId('click-button')).toHaveCount(0);
  }
  await expect(host.page.getByTestId('overlay-game-end')).toHaveAttribute('data-winner', 'true');
  await expect(host.page.getByTestId('results-place')).toHaveText('You won!');
  await expect(quinn.page.getByTestId('results-place')).toHaveText('You came 2nd');
  await expect(quinn.page.getByTestId('overlay-game-end')).toHaveAttribute('data-winner', 'false');
  for (const p of players) await expect(p.page.getByTestId('play-again')).toHaveCount(0);

  // The phone popup fits the screen, Back to the room a full-size target.
  await noHorizontalOverflow(pia.page, PORTRAIT.width);
  await expectInsideViewport(pia.page, 'results-card', PORTRAIT);
  await expect
    .poll(async () => (await pia.page.getByTestId('results-done').boundingBox())?.height ?? 0, { message: 'Back to the room is a 44px target' })
    .toBeGreaterThanOrEqual(MIN_TARGET);

  // On a small phone the standings scroll inside the card while Back to the room stays on screen.
  await host.page.setViewportSize(SMALL);
  await expect(host.page.getByTestId('overlay-game-end')).toBeVisible();
  for (const id of ['results-done', 'results-close']) await expectInsideViewport(host.page, id, SMALL);
  await host.page.setViewportSize(DESKTOP);

  // The regression: Enter (the thumb still on the keyboard's send key) leaves nobody.
  for (const p of players) {
    await expect.poll(() => p.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)).toBe('results-card');
    await p.page.keyboard.press('Enter');
    await p.page.keyboard.press('Enter');
    await p.page.waitForTimeout(400);
    await expect(p.page.getByTestId('overlay-game-end')).toBeVisible();
    await expect(p.page).toHaveURL(new RegExp(`/template/${code}$`));
    expect(await seatCode(p.page)).toBe(code);
  }
});

test('a reload while the results are up shows them again; each player closes them their own way and stays in the lobby', async () => {
  await quinn.page.reload();
  await expectResults(quinn.page);
  await expect(quinn.page.getByTestId('results-place')).toHaveText('You came 2nd');

  // The button, the X, Escape and (on a desktop) a tap beside the card all close it.
  await closeResults(host.page);
  // A tap beside the card on a phone does nothing: the scores never go by accident.
  await pia.page.touchscreen.tap(6, PORTRAIT.height - 6);
  await pia.page.waitForTimeout(300);
  await expect(pia.page.getByTestId('overlay-game-end')).toBeVisible();
  await pia.page.getByTestId('results-close').click();
  await quinn.page.keyboard.press('Escape');
  await rae.page.mouse.click(8, 8);
  for (const p of players) {
    await expect(p.page.getByTestId('overlay-game-end')).toHaveCount(0);
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    await expect(p.page.getByTestId('player-item')).toHaveCount(4);
    await expect(p.page).toHaveURL(new RegExp(`/template/${code}$`));
    expect(await seatCode(p.page)).toBe(code);
  }
  // Closed for good: a reload does not bring them back.
  await host.page.reload();
  await expect(host.page.getByTestId('room-code')).toHaveText(code);
  await host.page.waitForTimeout(500);
  await expect(host.page.getByTestId('overlay-game-end')).toHaveCount(0);

  // Everyone readies up for the next game.
  await readyAll(guests().map((p) => p.page));
  await expect(host.page.getByTestId('player-count')).toHaveText('4 of 4 ready');
});

test('the lobby keeps the party, and the host switches it to The Spy Game: the URL follows everywhere, nobody rejoins', async () => {
  for (const p of players) {
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    await expect(p.page.getByTestId('player-item')).toHaveCount(4);
    await expect(p.page).toHaveURL(new RegExp(`/template/${code}$`));
  }
  await expect(host.page.getByTestId('player-count')).toHaveText('4 of 4 ready');

  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="spygame"]').click();
  for (const p of players) {
    await expect(p.page).toHaveURL(new RegExp(`/spygame/${code}$`));
    await expect(p.page).toHaveTitle(`boredgames.io · ${code}`);
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    await expect(p.page.getByTestId('player-item')).toHaveCount(4);
    await expect(p.page.getByTestId('game-picker')).toHaveAttribute('data-game', 'spygame');
    await expect(p.page.getByTestId('home-join')).toHaveCount(0);
    expect(await seatCode(p.page)).toBe(code);
  }
  await expect(host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="spygame"]')).toHaveAttribute('aria-checked', 'true');
  await expect(pia.page.getByTestId('game-picker').getByTestId('game-tile')).toHaveAttribute('data-game', 'spygame');
  await expect(host.page.getByTestId('settings-rounds')).toBeVisible();
  await expect(host.page.getByTestId('settings-targetClicks')).toHaveCount(0);
  // The Spy Game reads the content mode: Family and Unhinged, nothing in between (and only the host sees it).
  await expect(host.page.getByTestId('settings-contentMode')).toHaveAttribute('data-value', 'family');
  await expect(host.page.locator('[data-testid^="content-mode-"]')).toHaveCount(2);
  await expect(host.page.getByTestId('content-mode-cheeky')).toHaveCount(0);
  await expect(pia.page.locator('[data-testid^="content-mode-"]')).toHaveCount(0);
  // Ready flags carried over; the Spy Game's own settings start fresh.
  await expect(host.page.getByTestId('player-count')).toHaveText('4 of 4 ready');
  await expect(host.page.getByTestId('settings-value-rounds')).toHaveText('5');
});

test('one player sits out, the host sets Unhinged, three play a one-round Spy Game while the fourth watches from the party', async () => {
  test.setTimeout(90_000);
  await rae.page.getByTestId('sitout-toggle').click();
  await expect(rae.page.getByTestId('ready-controls')).toHaveAttribute('data-sitting-out', 'true');
  // Sitting out: only Count me in, with the hint; no disabled ready button next to it.
  await expect(rae.page.getByTestId('ready-toggle')).toHaveCount(0);
  await expect(rae.page.getByTestId('sitout-toggle')).toHaveText('Count me in');
  await expect(rae.page.getByTestId('sitout-hint')).toHaveText("You'll watch the next game.");
  await expect(rae.page.getByTestId('ready-controls').getByRole('button')).toHaveText(['Count me in', 'Change my look']);
  for (const p of players) await expect(p.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`)).toHaveAttribute('data-status', 'sittingOut');
  await expect(host.page.getByTestId('player-count')).toHaveText('3 of 3 ready');

  await host.page.getByTestId('content-mode-unhinged').click();
  await expect(host.page.getByTestId('settings-contentMode')).toHaveAttribute('data-value', 'unhinged');
  await expect(host.page.getByTestId('content-mode-unhinged')).toHaveAttribute('aria-checked', 'true');
  await expect(host.page.getByTestId('content-mode-unhinged')).toContainText('18+');

  await host.page.getByTestId('settings-rounds').fill('1');
  await expect(host.page.getByTestId('settings-value-rounds')).toHaveText('1');
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
  await rae.page.getByTestId('players-toggle').click();
  await expect(rae.page.getByTestId('players-sheet').getByTestId('player-item')).toHaveCount(4);
  await expect(rae.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`).getByTestId('player-sitting-out')).toBeVisible();
  await rae.page.getByTestId('players-sheet-close').click();
  const roles = await Promise.all(playing.map(async (p) => (await p.page.getByTestId('spygame-role').getAttribute('data-role')) ?? ''));
  expect(roles.filter((r) => r === 'spy')).toHaveLength(1);
  expect(roles.filter((r) => r === 'agent')).toHaveLength(2);

  // The spy ends the round by naming the location; the lobby follows with the results over it.
  const spy = playing[roles.indexOf('spy')];
  const agent = playing[roles.indexOf('agent')];
  const locationId = (await agent.page.getByTestId('spygame-location').getAttribute('data-location-id')) ?? '';
  expect(locationId).not.toBe('');
  const tile = spy.page.locator(`[data-testid="guess-tile"][data-location-id="${locationId}"]`);
  await tile.click();
  await tile.click();
  await expect(host.page.getByTestId('spygame-next-round')).toContainText('Show results');
  await host.page.getByTestId('spygame-next-round').click();
  for (const p of players) await expectResults(p.page);
  await expect(spy.page.getByTestId('results-place')).toHaveText('You won!');
  // Rae watched the whole game: she sees how it ended too, and is not in the standings.
  await expect(rae.page.getByTestId('results-place')).toHaveText('You watched this one');
  await expect(rae.page.getByTestId('overlay-game-end').getByTestId('results-entry')).toHaveCount(3);

  for (const p of players) await closeResults(p.page);
  for (const p of players) {
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    await expect(p.page.getByTestId('player-item')).toHaveCount(4);
    await expect(p.page).toHaveURL(new RegExp(`/spygame/${code}$`));
  }
  // The sit-out choice persists until Rae comes back in.
  await expect(rae.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`)).toHaveAttribute('data-status', 'sittingOut');
  // Count me in comes back in and readies in one tap.
  await expect(rae.page.getByTestId('sitout-toggle')).toHaveText('Count me in');
  await rae.page.getByTestId('sitout-toggle').click();
  await expect(rae.page.locator(`[data-testid="player-item"][data-name="${rae.name}"]`)).toHaveAttribute('data-status', 'ready');
  await expect(rae.page.getByTestId('ready-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(rae.page.getByTestId('ready-toggle')).toContainText("You're ready");
  await expect(rae.page.getByTestId('sitout-toggle')).toHaveText('Sit this one out');

  // The content mode is hidden for a game that never reads it, and comes back unchanged with one that does.
  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="poker"]').click();
  for (const p of players) await expect(p.page.getByTestId('game-picker')).toHaveAttribute('data-game', 'poker');
  await expect(host.page.getByTestId('settings-contentMode')).toHaveCount(0);
  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="quipgame"]').click();
  await expect(host.page.getByTestId('settings-contentMode')).toHaveAttribute('data-value', 'unhinged');
});

test('the host leaves: the new host gets the settings and the game picker at once', async () => {
  await leaveLobby(host.page);
  const rest = guests();
  for (const p of rest) await expect(p.page.getByTestId('player-item')).toHaveCount(3);
  // The host role goes to the longest-connected guest, Pia; her room grows the settings and the grid with no reload.
  const crowned = pia;
  await expect(crowned.page.locator(`[data-testid="player-item"][data-name="${crowned.name}"]`).getByTestId('host-crown')).toBeVisible();
  await expect(crowned.page.getByTestId('settings-panel')).toBeVisible();
  await expect(crowned.page.getByTestId('settings-contentMode')).toHaveAttribute('data-value', 'unhinged');
  await expect(crowned.page.locator('button[data-testid="game-tile"]')).toHaveCount(5);
  await expect(crowned.page.getByTestId('start-game')).toBeVisible();
  for (const p of rest.filter((x) => x !== crowned)) {
    await expect(p.page.getByTestId('settings-panel')).toHaveCount(0);
    await expect(p.page.getByTestId('game-picker-note')).toHaveText(`${crowned.name} picks the game`);
  }
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
