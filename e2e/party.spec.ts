import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { DEALER_STANDS_AT } from '../shared/games/blackjack/cards';
import { SPYGAME_ROUND_MINUTES } from '../shared/games/spygame/protocol';
import { closeResults, createParty, expectReadyCount, expectResults, joinByCode, leaveLobby, readyAll, roomTabTitle } from './party';

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
/** The smallest desktop-sized screen, where How to play is a popover with little room under its button. */
const LANDSCAPE_TABLET = { width: 1024, height: 768 };
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

  // The phone lobby: the logo bare, then the room code card under it, then the picker; ready controls fit the screen with 44px targets.
  await expect(pia.page.locator('.lobby__top > section')).toHaveAttribute('data-testid', 'room-bar');
  const phoneLogo = await pia.page.getByTestId('site-header').boundingBox();
  const phoneBar = await pia.page.getByTestId('room-bar').boundingBox();
  expect((phoneLogo?.y ?? 0) + (phoneLogo?.height ?? 0), 'the logo stacks over the room code').toBeLessThanOrEqual((phoneBar?.y ?? 0) + 0.5);
  const phoneSurfaces = await pia.page.evaluate(() => {
    const bg = (sel: string) => getComputedStyle(document.querySelector(sel) as Element).backgroundColor;
    return { top: bg('.lobby__top'), card: bg('[data-testid="room-bar"]') };
  });
  expect(phoneSurfaces.top, 'nothing drawn round the logo').toBe('rgba(0, 0, 0, 0)');
  expect(phoneSurfaces.card, 'the code on its card').not.toBe('rgba(0, 0, 0, 0)');
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
  // The desktop: one header bar. The logo at the left of its surface, the code and its buttons on the same line inside it.
  const bar = await host.page.locator('.lobby__top').boundingBox();
  const desk = await host.page.getByTestId('site-header').getByTestId('wordmark').boundingBox();
  expect(desk?.x ?? 999).toBeLessThan(100);
  expect(desk?.x ?? 0, 'the logo sits inside the bar, at its left').toBeGreaterThan(bar?.x ?? 0);
  expect(desk?.x ?? 0).toBeLessThan((bar?.x ?? 0) + 40);
  const deskBar = await host.page.getByTestId('room-bar').boundingBox();
  const centre = (box: typeof desk) => (box?.y ?? 0) + (box?.height ?? 0) / 2;
  expect(Math.abs(centre(desk) - centre(deskBar)), 'the logo sits beside the code, centred on it').toBeLessThanOrEqual(2);
  expect(deskBar?.x ?? 0, 'the code starts after the logo').toBeGreaterThan((desk?.x ?? 0) + (desk?.width ?? 0));
  expect((deskBar?.x ?? 0) + (deskBar?.width ?? 0), 'and ends inside the bar').toBeLessThanOrEqual((bar?.x ?? 0) + (bar?.width ?? 0));
  expect(bar?.height ?? 0, 'one slim bar').toBeLessThanOrEqual(72);
  // The bar is the one surface; the code section is a bare part of it, not a card beside the logo.
  const surfaces = await host.page.evaluate(() => {
    const style = (sel: string) => getComputedStyle(document.querySelector(sel) as Element);
    return {
      bar: style('.lobby__top').backgroundColor,
      barBorder: style('.lobby__top').borderTopWidth,
      section: style('[data-testid="room-bar"]').backgroundColor,
      sectionBorder: style('[data-testid="room-bar"]').borderTopWidth,
    };
  });
  expect(surfaces.bar).not.toBe('rgba(0, 0, 0, 0)');
  expect(surfaces.barBorder).toBe('1px');
  expect(surfaces.section).toBe('rgba(0, 0, 0, 0)');
  expect(surfaces.sectionBorder).toBe('0px');
  // The tiles, Copy, Share and the gear all centre on the bar's line; Copy, Share and the gear stay 44px targets.
  for (const id of ['room-code', 'copy-code', 'share-invite', 'settings-menu']) {
    const box = await host.page.getByTestId(id).boundingBox();
    expect(Math.abs(centre(box) - centre(bar)), `${id} centred on the bar`).toBeLessThanOrEqual(1.5);
    if (id !== 'room-code') expect(box?.height ?? 0, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
  }
  // The gear's menu drops out from under the bar, clear of its bottom edge, never pasted over it.
  await host.page.getByTestId('settings-menu').click();
  const deskPopover = await host.page.getByTestId('settings-popover').boundingBox();
  expect(deskPopover?.y ?? 0, 'the popover starts below the bar').toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? 0) + 4);
  await expectInsideViewport(host.page, 'settings-popover', host.page.viewportSize() ?? PORTRAIT);
  await host.page.keyboard.press('Escape');
  await expect(host.page.getByTestId('settings-popover')).toHaveCount(0);
});

const ROOM_SIZES = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

test('the room footer sits on the bottom of the screen at every size, its line across the page; kick buttons line up at the right', async () => {
  for (const size of ROOM_SIZES) {
    for (const p of [host, quinn]) {
      await p.page.setViewportSize(size);
      await p.page.evaluate(() => window.scrollTo(0, 0));
      // The guest's page is short and the host's (with the settings) long: either way Start or Ready sits on the bottom edge.
      const footer = await p.page.getByTestId('lobby-footer').boundingBox();
      expect(Math.abs((footer?.y ?? 0) + (footer?.height ?? 0) - size.height), `${p.name} ${size.width}: the footer is on the bottom`).toBeLessThanOrEqual(1);
      expect(footer?.x ?? -1, 'its line starts at the left edge').toBeLessThanOrEqual(0.5);
      expect(footer?.width ?? 0, 'and spans the page').toBeGreaterThanOrEqual(size.width - 0.5);
      await noHorizontalOverflow(p.page, size.width);
    }
    // Each row's kick button is its last item: a 44px target after the status, every one in the same column.
    const rows = await host.page.getByTestId('player-item').evaluateAll((items) =>
      items.map((item) => {
        const kick = item.querySelector('[data-testid="kick-player"]')?.getBoundingClientRect() ?? null;
        const status = item.querySelector('[data-testid="player-status"]')?.getBoundingClientRect() ?? null;
        const row = item.getBoundingClientRect();
        return { kick: kick && { left: kick.left, right: kick.right, width: kick.width, height: kick.height }, statusRight: status?.right ?? 0, rowRight: row.right };
      }),
    );
    const kicks = rows.flatMap((r) => (r.kick ? [{ ...r.kick, statusRight: r.statusRight, rowRight: r.rowRight }] : []));
    expect(kicks).toHaveLength(3);
    for (const k of kicks) {
      expect(k.width).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(k.height).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(k.left, 'after the status').toBeGreaterThanOrEqual(k.statusRight - 0.5);
      expect(k.rowRight - k.right, 'at the far right').toBeLessThanOrEqual(8);
      expect(Math.abs(k.right - kicks[0].right), 'lined up').toBeLessThanOrEqual(0.5);
    }
  }
  for (const p of [host, quinn]) await p.page.setViewportSize(DESKTOP);
});

test('Change my look is a centred box on a desktop and a drawer on a tablet or phone, its grids in full rows', async () => {
  const page = quinn.page;
  const grids = () =>
    page.evaluate(() => {
      const perRow = (selector: string) => {
        const tops = [...document.querySelectorAll(selector)].map((el) => Math.round(el.getBoundingClientRect().top));
        return tops.filter((t) => t === tops[0]).length;
      };
      return { faces: perRow('.avatar-picker__emojis > *'), colours: perRow('.avatar-picker__colors > *') };
    });
  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    await page.getByTestId('edit-profile').click();
    // Once it has popped in.
    await expect.poll(() => page.getByTestId('profile-sheet').locator('.sheet__panel').evaluate((el) => el.getAnimations().length)).toBe(0);
    const panel = await page.getByTestId('profile-sheet').locator('.sheet__panel').boundingBox();
    expect(Math.abs((panel?.x ?? 0) + (panel?.width ?? 0) / 2 - size.width / 2), 'centred across').toBeLessThanOrEqual(1);
    expect(Math.abs((panel?.y ?? 0) + (panel?.height ?? 0) / 2 - size.height / 2), 'and down').toBeLessThanOrEqual(1);
    expect(panel?.y ?? 0, 'off the top edge').toBeGreaterThan(0);
    expect(await grids()).toEqual({ faces: 10, colours: 6 });
    // Escape closes it, and so does a click on the dimmed page around it.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('profile-sheet')).toHaveCount(0);
    await page.getByTestId('edit-profile').click();
    await page.getByTestId('profile-sheet-backdrop').click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId('profile-sheet')).toHaveCount(0);
  }
  for (const size of [{ width: 768, height: 1024 }, PORTRAIT, SMALL]) {
    await page.setViewportSize(size);
    await page.getByTestId('edit-profile').click();
    // Once it has slid up.
    const bottom = async () => {
      const panel = await page.getByTestId('profile-sheet').locator('.sheet__panel').boundingBox();
      return Math.abs((panel?.y ?? 0) + (panel?.height ?? 0) - size.height);
    };
    await expect.poll(bottom, { message: `${size.width}: a drawer from the bottom` }).toBeLessThanOrEqual(1);
    expect((await grids()).colours).toBe(6);
    expect([5, 10]).toContain((await grids()).faces);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('profile-sheet')).toHaveCount(0);
  }
  await page.setViewportSize(DESKTOP);
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
    await expect(p.page).toHaveTitle(roomTabTitle(code));
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
  // A dragged slider glides under the pointer (no step grid while held) and snaps to a whole step when let go.
  const slider = host.page.getByTestId('settings-rounds');
  const box = (await slider.boundingBox())!;
  const min = Number(await slider.getAttribute('min'));
  const max = Number(await slider.getAttribute('max'));
  const thumbX = box.x + 11 + ((5 - min) / (max - min)) * (box.width - 22);
  await host.page.mouse.move(thumbX, box.y + box.height / 2);
  await host.page.mouse.down();
  await host.page.mouse.move(thumbX - box.width * 0.17, box.y + box.height / 2, { steps: 6 });
  await expect(slider).toHaveAttribute('step', 'any');
  expect(Number(await slider.inputValue()) % 1).not.toBe(0);
  await host.page.mouse.up();
  await expect(slider).toHaveAttribute('step', '1');
  const landed = Number(await slider.inputValue());
  expect(landed % 1).toBe(0);
  expect(landed).toBeLessThan(5);
  await expect(host.page.getByTestId('settings-value-rounds')).toHaveText(String(landed));
});

test('How to play shows the rules of the game picked, follows the host’s switch, and Escape closes it back onto its button', async () => {
  // On a desktop the card is a popover hanging off the button, with the room still usable under it.
  const page = quinn.page;
  const button = page.getByTestId('how-to-play');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  const popover = page.getByRole('dialog', { name: 'How to play The Spy Game' });
  await expect(popover).toBeVisible();
  await expect(popover).toHaveAttribute('data-testid', 'how-to-play-popover');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const card = page.getByTestId('how-to-play-card');
  await expect(card).toHaveAttribute('data-mode', 'popover');
  await expect(card.getByTestId('rules-name')).toHaveText('The Spy Game');
  await expect(card.getByTestId('rules-section')).toHaveCount(5);
  await expect(card.getByTestId('rules-section').first()).toContainText('How a round goes');
  await expect(card).toContainText(`${SPYGAME_ROUND_MINUTES} minutes`);
  await expect(card).toContainText('Watching');
  // Attached to the button: right under it, inside the screen, and nothing dims the room (the players stay reachable).
  const anchor = await button.boundingBox();
  const panel = await popover.boundingBox();
  const gapBelow = (panel?.y ?? 0) - ((anchor?.y ?? 0) + (anchor?.height ?? 0));
  const gapAbove = (anchor?.y ?? 0) - ((panel?.y ?? 0) + (panel?.height ?? 0));
  expect(Math.min(...[gapBelow, gapAbove].filter((g) => g >= 0)), 'right under or over the button').toBeLessThanOrEqual(16);
  expect(Math.abs((panel?.x ?? 0) - (anchor?.x ?? 0)) <= 1 || Math.abs((panel?.x ?? 0) + (panel?.width ?? 0) - ((anchor?.x ?? 0) + (anchor?.width ?? 0))) <= 1, 'lined up with one of its edges').toBe(true);
  await expectInsideViewport(page, 'how-to-play-popover', DESKTOP);
  await expect(page.locator('.sheet__backdrop')).toHaveCount(0);
  const firstRow = page.getByTestId('player-item').first();
  const rowBox = await firstRow.boundingBox();
  const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="player-item"]') !== null, [(rowBox?.x ?? 0) + 24, (rowBox?.y ?? 0) + (rowBox?.height ?? 0) / 2]);
  expect(under, 'the players list is not covered').toBe(true);

  // The host switches the game while the card is open: the card follows, to a card table's hands.
  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="blackjack"]').click();
  await expect(page.getByTestId('game-picker')).toHaveAttribute('data-game', 'blackjack');
  await expect(page.getByRole('dialog', { name: 'How to play Blackjack' })).toBeVisible();
  await expect(card.getByTestId('rules-name')).toHaveText('Blackjack');
  await expect(card.getByTestId('rules-section').first()).toContainText('How a hand goes');
  await expect(card).toContainText(`stands on every ${DEALER_STANDS_AT}`);
  await expect(page.getByTestId('game-picker-meta')).toHaveCount(0);
  await expect(host.page.getByTestId('game-picker-meta')).toHaveText('Blackjack · 1+ players');

  // Escape closes it and hands the focus back to the button.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('how-to-play-popover')).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)).toBe('how-to-play');

  // The host's own card follows a tile press too, instead of closing: back to The Spy Game for the rest of the party.
  const hostButton = host.page.getByTestId('how-to-play');
  await hostButton.click();
  await expect(host.page.getByRole('dialog', { name: 'How to play Blackjack' })).toBeVisible();
  await host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="spygame"]').click();
  for (const p of players) await expect(p.page.getByTestId('game-picker')).toHaveAttribute('data-game', 'spygame');
  await expect(host.page.getByRole('dialog', { name: 'How to play The Spy Game' })).toBeVisible();
  await expect(hostButton).toHaveAttribute('aria-expanded', 'true');
  await host.page.keyboard.press('Escape');
  await expect(host.page.getByTestId('how-to-play-popover')).toHaveCount(0);

  // On a 1024x768 desktop the host's button sits low: the card opens over it rather than hide Start under the footer.
  await host.page.setViewportSize(LANDSCAPE_TABLET);
  await hostButton.click();
  const lowPanel = await host.page.getByTestId('how-to-play-popover').boundingBox();
  const footer = await host.page.getByTestId('lobby-footer').boundingBox();
  expect((lowPanel?.y ?? 0) + (lowPanel?.height ?? 0), 'the card ends above the footer').toBeLessThanOrEqual((footer?.y ?? 0) + 0.5);
  await expectInsideViewport(host.page, 'how-to-play-popover', LANDSCAPE_TABLET);
  await expect(host.page.getByTestId('rules-section')).toHaveCount(5);
  await host.page.keyboard.press('Escape');
  await expect(host.page.getByTestId('how-to-play-popover')).toHaveCount(0);
  await host.page.setViewportSize(DESKTOP);

  // On a phone the rules come up in the sheet; the button is a 44px target that fits beside the picker at 390 and 320.
  for (const size of [PORTRAIT, SMALL]) {
    await pia.page.setViewportSize(size);
    const phoneButton = pia.page.getByTestId('how-to-play');
    const box = await phoneButton.boundingBox();
    expect(box?.height ?? 0, `${size.width}: a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect((box?.x ?? 0) + (box?.width ?? 0), `${size.width}: fits the screen`).toBeLessThanOrEqual(size.width + 0.5);
    const note = await pia.page.getByTestId('game-picker-note').boundingBox();
    expect(box?.y ?? 0, `${size.width}: under who picks, never over it`).toBeGreaterThanOrEqual((note?.y ?? 0) + (note?.height ?? 0) - 0.5);
    await noHorizontalOverflow(pia.page, size.width);
    await phoneButton.click();
    const sheet = pia.page.getByRole('dialog', { name: 'How to play The Spy Game' });
    await expect(sheet).toHaveAttribute('data-testid', 'how-to-play-sheet');
    await expect(pia.page.getByTestId('how-to-play-card')).toHaveAttribute('data-mode', 'sheet');
    await expect(sheet.getByTestId('rules-name')).toHaveText('The Spy Game');
    await expect(sheet.getByTestId('rules-section')).toHaveCount(5);
    await expectInsideViewport(pia.page, 'how-to-play-sheet-close', size);
    await pia.page.keyboard.press('Escape');
    await expect(pia.page.getByTestId('how-to-play-sheet')).toHaveCount(0);
    await expect.poll(() => pia.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)).toBe('how-to-play');
  }
  await pia.page.setViewportSize(PORTRAIT);
  // The host's button, beside the game's line under the tiles, is a 44px target on a small phone too.
  for (const size of [PORTRAIT, SMALL]) {
    await host.page.setViewportSize(size);
    await host.page.evaluate(() => window.scrollTo(0, 0));
    const box = await host.page.getByTestId('how-to-play').boundingBox();
    const meta = await host.page.getByTestId('game-picker-meta').boundingBox();
    expect(box?.height ?? 0, `${size.width}: the host's button is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width + 0.5);
    // One row: the line ends before the button, which stays in the first screen above the sticky footer.
    expect((meta?.x ?? 0) + (meta?.width ?? 0), `${size.width}: the line ends before the button`).toBeLessThanOrEqual((box?.x ?? 0) + 0.5);
    const hostFooter = await host.page.getByTestId('lobby-footer').boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0), `${size.width}: the button is above the footer without scrolling`).toBeLessThanOrEqual((hostFooter?.y ?? 0) + 0.5);
    await noHorizontalOverflow(host.page, size.width);
  }
  await host.page.setViewportSize(DESKTOP);
});

test('one player sits out, the host sets Unhinged, three play a one-round Spy Game while the fourth watches from the party', async () => {
  test.setTimeout(90_000);
  await rae.page.getByTestId('sitout-toggle').click();
  await expect(rae.page.getByTestId('ready-controls')).toHaveAttribute('data-sitting-out', 'true');
  // Sitting out: only Count me in, with the hint; no disabled ready button next to it.
  await expect(rae.page.getByTestId('ready-toggle')).toHaveCount(0);
  await expect(rae.page.getByTestId('sitout-toggle')).toHaveText('Count me in');
  await expect(rae.page.getByTestId('sitout-hint')).toHaveText("You’ll watch the next game.");
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
  await expect(rae.page.getByTestId('ready-toggle')).toContainText("You’re ready");
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
