import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { closeResults, createParty, enterNameIfAsked, joinByLink, leaveLobby, readyAll } from './party';

/**
 * One browser, three contexts = three players sharing a room on the real production server.
 * The tests build on each other, so they run serially and share module-level state.
 */
test.describe.configure({ mode: 'serial' });

const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Uncaught exceptions and console errors, checked at the end. */
  errors: string[];
}

const players: Player[] = [];
let host: Player;
let bob: Player;
let carol: Player;
let roomCode = '';

async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext();
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

async function typeCode(page: Page, code: string): Promise<void> {
  // The four boxes auto-advance, so typing on the first one fills them all.
  await page.getByTestId('code-input-0').pressSequentially(code, { delay: 20 });
}

function playerItem(page: Page, name: string): Locator {
  return page.locator(`[data-testid="player-item"][data-name="${name}"]`);
}

async function scoreOf(page: Page, name: string): Promise<number> {
  const raw = await playerItem(page, name).getAttribute('data-score');
  return Number(raw ?? 'NaN');
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
  const box = await page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const x = (fx: number) => box.x + box.width * fx;
  const y = (fy: number) => box.y + box.height * fy;
  await page.mouse.move(x(0.2), y(0.3));
  await page.mouse.down();
  await page.mouse.move(x(0.5), y(0.6), { steps: 12 });
  await page.mouse.move(x(0.8), y(0.3), { steps: 12 });
  await page.mouse.up();
}

async function sendGuess(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('guess-input');
  await input.fill(text);
  await input.press('Enter');
}

/** The drawer is whoever currently sees word choices; null while nobody is choosing. */
async function findDrawer(): Promise<Player | null> {
  for (const p of players) {
    if (await p.page.getByTestId('word-choice').first().isVisible()) return p;
  }
  return null;
}

async function readWord(drawerPage: Page): Promise<string> {
  const word = await drawerPage.getByTestId('word-plain').locator('.word__text').textContent();
  if (!word) throw new Error('drawer has no word');
  return word.trim();
}

/** Picks a word for the drawer and lets everyone else guess it right away. Returns false when the game is over. */
async function playOneTurn(): Promise<boolean> {
  let drawer: Player | null = null;
  const deadline = Date.now() + 20_000;
  while (!drawer && Date.now() < deadline) {
    if (await host.page.getByTestId('overlay-game-end').isVisible()) return false;
    drawer = await findDrawer();
    if (!drawer) await host.page.waitForTimeout(200);
  }
  if (!drawer) throw new Error('no drawer found');
  await drawer.page.getByTestId('word-choice').first().click();
  await expect(drawer.page.getByTestId('word-plain')).toBeVisible();
  const word = await readWord(drawer.page);
  for (const p of players) {
    if (p === drawer) continue;
    await expect(p.page.getByTestId('word-mask')).toBeVisible();
    await sendGuess(p.page, word);
  }
  await expect(drawer.page.getByTestId('overlay-turn-end')).toBeVisible();
  return true;
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Alice');
  bob = await newPlayer(browser, 'Bob');
  carol = await newPlayer(browser, 'Carol');
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the front door renders and the host creates a room with a readable 4-character code', async () => {
  await host.page.goto('/');
  await expect(host.page.getByTestId('home-create')).toBeVisible();
  await expect(host.page.getByTestId('home-join')).toBeVisible();
  // Connected: no connection notice (it only shows while the link is gone).
  await expect(host.page.getByTestId('connection-notice')).toHaveCount(0);

  roomCode = await createParty(host.page, host.name);
  expect(roomCode).toMatch(ROOM_CODE_RE);
  await expect(host.page).toHaveURL(new RegExp(`/scribble/${roomCode}$`));
  await expect(playerItem(host.page, host.name).getByTestId('host-crown')).toBeVisible();
  await expect(host.page.getByTestId('start-game')).toBeDisabled();
  await expect(host.page.getByTestId('start-game')).toHaveText('Start · 1 ready, needs 2');
});

test('an invalid code shows the alphabet hint and an unknown code is reported as not found', async () => {
  await bob.page.goto('/');
  await typeCode(bob.page, 'AB0!');
  await expect(bob.page.getByTestId('code-hint')).toContainText(/never I, L or O/);
  await expect(bob.page.getByTestId('code-input-2')).toHaveValue('');

  await bob.page.goto('/');
  const unknown = roomCode === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
  await typeCode(bob.page, unknown);
  await bob.page.getByTestId('home-join').click();
  await enterNameIfAsked(bob.page, bob.name);
  await expect(bob.page.getByTestId('join-error')).toContainText(/couldn’t find a room/i);
  await expect(bob.page.getByTestId('room-code')).toHaveCount(0);

  // Typing a new code over it: a box retyped with the letter it already holds still moves on
  // (it once stayed put, so "NZEH" typed over "ZZZZ" came out "NEHZ").
  const over = `A${unknown[1]}B${unknown[3]}`;
  await bob.page.getByTestId('code-input-0').click();
  await bob.page.keyboard.type(over, { delay: 20 });
  for (let i = 0; i < 4; i++) await expect(bob.page.getByTestId(`code-input-${i}`)).toHaveValue(over[i]);
});

test('player 2 joins by typing the code and player 3 joins through the share link', async () => {
  await bob.page.goto('/');
  await typeCode(bob.page, roomCode);
  await expect(bob.page.getByTestId('room-preview')).toContainText(/1 player in the party/);
  await bob.page.getByTestId('home-join').click();
  // Bob's name was saved by the refused join above: no step this time.
  await expect(bob.page.getByTestId('name-step')).toHaveCount(0);
  await expect(bob.page.getByTestId('room-code')).toHaveText(roomCode);

  await joinByLink(carol.page, carol.name, `/scribble/${roomCode}`, roomCode);

  for (const p of players) {
    await expect(p.page.getByTestId('player-item')).toHaveCount(3);
    await expect(playerItem(p.page, host.name).getByTestId('host-crown')).toBeVisible();
    await expect(playerItem(p.page, bob.name).getByTestId('host-crown')).toHaveCount(0);
    await expect(playerItem(p.page, carol.name).getByTestId('host-crown')).toHaveCount(0);
    await expect(p.page).toHaveURL(new RegExp(`/scribble/${roomCode}$`));
  }
  // The host counts as ready by pressing Start; the others must ready up before the game can begin.
  await expect(host.page.getByTestId('start-game')).toBeDisabled();
  // The button says what it waits for; the player rows say who.
  await expect(host.page.getByTestId('start-game')).toHaveText('Start · 1 ready, needs 2');
  await readyAll([bob.page, carol.page]);
  await expect(host.page.getByTestId('player-count')).toHaveText('3 of 3 ready');
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
  await expect(host.page.getByTestId('start-game')).toContainText('Start · 3 ready');
});

test('only the host sees and changes the settings; the others just sit in the room with their buttons', async () => {
  await host.page.getByTestId('settings-rounds').fill('1');
  await expect(host.page.getByTestId('settings-value-rounds')).toHaveText('1');
  // No timing to set: every turn lasts the same, and the guesses end it early.
  await expect(host.page.getByTestId('settings-drawTime')).toHaveCount(0);
  for (const p of [bob, carol]) {
    await expect(p.page.getByTestId('settings-panel')).toHaveCount(0);
    await expect(p.page.getByTestId('settings-rounds')).toHaveCount(0);
    await expect(p.page.getByTestId('settings-customWords')).toHaveCount(0);
    await expect(p.page.getByTestId('game-tile')).toHaveCount(1);
    await expect(p.page.getByTestId('ready-toggle')).toBeVisible();
  }
  await expect(bob.page.getByTestId('start-game')).toHaveCount(0);
  await expect(bob.page.getByTestId('waiting-for-host')).toContainText(host.name);
});

test('the host adds custom words from a .txt file: split like typed words, no duplicates, and says how many', async () => {
  const box = host.page.getByTestId('settings-customWords');
  const file = host.page.getByTestId('settings-customWords-file');
  const status = host.page.getByTestId('settings-customWords-upload-status');
  // A small button, but a full 44px target.
  expect((await host.page.getByTestId('settings-customWords-upload').boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await box.fill('cat, dog');
  await box.blur();
  await file.setInputFiles({ name: 'words.txt', mimeType: 'text/plain', buffer: Buffer.from('Dog\nhot   dog, fish\n\nbird\n') });
  await expect(status).toHaveText('Added 3 words. Left out 1 repeat.');
  await expect(box).toHaveValue('cat\ndog\nhot dog\nfish\nbird');
  await expect(host.page.getByTestId('settings-customWords-count')).toHaveText('5 words');
  // The list went to the server: a reload brings the same words back.
  await host.page.reload();
  await expect(box).toHaveValue('cat\ndog\nhot dog\nfish\nbird', { timeout: 15_000 });

  // Anything but plain text, or a file over 100 KB, is refused with a short message and changes nothing.
  await file.setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  await expect(status).toHaveText('Pick a plain .txt file.');
  await file.setInputFiles({ name: 'big.txt', mimeType: 'text/plain', buffer: Buffer.alloc(100 * 1024 + 1, 'a') });
  await expect(status).toHaveText('That file is too big. Keep it under 100 KB.');
  await expect(box).toHaveValue('cat\ndog\nhot dog\nfish\nbird');

  // Back to the built-in words for the game itself.
  await box.fill('');
  await box.blur();
  await expect(host.page.getByTestId('settings-customWords-count')).toHaveText('0 words');
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
});

test('a full first turn: choosing, mask, live drawing, undo, guesses and scoring', async () => {
  await host.page.getByTestId('start-game').click();

  let drawer: Player | null = null;
  await expect.poll(async () => (drawer = await findDrawer()), { timeout: 10_000 }).not.toBeNull();
  if (!drawer) throw new Error('unreachable');
  const guessers = players.filter((p) => p !== drawer);
  const [g1, g2] = guessers;

  await expect(drawer.page.getByTestId('word-choice')).toHaveCount(3);
  for (const g of guessers) {
    await expect(g.page.getByTestId('overlay-choosing')).toContainText(`${drawer.name} is choosing`);
  }

  await drawer.page.getByTestId('word-choice').first().click();
  await expect(drawer.page.getByTestId('word-plain')).toBeVisible();
  await expect(drawer.page.getByTestId('toolbar')).toBeVisible();
  const word = await readWord(drawer.page);
  const letterCount = word.replace(/[^\p{L}\p{N}]/gu, '').length;
  for (const g of guessers) {
    const mask = g.page.getByTestId('word-mask');
    await expect(mask).toBeVisible();
    await expect(mask.locator('.tile--hidden, .tile--revealed')).toHaveCount(letterCount);
    await expect(g.page.getByTestId('toolbar')).toHaveCount(0);
    await expect(g.page.getByTestId('drawing-caption')).toContainText(`${drawer.name} is drawing`);
  }

  // Live drawing reaches the other players within two seconds.
  expect(await nonWhitePixels(g1.page)).toBe(0);
  await drawStroke(drawer.page);
  expect(await nonWhitePixels(drawer.page)).toBeGreaterThan(0);
  await expect.poll(() => nonWhitePixels(g1.page), { timeout: 2_000 }).toBeGreaterThan(0);
  await expect.poll(() => nonWhitePixels(g2.page), { timeout: 2_000 }).toBeGreaterThan(0);

  // Undo blanks every canvas again; redo brings the stroke back for everyone, then has nothing left.
  await expect(drawer.page.getByTestId('tool-redo')).toBeDisabled();
  await drawer.page.getByTestId('tool-undo').click();
  await expect.poll(() => nonWhitePixels(g1.page), { timeout: 2_000 }).toBe(0);
  await expect.poll(() => nonWhitePixels(drawer.page), { timeout: 2_000 }).toBe(0);
  await drawer.page.getByTestId('tool-redo').click();
  await expect.poll(() => nonWhitePixels(g1.page), { timeout: 2_000 }).toBeGreaterThan(0);
  await expect.poll(() => nonWhitePixels(drawer.page), { timeout: 2_000 }).toBeGreaterThan(0);
  await expect(drawer.page.getByTestId('tool-redo')).toBeDisabled();
  await drawer.page.getByTestId('tool-undo').click();
  await expect.poll(() => nonWhitePixels(g2.page), { timeout: 2_000 }).toBe(0);

  // The top bar: a chip per player; the drawer's says Drawing, everyone else's Guessing.
  for (const p of players) {
    await expect(p.page.getByTestId('player-chip')).toHaveCount(players.length);
    await expect(p.page.getByTestId('player-chip').filter({ hasText: drawer.name })).toHaveAttribute('data-label', 'Drawing');
    await expect(p.page.getByTestId('player-chip').filter({ hasText: g1.name })).toHaveAttribute('data-label', 'Guessing');
  }

  // There is no chat to type in: the drawer reads a short line where the guess bar would be.
  await expect(drawer.page.getByTestId('guess-input')).toHaveCount(0);
  await expect(drawer.page.getByTestId('guess-idle')).toHaveText('Guesses show up here');

  // A wrong guess shows in everyone's guess feed.
  await sendGuess(g1.page, 'definitely not it');
  for (const p of players) await expect(p.page.getByTestId('guess-feed')).toContainText('definitely not it');

  // A correct guess is announced without the word, scores points and puts the guess bar away.
  await expect(g2.page.getByTestId('guess-input')).toHaveAttribute('placeholder', /guess/i);
  await sendGuess(g2.page, word);
  for (const p of players) await expect(p.page.getByTestId('guess-feed')).toContainText(`${g2.name} guessed the word!`);
  await expect.poll(() => scoreOf(g1.page, g2.name)).toBeGreaterThan(0);
  await expect(g2.page.getByTestId('guess-input')).toHaveCount(0);
  await expect(g2.page.getByTestId('guess-idle')).toContainText('You got it!');
  await expect(g2.page.getByTestId('word-plain')).toContainText(word);
  await expect(g1.page.getByTestId('word-mask')).toBeVisible();

  // The last guesser ends the turn.
  await sendGuess(g1.page, word);
  for (const p of players) {
    const overlay = p.page.getByTestId('overlay-turn-end');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(word);
  }
  expect(await scoreOf(host.page, g1.name)).toBeGreaterThan(0);
  expect(await scoreOf(host.page, drawer.name)).toBeGreaterThan(0);
});

test('the remaining turns rotate the drawer until the game ends, back in the lobby with the results over it', async () => {
  const seenDrawers = new Set<string>();
  // Round 1 has already used one drawer; two turns remain for the other two players.
  for (let i = 0; i < 2; i++) {
    let drawer: Player | null = null;
    await expect.poll(async () => (drawer = await findDrawer()), { timeout: 20_000 }).not.toBeNull();
    if (!drawer) throw new Error('unreachable');
    seenDrawers.add(drawer.name);
    expect(await playOneTurn()).toBe(true);
  }
  expect(seenDrawers.size).toBe(2);

  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible({ timeout: 15_000 });
    await expect(end.getByTestId('results-entry')).toHaveCount(3);
    for (const other of players) await expect(end).toContainText(other.name);
    await expect(p.page.getByTestId('room-code')).toBeAttached();
    await expect(p.page.getByTestId('back-to-lobby')).toHaveCount(0);
  }
});

test('pressing Enter on the results never takes a player out of the room; Tab and Enter close them into the lobby', async () => {
  for (const p of players) {
    // The card has the focus, not a button: Enter is a no-op.
    await expect.poll(() => p.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null)).toBe('results-card');
    await p.page.keyboard.press('Enter');
    await p.page.keyboard.press('Enter');
    await p.page.waitForTimeout(400);
    await expect(p.page.getByTestId('overlay-game-end')).toBeVisible();
    await expect(p.page).toHaveURL(new RegExp(`/scribble/${roomCode}$`));
  }
  for (const p of players) await expect(p.page.getByTestId('player-item')).toHaveCount(3);
  // Tab reaches Back to the room first; Enter there closes the results, and Bob is in the lobby.
  await bob.page.keyboard.press('Tab');
  await expect(bob.page.getByTestId('results-done')).toBeFocused();
  await bob.page.keyboard.press('Enter');
  await expect(bob.page.getByTestId('overlay-game-end')).toHaveCount(0);
  await expect(bob.page.getByTestId('room-code')).toHaveText(roomCode);
  await expect(bob.page.getByTestId('player-item')).toHaveCount(3);
});

test('a reload while the results are up brings the player back to the same seat with the results again', async () => {
  const before = await carol.page.locator(`[data-testid="results-entry"][data-name="${carol.name}"]`).getAttribute('data-score');
  expect(Number(before)).toBeGreaterThan(0);
  await carol.page.reload();
  await expect(carol.page.getByTestId('overlay-game-end')).toBeVisible({ timeout: 15_000 });
  await expect(carol.page.locator(`[data-testid="results-entry"][data-name="${carol.name}"]`)).toHaveAttribute('data-score', before ?? '');
  await expect(carol.page.getByTestId('player-item')).toHaveCount(3);
  await expect(playerItem(carol.page, carol.name)).toHaveCount(1);
  for (const p of players) {
    await expect(p.page.getByTestId('player-item')).toHaveCount(3);
    await expect(playerItem(p.page, carol.name)).toHaveCount(1);
  }
  // Bob closed his already: his reload stays in the lobby.
  await bob.page.reload();
  await expect(bob.page.getByTestId('room-code')).toHaveText(roomCode);
  await bob.page.waitForTimeout(500);
  await expect(bob.page.getByTestId('overlay-game-end')).toHaveCount(0);
});

test('the lobby after the game has the scores reset for everyone and the party together', async () => {
  for (const p of [host, carol]) await closeResults(p.page);
  for (const p of players) {
    await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
    await expect(p.page.getByTestId('player-item')).toHaveCount(3);
    for (const other of players) expect(await scoreOf(p.page, other.name)).toBe(0);
  }
  await readyAll([bob.page, carol.page]);
  await expect(host.page.getByTestId('player-count')).toHaveText('3 of 3 ready');
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
});

test('leaving removes the player and tells the others', async () => {
  await leaveLobby(carol.page);
  await expect(carol.page.getByTestId('home-create')).toBeVisible();
  await expect(carol.page).toHaveURL(/\/$/);
  await expect(carol.page.getByTestId('code-input-0')).toHaveValue('');
  for (const p of [host, bob]) {
    await expect(p.page.getByTestId('player-item')).toHaveCount(2);
    await expect(playerItem(p.page, carol.name)).toHaveCount(0);
  }
});

test('no page errors were raised in any browser', async () => {
  const all = players.flatMap((p) => p.errors);
  expect(all).toEqual([]);
});
