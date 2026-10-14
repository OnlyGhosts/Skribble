import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createParty, joinByCode, readyAll } from './party';

/**
 * A whole one-round Hangman between a desktop host and two phones (390x844, touch): the host
 * types their own word, the phones guess letters and words, the host draws sections of the figure
 * (with undo and a section-scoped clear), a wrong word puts a guesser out, a solve pays the bonus,
 * then each phone is the hangman once and the podium ranks all three. Serial: the tests build on
 * each other.
 */
test.describe.configure({ mode: 'serial' });

const PORTRAIT = { width: 390, height: 844 };
const MIN_TARGET = 44;
const WORD = 'ICE CREAM';
const CUSTOM_WORDS = ['banana', 'guitar', 'rocket', 'castle', 'pirate', 'window', 'jungle', 'pillow', 'cactus', 'dragon', 'helmet'];

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
let roomCode = '';

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

const phones = (): Player[] => players.filter((p) => p !== host);

function key(p: Player, letter: string): Locator {
  return p.page.locator(`[data-testid="letter-key"][data-letter="${letter}"]`);
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

async function noHorizontalOverflow(p: Player): Promise<void> {
  await expect.poll(() => p.page.evaluate(() => document.documentElement.scrollWidth), { message: `${p.name}: document.scrollWidth` }).toBeLessThanOrEqual(PORTRAIT.width);
}

async function nonWhitePixels(p: Player): Promise<number> {
  return p.page.getByTestId('canvas').evaluate((el) => {
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

/** A horizontal stroke across the lower part of the canvas (where the base of the figure goes). */
async function drawStroke(p: Player, fromX = 0.25, toX = 0.65, y = 0.9): Promise<void> {
  // The column scrolls (a click on the toolbar may have scrolled the canvas half under the header).
  await p.page.getByTestId('canvas').scrollIntoViewIfNeeded();
  const box = await boxOf(p.page.getByTestId('canvas'));
  await p.page.mouse.move(box.x + box.width * fromX, box.y + box.height * y);
  await p.page.mouse.down();
  await p.page.mouse.move(box.x + box.width * toX, box.y + box.height * y, { steps: 12 });
  await p.page.mouse.up();
}

/** Guesses the whole word from the keys panel's word mode. */
async function guessWord(p: Player, text: string): Promise<void> {
  await expect(p.page.getByTestId('guess-prompt')).toBeVisible();
  await p.page.getByTestId('guess-mode').click();
  await p.page.getByTestId('word-input').fill(text);
  await p.page.getByTestId('word-send').click();
}

/** The secret word as the hangman's page shows it (and nobody else's). */
async function secretWordOf(hangman: Player): Promise<string> {
  const word = await hangman.page.getByTestId('hangman-word').getAttribute('data-word');
  expect(word).toBeTruthy();
  for (const p of players) {
    if (p === hangman) continue;
    await expect(p.page.getByTestId('hangman-word')).toHaveCount(0);
    await expect(p.page.locator('body')).not.toContainText(word ?? '');
  }
  return word ?? '';
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  quinn = await newPlayer(browser, 'Quinn', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host creates a Hangman party, two phones join by code and the host tunes the settings', async () => {
  roomCode = await createParty(host.page, host.name, 'hangman');
  await expect(host.page.getByTestId('game-picker-meta')).toContainText('Hangman');
  await expect(host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="hangman"]')).toHaveAttribute('aria-checked', 'true');
  for (const p of phones()) await joinByCode(p.page, p.name, roomCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(3);

  await host.page.getByTestId('settings-guessSeconds').fill('60');
  await host.page.getByTestId('settings-drawSeconds').fill('60');
  await host.page.getByTestId('settings-customWords').fill(CUSTOM_WORDS.join('\n'));
  await host.page.getByTestId('settings-customWords').blur();
  await expect(pia.page.getByTestId('settings-value-guessSeconds')).toHaveText('60s');
  await expect(pia.page.getByTestId('settings-value-drawSeconds')).toHaveText('60s');
  await expect(pia.page.getByTestId('settings-customWords-count')).toHaveText('11 words');
  await expect(pia.page.getByTestId('settings-guessSeconds')).toHaveCount(0);
  await host.page.getByTestId('settings-row-customWordsOnly').click();
  await expect(pia.page.getByTestId('settings-customWordsOnly')).toBeChecked();
  await noHorizontalOverflow(pia);

  await expect(host.page.getByTestId('start-game')).toBeDisabled();
  await readyAll([pia.page, quinn.page]);
  await host.page.getByTestId('start-game').click();
  for (const p of players) {
    await expect(p.page.getByTestId('hangman-screen')).toHaveAttribute('data-phase', 'choosing');
    await expect(p.page.getByTestId('round-indicator')).toContainText('Round 1');
  }
});

test('the host is the first hangman: three choices and a custom word for them, "is choosing" for the phones', async () => {
  await expect(host.page.getByTestId('word-choice')).toHaveCount(3);
  await expect(host.page.getByTestId('custom-word-input')).toBeVisible();
  const choices = await host.page.getByTestId('word-choice').allTextContents();
  for (const p of phones()) {
    await expect(p.page.getByTestId('overlay-choosing')).toContainText(`${host.name} is choosing a word`);
    await expect(p.page.getByTestId('word-choice')).toHaveCount(0);
    for (const word of choices) await expect(p.page.locator('body')).not.toContainText(word);
    await noHorizontalOverflow(p);
  }
  await expect(host.page.getByTestId('chat-log')).toContainText(`${host.name} is the hangman`);

  // A word that breaks the rules is refused in the field; the hangman is still choosing.
  await host.page.getByTestId('custom-word-input').fill('ab');
  await host.page.getByTestId('custom-word-send').click();
  await expect(host.page.getByTestId('custom-word-error')).toContainText('3 to 24 letters');
  await expect(host.page.getByTestId('overlay-choosing')).toBeVisible();

  await host.page.getByTestId('custom-word-input').fill('ice cream');
  await host.page.getByTestId('custom-word-send').click();
  for (const p of players) await expect(p.page.getByTestId('hangman-screen')).toHaveAttribute('data-phase', 'guessing');
  expect(await secretWordOf(host)).toBe(WORD);
  for (const p of phones()) await expect(p.page.getByTestId('hangman-mask')).toHaveAttribute('data-mask', '___ _____');
  await expect(host.page.getByTestId('chat-log')).toContainText('The word has 8 letters');
});

test('the phones guess letters in join order: a right letter scores and reveals, a wrong one sends the host to the canvas', async () => {
  // Pia (joined first) guesses first; the keys are 44px targets and the grid fits the phone.
  await expect(pia.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  await expect(pia.page.getByTestId('guess-prompt')).toContainText('Your turn');
  await expect(quinn.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'waiting');
  await expect(quinn.page.getByTestId('guess-status')).toContainText(`${pia.name} is guessing`);
  await expect(host.page.getByTestId('guess-status')).toContainText(`${pia.name} is guessing your word`);
  await expect(pia.page.getByTestId('letter-key')).toHaveCount(26);
  for (const letter of ['A', 'Q', 'Z']) {
    const box = await boxOf(key(pia, letter));
    expect(box.height, `key ${letter} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box.width, `key ${letter} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
  }
  const mode = await boxOf(pia.page.getByTestId('guess-mode'));
  expect(mode.height).toBeGreaterThanOrEqual(MIN_TARGET);
  await expect(key(quinn, 'E')).toBeDisabled();
  await noHorizontalOverflow(pia);

  await key(pia, 'E').click();
  for (const p of players) {
    await expect(p.page.getByTestId('hangman-mask').or(p.page.getByTestId('hangman-word'))).toHaveAttribute('data-mask', '__E __E__');
    await expect(key(p, 'E')).toHaveAttribute('data-state', 'correct');
    await expect(key(p, 'E')).toBeDisabled();
  }
  await expect(host.page.getByTestId('chat-log')).toContainText('E: 2 letters!');
  await expect(host.page.locator(`[data-testid="player-item"][data-name="${pia.name}"]`)).toHaveAttribute('data-score', '20');

  // Quinn is up; Z is not in the word: a life is lost and the host draws section 1.
  await expect(quinn.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  await expect(pia.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'waiting');
  await key(quinn, 'Z').click();
  for (const p of players) {
    await expect(p.page.getByTestId('hangman-screen')).toHaveAttribute('data-phase', 'drawing');
    await expect(p.page.getByTestId('hangman-lives')).toHaveAttribute('data-lives', '9');
    await expect(p.page.getByTestId('wrong-letters')).toHaveAttribute('data-count', '1');
  }
  // The guessers' keys record it; the hangman has the tools instead of the keys while they draw.
  for (const p of phones()) await expect(key(p, 'Z')).toHaveAttribute('data-state', 'wrong');
  await expect(host.page.getByTestId('guess-panel')).toHaveCount(0);
  await expect(host.page.locator(`[data-testid="player-item"][data-name="${host.name}"]`)).toHaveAttribute('data-score', '15');
});

test('the host draws section 1 with the ghost: strokes stream to the phones, undo and clear, then Done', async () => {
  await expect(host.page.getByTestId('draw-bar')).toHaveAttribute('data-section', '1');
  await expect(host.page.getByTestId('draw-bar')).toContainText('Section 1 of 10: the base');
  await expect(host.page.getByTestId('hangman-ghost')).toHaveAttribute('data-section', '1');
  await expect(host.page.getByTestId('toolbar')).toBeVisible();
  await expect(host.page.getByTestId('tool-undo')).toBeDisabled();
  for (const p of phones()) {
    await expect(p.page.getByTestId('hangman-ghost')).toHaveCount(0);
    await expect(p.page.getByTestId('toolbar')).toHaveCount(0);
    await expect(p.page.getByTestId('drawing-caption')).toContainText(`${host.name} is drawing`);
    await expect(p.page.getByTestId('guess-status')).toContainText('is drawing section 1 of 10');
    await expect(p.page.getByTestId('timer')).toBeVisible();
  }

  const before = await nonWhitePixels(pia);
  await drawStroke(host);
  await expect.poll(() => nonWhitePixels(pia), { timeout: 10_000 }).toBeGreaterThan(before + 100);
  await expect.poll(() => nonWhitePixels(quinn), { timeout: 10_000 }).toBeGreaterThan(before + 100);
  await expect(host.page.getByTestId('tool-undo')).toBeEnabled();

  // Undo takes the stroke back everywhere.
  await host.page.getByTestId('tool-undo').click();
  await expect.poll(() => nonWhitePixels(pia), { timeout: 10_000 }).toBeLessThanOrEqual(before);
  await expect(host.page.getByTestId('tool-undo')).toBeDisabled();

  // Two strokes, then clear: the section is empty again (the first section clears like a blank canvas).
  await drawStroke(host, 0.2, 0.5, 0.85);
  await drawStroke(host, 0.5, 0.8, 0.85);
  await expect.poll(() => nonWhitePixels(quinn), { timeout: 10_000 }).toBeGreaterThan(before + 100);
  await host.page.getByTestId('tool-clear').click();
  await host.page.getByTestId('tool-clear-confirm').click();
  await expect.poll(() => nonWhitePixels(quinn), { timeout: 10_000 }).toBeLessThanOrEqual(before);
  await expect.poll(() => nonWhitePixels(host), { timeout: 10_000 }).toBeLessThanOrEqual(before);

  await drawStroke(host);
  await expect.poll(() => nonWhitePixels(pia), { timeout: 10_000 }).toBeGreaterThan(before + 100);
  const done = await boxOf(host.page.getByTestId('draw-done'));
  expect(done.height).toBeGreaterThanOrEqual(MIN_TARGET);
  await host.page.getByTestId('draw-done').click();
  for (const p of players) await expect(p.page.getByTestId('hangman-screen')).toHaveAttribute('data-phase', 'guessing');
  await expect(host.page.getByTestId('toolbar')).toHaveCount(0);
});

test('a wrong word puts Pia out; section 2 clears only its own strokes; Quinn names the word for +180', async () => {
  await expect(pia.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  await guessWord(pia, 'ice cubes');
  for (const p of players) {
    await expect(p.page.getByTestId('hangman-screen')).toHaveAttribute('data-phase', 'drawing');
    await expect(p.page.getByTestId('hangman-lives')).toHaveAttribute('data-lives', '8');
  }
  await expect(pia.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'out');
  await expect(pia.page.getByTestId('guess-status')).toContainText("You're out");
  await expect(host.page.locator(`[data-testid="player-item"][data-name="${pia.name}"]`)).toHaveClass(/player--out/);
  await expect(host.page.getByTestId('chat-log')).toContainText(`${pia.name} guessed “ICE CUBES”: wrong, and out for this word (2 of 10).`);

  // Section 2: a stroke of its own, then a clear that keeps section 1's base.
  await expect(host.page.getByTestId('draw-bar')).toHaveAttribute('data-section', '2');
  const base = await nonWhitePixels(quinn);
  expect(base).toBeGreaterThan(100);
  await expect(host.page.getByTestId('tool-undo')).toBeDisabled();
  await drawStroke(host, 0.3, 0.7, 0.2);
  await expect.poll(() => nonWhitePixels(quinn), { timeout: 10_000 }).toBeGreaterThan(base + 50);
  await host.page.getByTestId('tool-clear').click();
  await host.page.getByTestId('tool-clear-confirm').click();
  await expect.poll(() => nonWhitePixels(quinn), { timeout: 10_000 }).toBeLessThanOrEqual(base);
  await expect.poll(() => nonWhitePixels(quinn), { timeout: 10_000 }).toBeGreaterThan(100);
  await expect.poll(() => nonWhitePixels(host), { timeout: 10_000 }).toBeGreaterThan(100);
  await expect(host.page.getByTestId('tool-undo')).toBeDisabled();
  await host.page.getByTestId('draw-done').click();

  // Pia is skipped: Quinn is up and risks the word.
  await expect(quinn.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  await expect(pia.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'out');
  await guessWord(quinn, 'ice cream');
  for (const p of players) {
    const end = p.page.getByTestId('overlay-turn-end');
    await expect(end).toHaveAttribute('data-outcome', 'solved');
    await expect(end).toContainText(`${quinn.name} solved it!`);
    await expect(end.getByTestId('turn-end-word')).toHaveText(WORD);
    await expect(end.locator(`[data-testid="turn-end-points"][data-name="${quinn.name}"]`)).toHaveAttribute('data-points', '180');
    await expect(end.locator(`[data-testid="turn-end-points"][data-name="${host.name}"]`)).toHaveAttribute('data-points', '30');
    await expect(end.locator(`[data-testid="turn-end-points"][data-name="${pia.name}"]`)).toHaveAttribute('data-points', '20');
    await expect(end.getByTestId('turn-end-countdown')).toContainText('Next turn');
  }
  await expect(host.page.getByTestId('chat-log')).toContainText(`${quinn.name} solved it! The word was ${WORD}.`);
  for (const p of phones()) await noHorizontalOverflow(p);
});

test('Pia is the hangman on a phone: picks a word, draws a section after a wrong letter, and the word is guessed', async () => {
  await expect(pia.page.getByTestId('word-choice').first()).toBeVisible({ timeout: 15_000 });
  await expect(pia.page.getByTestId('round-indicator')).toHaveAttribute('data-turn', '2');
  for (const p of [host, quinn]) await expect(p.page.getByTestId('word-choice')).toHaveCount(0);
  const choices = pia.page.getByTestId('word-choice');
  await expect(choices).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const box = await boxOf(choices.nth(i));
    expect(box.height, 'a word choice is a 44px target').toBeGreaterThanOrEqual(MIN_TARGET);
  }
  const chosen = ((await choices.first().textContent()) ?? '').trim();
  expect(CUSTOM_WORDS).toContain(chosen.toLowerCase());
  await choices.first().click();
  for (const p of players) await expect(p.page.getByTestId('hangman-screen')).toHaveAttribute('data-phase', 'guessing');
  const word = await secretWordOf(pia);
  expect(word).toBe(chosen);

  // The host guesses first now (join order without the hangman); a wrong letter puts Pia on the canvas.
  await expect(host.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  const missing = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((l) => !word.includes(l)) ?? 'Z';
  await host.page.keyboard.press(missing);
  await expect(pia.page.getByTestId('draw-bar')).toHaveAttribute('data-section', '1');
  await expect(pia.page.getByTestId('hangman-ghost')).toBeVisible();
  for (const id of ['tool-brush', 'tool-undo', 'draw-done']) {
    const box = await boxOf(pia.page.getByTestId(id));
    expect(box.height, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box.width, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
  }
  await noHorizontalOverflow(pia);
  const before = await nonWhitePixels(quinn);
  await pia.page.getByTestId('canvas').scrollIntoViewIfNeeded();
  const box = await boxOf(pia.page.getByTestId('canvas'));
  await pia.page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(() => nonWhitePixels(quinn), { timeout: 10_000 }).toBeGreaterThan(before);
  await pia.page.getByTestId('draw-done').click();

  await expect(quinn.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  await guessWord(quinn, word.toLowerCase());
  for (const p of players) await expect(p.page.getByTestId('overlay-turn-end')).toHaveAttribute('data-outcome', 'solved');
});

test('Quinn is the last hangman; the host solves it and the podium ranks all three', async () => {
  await expect(quinn.page.getByTestId('word-choice').first()).toBeVisible({ timeout: 15_000 });
  await quinn.page.getByTestId('word-choice').first().click();
  await expect(host.page.getByTestId('guess-panel')).toHaveAttribute('data-state', 'mine');
  const word = await secretWordOf(quinn);
  await guessWord(host, word);
  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible({ timeout: 15_000 });
    await expect(end.getByTestId('podium-entry')).toHaveCount(3);
  }
  await expect(host.page.getByTestId('chat-log')).toContainText('Game over!');
  await expect(host.page.getByTestId('back-to-lobby')).toBeVisible();
  await host.page.getByTestId('back-to-lobby').click();
  for (const p of players) await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
  await readyAll([pia.page, quinn.page]);
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
