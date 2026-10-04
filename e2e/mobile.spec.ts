import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * A desktop host and a phone guest (390x844, touch, 3x) share a two-player room. The phone is
 * checked as a guesser (typing into the word tiles, the non-scrolling layout with and without the
 * keyboard, landscape, the players sheet) and as the drawer (44px toolbar, pointer drawing).
 *
 * With two players and one round everybody draws exactly once, so whichever role the phone gets
 * first, both are covered: a phone drawer plays its turn out right away and the guesser checks run
 * in the following turn; a phone guesser runs the checks first and draws in the second turn.
 */
test.describe.configure({ mode: 'serial' });

const PORTRAIT = { width: 390, height: 844 };
/** Roughly what is left of a 390x844 phone once the keyboard is open. */
const KEYBOARD = { width: 390, height: 540 };
const LANDSCAPE = { width: 844, height: 390 };
const MIN_TARGET = 44;

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Uncaught exceptions and console errors, checked at the end. */
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
let phone: Player;
let roomCode = '';
let phoneHasDrawn = false;
/** The word the host is drawing while the phone runs its guesser checks. */
let currentWord = '';

async function newPlayer(context: BrowserContext, name: string): Promise<Player> {
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

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

/** Asserts the element sits inside the viewport of the given size (half a pixel of rounding allowed). */
async function expectInsideViewport(locator: Locator, size: { width: number; height: number }, label: string): Promise<Box> {
  const box = await boxOf(locator);
  const bottom = box.y + box.height;
  const right = box.x + box.width;
  expect(box.width, `${label} has a width`).toBeGreaterThan(0);
  expect(box.height, `${label} has a height`).toBeGreaterThan(0);
  expect(box.y, `${label} top edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(-0.5);
  expect(bottom, `${label} bottom edge (${Math.round(bottom)}) within ${size.height}`).toBeLessThanOrEqual(size.height + 0.5);
  expect(right, `${label} right edge (${Math.round(right)}) within ${size.width}`).toBeLessThanOrEqual(size.width + 0.5);
  return box;
}

async function pageMetrics(page: Page): Promise<{ scrollWidth: number; scrollX: number; scrollY: number; isApp: boolean }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    isApp: document.documentElement.classList.contains('is-app'),
  }));
}

async function expectNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  await expect.poll(async () => (await pageMetrics(page)).scrollWidth, { message: 'document.scrollWidth' }).toBeLessThanOrEqual(width);
  expect((await pageMetrics(page)).scrollX).toBe(0);
}

async function expectTallEnough(locator: Locator, label: string): Promise<void> {
  const box = await boxOf(locator);
  expect(box.height, `${label} is a ${MIN_TARGET}px+ target (${Math.round(box.height)})`).toBeGreaterThanOrEqual(MIN_TARGET);
}

async function nonWhitePixels(page: Page): Promise<number> {
  return page.getByTestId('canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) count++;
    }
    return count;
  });
}

async function drawStroke(page: Page): Promise<void> {
  const box = await boxOf(page.getByTestId('canvas'));
  const x = (fx: number) => box.x + box.width * fx;
  const y = (fy: number) => box.y + box.height * fy;
  await page.mouse.move(x(0.2), y(0.3));
  await page.mouse.down();
  await page.mouse.move(x(0.5), y(0.7), { steps: 12 });
  await page.mouse.move(x(0.8), y(0.3), { steps: 12 });
  await page.mouse.up();
}

async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('chat-input');
  await input.fill(text);
  await input.press('Enter');
}

async function readWord(drawerPage: Page): Promise<string> {
  const word = await drawerPage.getByTestId('word-plain').locator('.word__text').textContent();
  if (!word) throw new Error('drawer has no word');
  return word.trim();
}

function lettersOf(word: string): string[] {
  return Array.from(word.replace(/[^\p{L}\p{N}]/gu, ''));
}

/** Waits for the choosing overlay and returns whoever sees the word choices. */
async function waitForDrawer(): Promise<Player> {
  let drawer: Player | null = null;
  await expect
    .poll(
      async () => {
        for (const p of players) {
          if (await p.page.getByTestId('word-choice').first().isVisible()) {
            drawer = p;
            return p.name;
          }
        }
        return null;
      },
      { timeout: 25_000, message: 'somebody is choosing a word' },
    )
    .not.toBeNull();
  if (!drawer) throw new Error('unreachable');
  return drawer;
}

/** Picks the first word right away (the choosing timer would pick one after 15s otherwise). */
async function pickFirstWord(drawer: Player): Promise<string> {
  await drawer.page.getByTestId('word-choice').first().click();
  await expect(drawer.page.getByTestId('word-plain')).toBeVisible();
  return readWord(drawer.page);
}

/** The phone draws: a 44px toolbar, pointer strokes that reach the host, and the host ends the turn by guessing. */
async function phoneDrawsOneTurn(): Promise<void> {
  const word = await pickFirstWord(phone);
  expect(word.length).toBeGreaterThan(0);

  const toolbar = phone.page.getByTestId('toolbar');
  await expect(toolbar).toBeVisible();
  await expectInsideViewport(toolbar, PORTRAIT, 'toolbar');
  const buttonHeights = await toolbar.locator('button').evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ id: el.getAttribute('data-testid') ?? el.getAttribute('aria-label'), height: el.getBoundingClientRect().height })),
  );
  expect(buttonHeights.length).toBeGreaterThan(10);
  expect(buttonHeights.filter((b) => b.height < MIN_TARGET), 'toolbar buttons shorter than 44px').toEqual([]);
  await expectInsideViewport(phone.page.getByTestId('canvas'), PORTRAIT, 'drawer canvas');
  await expectNoHorizontalOverflow(phone.page, PORTRAIT.width);
  await expect(phone.page.getByTestId('word-plain')).toContainText(word);
  await expect(host.page.getByTestId('word-mask')).toBeVisible();

  expect(await nonWhitePixels(host.page)).toBe(0);
  await drawStroke(phone.page);
  expect(await nonWhitePixels(phone.page)).toBeGreaterThan(0);
  await expect.poll(() => nonWhitePixels(host.page), { timeout: 3_000, message: 'the host canvas receives the stroke' }).toBeGreaterThan(0);

  await sendChat(host.page, word);
  await expect(phone.page.getByTestId('overlay-turn-end')).toBeVisible();
  await expect(phone.page.getByTestId('overlay-turn-end')).toContainText(word);
  await expectInsideViewport(phone.page.getByTestId('overlay-turn-end').locator('.overlay__card'), PORTRAIT, 'turn-end card');
  phoneHasDrawn = true;
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const phoneContext = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  host = await newPlayer(hostContext, 'Alice');
  phone = await newPlayer(phoneContext, 'Bob');
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the phone home screen fits the viewport and its primary buttons are 44px targets', async () => {
  await phone.page.goto('/');
  await expect(phone.page.getByTestId('home-create')).toBeVisible();
  await expect(phone.page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
  await expectNoHorizontalOverflow(phone.page, PORTRAIT.width);
  for (const id of ['home-create', 'home-join', 'home-name', 'code-input-0']) {
    await expectTallEnough(phone.page.getByTestId(id), id);
  }
  const nameFontSize = await phone.page.getByTestId('home-name').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(nameFontSize, 'inputs are at least 16px so iOS does not zoom on focus').toBeGreaterThanOrEqual(16);
});

test('the host creates a room and the phone joins by typing the code', async () => {
  await host.page.goto('/');
  await host.page.getByTestId('home-name').fill(host.name);
  await host.page.getByTestId('home-create').click();
  const codeEl = host.page.getByTestId('room-code');
  await expect(codeEl).toBeVisible();
  roomCode = ((await codeEl.textContent()) ?? '').replace(/\s+/g, '');
  expect(roomCode).toHaveLength(4);

  await phone.page.getByTestId('home-name').fill(phone.name);
  // The four boxes auto-advance, so typing on the first one fills them all.
  await phone.page.getByTestId('code-input-0').pressSequentially(roomCode, { delay: 20 });
  await expect(phone.page.getByTestId('room-preview')).toContainText(/1\/\d+ players/);
  await phone.page.getByTestId('home-join').click();
  await expect(phone.page.getByTestId('room-code')).toHaveText(roomCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  await expect(phone.page.getByTestId('player-item')).toHaveCount(2);
});

test('the phone lobby fits the viewport, with 44px buttons and a share button', async () => {
  await expect.poll(async () => (await pageMetrics(phone.page)).scrollY, { message: 'lobby starts at the top' }).toBe(0);
  await expectNoHorizontalOverflow(phone.page, PORTRAIT.width);
  expect((await pageMetrics(phone.page)).isApp, 'the lobby page may scroll').toBe(false);
  for (const id of ['copy-code', 'copy-link', 'share-invite', 'leave-room']) {
    await expect(phone.page.getByTestId(id)).toBeVisible();
    await expectTallEnough(phone.page.getByTestId(id), id);
  }
  await expectTallEnough(phone.page.getByTestId('chat-send'), 'lobby chat send');
});

test('the host sets one round of 80 seconds and starts', async () => {
  await host.page.getByTestId('settings-rounds').fill('1');
  await host.page.getByTestId('settings-drawTime').fill('80');
  await expect(phone.page.getByTestId('settings-value-rounds')).toHaveText('1');
  await expect(phone.page.getByTestId('settings-value-drawTime')).toHaveText('80s');
  await host.page.getByTestId('start-game').click();
});

test('the first drawer picks a word; a phone drawer plays its turn out first', async () => {
  const drawer = await waitForDrawer();
  await expect.poll(async () => (await pageMetrics(phone.page)).isApp, { message: 'html.is-app during the game' }).toBe(true);
  if (drawer === phone) {
    await expectInsideViewport(phone.page.getByTestId('overlay-choosing').locator('.overlay__card'), PORTRAIT, 'choosing card');
    await phoneDrawsOneTurn();
    // Second turn: the host draws and the phone guesses.
    const next = await waitForDrawer();
    expect(next).toBe(host);
  }
  await expect(phone.page.getByTestId('overlay-choosing')).toContainText(`${host.name} is choosing`);
  currentWord = await pickFirstWord(host);
  await expect(phone.page.getByTestId('guess-tiles')).toBeVisible();
  await expect(phone.page.getByTestId('toolbar')).toHaveCount(0);
});

test('the phone guesser types into the blanks: one tile per letter, no header mask', async () => {
  const letters = lettersOf(currentWord);
  const tiles = phone.page.getByTestId('guess-tile');
  await expect(tiles).toHaveCount(letters.length);
  // The header mask stays hidden on a phone; the tiles in the guess bar are the word.
  await expect(phone.page.getByTestId('word-mask')).toBeHidden();
  await expect(host.page.getByTestId('word-plain')).toBeVisible();

  const input = phone.page.getByTestId('chat-input');
  await expect(input).toHaveAttribute('enterkeyhint', 'send');
  await expect(input).toHaveAttribute('autocapitalize', 'off');
  await expect(input).toHaveAttribute('autocorrect', 'off');
  await expect(input).toHaveAttribute('spellcheck', 'false');
  const inputStyle = await input.evaluate((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return { display: cs.display, visibility: cs.visibility, fontSize: parseFloat(cs.fontSize), width: rect.width, height: rect.height, x: rect.x, y: rect.y };
  });
  expect(inputStyle.display).not.toBe('none');
  expect(inputStyle.visibility).not.toBe('hidden');
  expect(inputStyle.fontSize).toBeGreaterThanOrEqual(16);
  expect(inputStyle.width).toBeGreaterThan(100);
  expect(inputStyle.height).toBeGreaterThan(40);
  expect(inputStyle.x).toBeGreaterThanOrEqual(0);
  expect(inputStyle.y).toBeGreaterThanOrEqual(0);

  // Tapping the tiles focuses the real input; the keystrokes land in the tiles.
  await phone.page.getByTestId('guess-tiles').click();
  await expect(input).toBeFocused();
  await phone.page.keyboard.type('ab');
  await expect(tiles.nth(0)).toHaveAttribute('data-filled', 'true');
  await expect(tiles.nth(0)).toHaveAttribute('data-char', 'a');
  await expect(tiles.nth(0)).toHaveText(/^a$/i);
  await expect(tiles.nth(1)).toHaveAttribute('data-filled', 'true');
  await expect(tiles.nth(1)).toHaveAttribute('data-char', 'b');
  await expect(tiles.nth(1)).toHaveText(/^b$/i);
  if (letters.length > 2) await expect(tiles.nth(2)).toHaveAttribute('data-filled', 'false');
  await expect(phone.page.locator('[data-testid="guess-tile"][data-filled="true"]')).toHaveCount(2);

  await phone.page.keyboard.press('Backspace');
  await expect(tiles.nth(1)).toHaveAttribute('data-filled', 'false');
  await expect(tiles.nth(1)).toHaveAttribute('data-char', '');
  await expect(tiles.nth(0)).toHaveAttribute('data-filled', 'true');
  await expect(phone.page.locator('[data-testid="guess-tile"][data-filled="true"]')).toHaveCount(1);
  await expect(input).toBeFocused();
});

test('the phone layout never scrolls: portrait, with the keyboard open, and in landscape', async () => {
  const canvas = phone.page.getByTestId('canvas');
  const log = phone.page.getByTestId('chat-log');
  const guessBar = phone.page.getByTestId('guess-form');

  // Portrait: everything on one screen.
  await expectNoHorizontalOverflow(phone.page, PORTRAIT.width);
  expect((await pageMetrics(phone.page)).scrollY).toBe(0);
  const canvasBox = await expectInsideViewport(canvas, PORTRAIT, 'canvas');
  const logBox = await expectInsideViewport(log, PORTRAIT, 'chat log');
  const barBox = await expectInsideViewport(guessBar, PORTRAIT, 'guess bar');
  expect(canvasBox.width, 'the canvas uses the phone width').toBeGreaterThanOrEqual(PORTRAIT.width - 40);
  expect(logBox.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height);
  expect(barBox.y, 'the guess bar is below the log').toBeGreaterThanOrEqual(logBox.y + logBox.height - 1);
  expect(barBox.y + barBox.height, 'the guess bar is pinned near the bottom').toBeGreaterThan(PORTRAIT.height - 40);

  // The keyboard opens: the visual viewport shrinks and the guess bar must stay above it.
  await phone.page.setViewportSize(KEYBOARD);
  await expect
    .poll(async () => {
      const box = await guessBar.boundingBox();
      return box ? box.y + box.height : Number.POSITIVE_INFINITY;
    }, { message: 'guess bar bottom with the keyboard open' })
    .toBeLessThanOrEqual(KEYBOARD.height + 0.5);
  expect((await pageMetrics(phone.page)).scrollY).toBe(0);
  await expectNoHorizontalOverflow(phone.page, KEYBOARD.width);
  const keyboardCanvas = await expectInsideViewport(canvas, KEYBOARD, 'canvas with keyboard');
  expect(keyboardCanvas.height, 'the canvas is still readable with the keyboard').toBeGreaterThan(120);
  await expectInsideViewport(log, KEYBOARD, 'chat log with keyboard');
  await expect(phone.page.getByTestId('chat-input')).toBeFocused();

  // Landscape phone: canvas and guess bar side by side, still no scrolling.
  await phone.page.setViewportSize(LANDSCAPE);
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox();
      return box ? box.y + box.height : Number.POSITIVE_INFINITY;
    }, { message: 'canvas bottom in landscape' })
    .toBeLessThanOrEqual(LANDSCAPE.height + 0.5);
  await expectNoHorizontalOverflow(phone.page, LANDSCAPE.width);
  expect((await pageMetrics(phone.page)).scrollY).toBe(0);
  const landscapeCanvas = await expectInsideViewport(canvas, LANDSCAPE, 'landscape canvas');
  const landscapeBar = await expectInsideViewport(guessBar, LANDSCAPE, 'landscape guess bar');
  expect(landscapeCanvas.height).toBeGreaterThan(150);
  expect(landscapeBar.x, 'the guess bar sits beside the canvas in landscape').toBeGreaterThanOrEqual(landscapeCanvas.x + landscapeCanvas.width - 1);
  await expect(phone.page.getByTestId('guess-tile').first()).toBeVisible();

  // Back to portrait for the rest of the run.
  await phone.page.setViewportSize(PORTRAIT);
  await expect
    .poll(async () => {
      const box = await guessBar.boundingBox();
      return box ? box.y + box.height : 0;
    }, { message: 'guess bar back at the bottom in portrait' })
    .toBeGreaterThan(PORTRAIT.height - 40);
  await expectInsideViewport(canvas, PORTRAIT, 'canvas back in portrait');
  expect((await pageMetrics(phone.page)).isApp).toBe(true);
});

test('the players button opens a sheet with both players and the backdrop closes it', async () => {
  const toggle = phone.page.getByTestId('players-toggle');
  await expectTallEnough(toggle, 'players button');
  await expect(toggle).toContainText('2');
  await toggle.click();
  const sheet = phone.page.getByTestId('players-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('player-item')).toHaveCount(2);
  await expect(sheet).toContainText(host.name);
  await expect(sheet).toContainText(phone.name);
  // The panel slides in over 0.2s: wait for it to settle before measuring.
  const panel = sheet.locator('.sheet__panel');
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return box ? box.y + box.height : Number.POSITIVE_INFINITY;
    }, { message: 'players sheet panel bottom' })
    .toBeLessThanOrEqual(PORTRAIT.height + 0.5);
  await expectInsideViewport(panel, PORTRAIT, 'players sheet panel');
  // The dimmed area above the panel.
  await phone.page.getByTestId('players-sheet-backdrop').click({ position: { x: 12, y: 12 } });
  await expect(sheet).toHaveCount(0);
  await expect(phone.page.getByTestId('guess-tiles')).toBeVisible();
});

test('the phone guesser fills every tile with the word, submits with Enter and keeps a focused chat input', async () => {
  const letters = lettersOf(currentWord);
  const tiles = phone.page.getByTestId('guess-tile');
  const input = phone.page.getByTestId('chat-input');
  await phone.page.getByTestId('guess-tiles').click();
  await expect(input).toBeFocused();
  await input.fill(currentWord);
  await expect(phone.page.locator('[data-testid="guess-tile"][data-filled="true"]')).toHaveCount(letters.length);
  const typed = await tiles.evaluateAll((els) => els.map((el) => el.getAttribute('data-char') ?? ''));
  expect(typed.map((c) => c.toLowerCase())).toEqual(letters.map((c) => c.toLowerCase()));
  await expect(phone.page.getByTestId('guess-overflow')).toHaveCount(0);

  await phone.page.keyboard.press('Enter');
  const correct = phone.page.locator('[data-testid="chat-message"][data-kind="correct"]');
  await expect(correct.last()).toContainText(`${phone.name} guessed the word!`);
  await expect(host.page.getByTestId('chat-log')).toContainText(`${phone.name} guessed the word!`);
  await expect(phone.page.getByTestId('word-plain')).toContainText(currentWord);
  await expect(phone.page.getByTestId('guess-tiles')).toHaveCount(0);
  // The plain chat input takes over under the same test id and keeps the focus (the keyboard stays open).
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('enterkeyhint', 'send');
  await expectInsideViewport(input, PORTRAIT, 'plain chat input');
  // The phone was the only guesser, so the turn is over.
  await expect(phone.page.getByTestId('overlay-turn-end')).toBeVisible();
  await expect(phone.page.getByTestId('overlay-turn-end')).toContainText(currentWord);
  await expectInsideViewport(phone.page.getByTestId('overlay-turn-end').locator('.overlay__card'), PORTRAIT, 'turn-end card');
});

test('the phone draws in the second turn if it has not drawn yet, then the podium fits the screen', async () => {
  if (!phoneHasDrawn) {
    const drawer = await waitForDrawer();
    expect(drawer).toBe(phone);
    await expectInsideViewport(phone.page.getByTestId('overlay-choosing').locator('.overlay__card'), PORTRAIT, 'choosing card');
    await phoneDrawsOneTurn();
  }
  expect(phoneHasDrawn).toBe(true);
  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible({ timeout: 15_000 });
    await expect(end.getByTestId('podium-entry')).toHaveCount(2);
  }
  await expectInsideViewport(phone.page.getByTestId('overlay-game-end').locator('.overlay__card'), PORTRAIT, 'game-end card');
  await expectNoHorizontalOverflow(phone.page, PORTRAIT.width);
});

test('leaving the game drops the app mode so the home page scrolls again', async () => {
  await phone.page.getByTestId('game-menu').click();
  await expect(phone.page.getByTestId('menu-sheet')).toBeVisible();
  await phone.page.getByTestId('menu-sheet').getByTestId('leave-room').click();
  await expect(phone.page.getByTestId('home-create')).toBeVisible();
  await expect.poll(async () => (await pageMetrics(phone.page)).isApp).toBe(false);
  await expect(host.page.getByTestId('chat-log')).toContainText(`${phone.name} left`);
});

test('no page errors were raised in either browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
