import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createParty, joinByCode, readyAll } from './party';

/**
 * Hangman on the screens that squeeze it: a 1280x800 desktop host, a 320x568 phone (the smallest
 * one supported) and a phone turned sideways (844x390). Each role's controls must be on screen
 * when its turn opens, without scrolling: the keys for a guesser, the tools and Done for the
 * hangman, the word for everyone. Serial: the tests build on each other.
 */
test.describe.configure({ mode: 'serial' });

const DESKTOP = { width: 1280, height: 800 };
const SMALL = { width: 320, height: 568 };
const LANDSCAPE = { width: 844, height: 390 };
const CUSTOM_WORDS = ['banana', 'guitar', 'rocket', 'castle', 'pirate', 'window', 'jungle', 'pillow', 'cactus', 'dragon', 'helmet'];

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  viewport: { width: number; height: number };
  errors: string[];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const players: Player[] = [];
let host: Player;
let pia: Player;
let quinn: Player;

async function newPlayer(browser: Browser, name: string, viewport: { width: number; height: number }, phone: boolean): Promise<Player> {
  const context = await browser.newContext(phone ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`${name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${name}: ${msg.text()}`);
  });
  const player: Player = { name, context, page, viewport, errors };
  players.push(player);
  return player;
}

function key(p: Player, letter: string): Locator {
  return p.page.locator(`[data-testid="letter-key"][data-letter="${letter}"]`);
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

/** The element is wholly inside the viewport: on screen without scrolling. */
async function expectOnScreen(p: Player, locator: Locator, what: string): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await boxOf(locator);
  expect(box.y, `${p.name}: ${what} starts on screen`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${p.name}: ${what} ends on screen (${Math.round(box.y + box.height)} of ${p.viewport.height})`).toBeLessThanOrEqual(p.viewport.height + 0.5);
  expect(box.x, `${p.name}: ${what} starts on screen (x)`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${p.name}: ${what} ends on screen (x)`).toBeLessThanOrEqual(p.viewport.width + 0.5);
}

async function columnScrollTop(p: Player): Promise<number> {
  return p.page.getByTestId('hangman-column').evaluate((el) => el.scrollTop);
}

async function scrollColumn(p: Player, top: number): Promise<void> {
  await p.page.getByTestId('hangman-column').evaluate((el, y) => el.scrollTo({ top: y }), top);
}

async function drawStroke(p: Player, fromX = 0.25, toX = 0.65, y = 0.9): Promise<void> {
  const box = await boxOf(p.page.getByTestId('canvas'));
  await p.page.mouse.move(box.x + box.width * fromX, box.y + box.height * y);
  await p.page.mouse.down();
  await p.page.mouse.move(box.x + box.width * toX, box.y + box.height * y, { steps: 12 });
  await p.page.mouse.up();
}

async function guessWord(p: Player, text: string): Promise<void> {
  await expect(p.page.getByTestId('guess-prompt')).toBeVisible();
  await p.page.getByTestId('guess-mode').click();
  await p.page.getByTestId('word-input').fill(text);
  await p.page.getByTestId('word-send').click();
}

async function secretWordOf(hangman: Player): Promise<string> {
  const word = await hangman.page.getByTestId('hangman-word').getAttribute('data-word');
  expect(word).toBeTruthy();
  return word ?? '';
}

/** The hangman's turn opened: everything they need to draw is on screen, the canvas at the top of the column. */
async function expectDrawingFits(p: Player, section: number): Promise<void> {
  await expect(p.page.getByTestId('draw-bar')).toHaveAttribute('data-section', String(section));
  for (const id of ['canvas', 'toolbar', 'tool-undo', 'draw-done']) await expectOnScreen(p, p.page.getByTestId(id), id);
  const column = await boxOf(p.page.getByTestId('hangman-column'));
  const canvas = await boxOf(p.page.getByTestId('canvas'));
  expect(canvas.y, `${p.name}: the canvas is not scrolled under the header`).toBeGreaterThanOrEqual(column.y - 1);
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana', DESKTOP, false);
  pia = await newPlayer(browser, 'Pia', SMALL, true);
  quinn = await newPlayer(browser, 'Quinn', LANDSCAPE, true);
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the party starts; the small phone shows the whole round indicator', async () => {
  const code = await createParty(host.page, host.name, 'hangman');
  for (const p of [pia, quinn]) await joinByCode(p.page, p.name, code);
  await host.page.getByTestId('settings-guessSeconds').fill('60');
  await host.page.getByTestId('settings-drawSeconds').fill('60');
  await host.page.getByTestId('settings-customWords').fill(CUSTOM_WORDS.join('\n'));
  await host.page.getByTestId('settings-customWords').blur();
  await host.page.getByTestId('settings-row-customWordsOnly').click();
  await expect(pia.page.getByTestId('settings-customWordsOnly')).toBeChecked();
  await readyAll([pia.page, quinn.page]);
  await host.page.getByTestId('start-game').click();
  for (const p of players) await expect(p.page.getByTestId('hangman-screen')).toHaveAttribute('data-phase', 'choosing');

  const round = pia.page.getByTestId('round-indicator').locator('.gbar__status');
  await expect(round).toContainText('Round 1/1');
  const truncated = await round.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(truncated, 'the round indicator is not cut short at 320px').toBe(false);
  await expect.poll(() => pia.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(SMALL.width);
});

test('the small phone guesser opens on the word with the whole keyboard on screen, and "Risk the word" opens the keyboard', async () => {
  await host.page.getByTestId('custom-word-input').fill('ice cream');
  await host.page.getByTestId('custom-word-send').click();
  await expect(pia.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  expect(await columnScrollTop(pia)).toBe(0);
  await expectOnScreen(pia, pia.page.getByTestId('hangman-strip'), 'the word strip');
  await expectOnScreen(pia, pia.page.getByTestId('canvas'), 'the canvas');
  for (const letter of ['A', 'M', 'Y', 'Z']) await expectOnScreen(pia, key(pia, letter), `key ${letter}`);
  await expectOnScreen(pia, pia.page.getByTestId('guess-mode'), 'the word button');
  // Seven keys per row at 320px: at least 36px wide and 44px tall (the Pocket Party letter grid).
  for (const letter of ['A', 'G', 'H', 'Z']) {
    const box = await boxOf(key(pia, letter));
    expect(box.width).toBeGreaterThanOrEqual(36);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // A to G share the first row; H starts the second.
  expect((await boxOf(key(pia, 'G'))).y).toBeCloseTo((await boxOf(key(pia, 'A'))).y, 0);
  expect((await boxOf(key(pia, 'H'))).y).toBeGreaterThan((await boxOf(key(pia, 'A'))).y);

  // One tap on "Risk the word" focuses the tiles (the native keyboard opens from the tap).
  await pia.page.getByTestId('guess-mode').tap();
  await expect(pia.page.getByTestId('word-input')).toBeFocused();
  await pia.page.getByTestId('guess-mode').tap();
  await expect(key(pia, 'E')).toBeVisible();
  await key(pia, 'E').tap();
  await expect(pia.page.getByTestId('hangman-mask')).toHaveAttribute('data-mask', '__E __E__');
});

test('the desktop hangman draws with the canvas, the tools and Done on one screen; the caption keeps clear of the strokes', async () => {
  await expect(quinn.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  for (const letter of ['A', 'Z']) await expectOnScreen(quinn, key(quinn, letter), `key ${letter}`);
  await key(quinn, 'Z').tap();
  await expectDrawingFits(host, 1);
  await expect(host.page.getByTestId('guess-panel')).toHaveCount(0);

  // The phones' caption sits in the canvas's top right corner and leaves once the section has a stroke.
  for (const p of [pia, quinn]) {
    const caption = await boxOf(p.page.getByTestId('drawing-caption'));
    const canvas = await boxOf(p.page.getByTestId('canvas'));
    expect(caption.y, `${p.name}: caption at the top`).toBeLessThan(canvas.y + canvas.height / 3);
    expect(caption.x + caption.width, `${p.name}: caption at the right`).toBeGreaterThan(canvas.x + canvas.width * 0.6);
  }
  await drawStroke(host);
  for (const p of [pia, quinn]) await expect(p.page.getByTestId('drawing-caption')).toHaveCount(0);
  // Scrolling the column before Done must not leave the next section's canvas out of view.
  await scrollColumn(host, 400);
  await host.page.getByTestId('draw-done').click();
  await expect(host.page.getByTestId('hangman-screen')).toHaveAttribute('data-phase', 'guessing');
  // The desktop guesser's keys fit too (Z is the last).
  await guessWord(pia, 'ice cubes');
  await expectDrawingFits(host, 2);
  await host.page.getByTestId('draw-done').click();
  await expect(quinn.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  await guessWord(quinn, 'ice cream');
  for (const p of players) await expect(p.page.getByTestId('overlay-turn-end')).toHaveAttribute('data-outcome', 'solved');
});

test('the small phone hangman draws with the canvas at the top and Done on screen, section after section', async () => {
  await expect(pia.page.getByTestId('word-choice').first()).toBeVisible({ timeout: 15_000 });
  await pia.page.getByTestId('word-choice').first().tap();
  const word = await secretWordOf(pia);
  await expect(host.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  for (const letter of ['A', 'Z']) await expectOnScreen(host, key(host, letter), `key ${letter}`);
  const missing = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => !word.includes(l));
  await host.page.keyboard.press(missing[0]);
  await expectDrawingFits(pia, 1);
  await expect.poll(() => pia.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(SMALL.width);
  await drawStroke(pia);
  // Scrolled to the bottom to press Done: the next section opens with the canvas back in view.
  await scrollColumn(pia, 1000);
  await pia.page.getByTestId('draw-done').tap();
  await expect(quinn.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  await key(quinn, missing[1]).tap();
  await expectDrawingFits(pia, 2);
  await pia.page.getByTestId('draw-done').tap();
  // Her guess again: the column is back at the top, with the word.
  await expect(host.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  await guessWord(host, word.toLowerCase());
  for (const p of players) await expect(p.page.getByTestId('overlay-turn-end')).toHaveAttribute('data-outcome', 'solved');
});

test('the landscape hangman has the tools beside the canvas: canvas, tools and Done all on screen', async () => {
  await expect(quinn.page.getByTestId('word-choice').first()).toBeVisible({ timeout: 15_000 });
  await quinn.page.getByTestId('word-choice').first().tap();
  const word = await secretWordOf(quinn);
  await expect(host.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  const missing = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((l) => !word.includes(l)) ?? 'Z';
  await host.page.keyboard.press(missing);
  await expectDrawingFits(quinn, 1);
  await expect(quinn.page.getByTestId('hangman-tools')).toBeVisible();
  const canvas = await boxOf(quinn.page.getByTestId('canvas'));
  const tools = await boxOf(quinn.page.getByTestId('hangman-tools'));
  expect(tools.x, 'the tools sit beside the canvas, not under it').toBeGreaterThanOrEqual(canvas.x + canvas.width - 1);
  await drawStroke(quinn);
  await quinn.page.getByTestId('draw-done').tap();
  await expect(pia.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  expect(await columnScrollTop(pia)).toBe(0);
  await guessWord(pia, word.toLowerCase());
  for (const p of players) await expect(p.page.getByTestId('overlay-game-end')).toBeVisible({ timeout: 15_000 });
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
