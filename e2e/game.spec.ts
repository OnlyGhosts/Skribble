import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

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

async function enterName(page: Page, name: string): Promise<void> {
  await page.getByTestId('home-name').fill(name);
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

async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('chat-input');
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
    await sendChat(p.page, word);
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

test('the game home renders and the host creates a room with a readable 4-character code', async () => {
  await host.page.goto('/skribble');
  await expect(host.page.getByTestId('home-create')).toBeVisible();
  await expect(host.page.getByTestId('home-join')).toBeVisible();
  await expect(host.page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');

  await enterName(host.page, host.name);
  await host.page.getByTestId('home-create').click();

  const codeEl = host.page.getByTestId('room-code');
  await expect(codeEl).toBeVisible();
  roomCode = (await codeEl.textContent())?.replace(/\s+/g, '') ?? '';
  expect(roomCode).toMatch(ROOM_CODE_RE);
  await expect(host.page).toHaveURL(new RegExp(`/skribble/${roomCode}$`));
  await expect(playerItem(host.page, host.name).getByTestId('host-crown')).toBeVisible();
  await expect(host.page.getByTestId('start-game')).toBeDisabled();
  await expect(host.page.getByTestId('start-hint')).toBeVisible();
});

test('an invalid code shows the alphabet hint and an unknown code is reported as not found', async () => {
  await bob.page.goto('/skribble');
  await enterName(bob.page, bob.name);
  await typeCode(bob.page, 'AB0!');
  await expect(bob.page.getByTestId('code-hint')).toContainText(/never I, L or O/);
  await expect(bob.page.getByTestId('code-input-2')).toHaveValue('');

  await bob.page.goto('/skribble');
  const unknown = roomCode === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
  await typeCode(bob.page, unknown);
  await expect(bob.page.getByTestId('room-preview')).toContainText(/no room with this code/i);
  await bob.page.getByTestId('home-join').click();
  await expect(bob.page.getByTestId('join-error')).toContainText(/couldn't find a room/i);
  await expect(bob.page.getByTestId('room-code')).toHaveCount(0);
});

test('player 2 joins by typing the code and player 3 joins through the share link', async () => {
  await bob.page.goto('/skribble');
  await expect(bob.page.getByTestId('home-name')).toHaveValue(bob.name);
  await typeCode(bob.page, roomCode);
  await expect(bob.page.getByTestId('room-preview')).toContainText(/1\/12 players/);
  await bob.page.getByTestId('home-join').click();
  await expect(bob.page.getByTestId('room-code')).toHaveText(roomCode);

  await carol.page.goto(`/skribble/${roomCode}`);
  await expect(carol.page.getByTestId('invite-banner')).toContainText(roomCode);
  await enterName(carol.page, carol.name);
  await carol.page.getByTestId('home-join').click();
  await expect(carol.page.getByTestId('room-code')).toHaveText(roomCode);

  for (const p of players) {
    await expect(p.page.getByTestId('player-item')).toHaveCount(3);
    await expect(playerItem(p.page, host.name).getByTestId('host-crown')).toBeVisible();
    await expect(playerItem(p.page, bob.name).getByTestId('host-crown')).toHaveCount(0);
    await expect(playerItem(p.page, carol.name).getByTestId('host-crown')).toHaveCount(0);
    await expect(p.page).toHaveURL(new RegExp(`/skribble/${roomCode}$`));
  }
  await expect(host.page.getByTestId('chat-log')).toContainText(`${bob.name} joined`);
  await expect(host.page.getByTestId('chat-log')).toContainText(`${carol.name} joined`);
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
});

test('the host changes settings, everyone sees them and non-hosts cannot edit', async () => {
  await host.page.getByTestId('settings-rounds').fill('1');
  await host.page.getByTestId('settings-drawTime').fill('20');
  for (const p of players) {
    await expect(p.page.getByTestId('settings-value-rounds')).toHaveText('1');
    await expect(p.page.getByTestId('settings-value-drawTime')).toHaveText('20s');
  }
  await expect(bob.page.getByTestId('settings-rounds')).toHaveCount(0);
  await expect(bob.page.getByTestId('settings-drawTime')).toHaveCount(0);
  await expect(bob.page.getByTestId('settings-customWords')).toHaveCount(0);
  await expect(bob.page.getByTestId('settings-allowMidGameJoin')).toBeDisabled();
  await expect(bob.page.getByTestId('start-game')).toHaveCount(0);
  await expect(bob.page.getByTestId('waiting-for-host')).toContainText(host.name);
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

  // Undo blanks every canvas again.
  await drawer.page.getByTestId('tool-undo').click();
  await expect.poll(() => nonWhitePixels(g1.page), { timeout: 2_000 }).toBe(0);
  await expect.poll(() => nonWhitePixels(drawer.page), { timeout: 2_000 }).toBe(0);

  // A wrong guess is public chat.
  await sendChat(g1.page, 'definitely not it');
  for (const p of players) await expect(p.page.getByTestId('chat-log')).toContainText('definitely not it');

  // A correct guess is announced without the word, scores points and changes the placeholder.
  await expect(g2.page.getByTestId('chat-input')).toHaveAttribute('placeholder', /guess/i);
  await sendChat(g2.page, word);
  for (const p of players) await expect(p.page.getByTestId('chat-log')).toContainText(`${g2.name} guessed the word!`);
  await expect.poll(() => scoreOf(g1.page, g2.name)).toBeGreaterThan(0);
  await expect(g2.page.getByTestId('chat-input')).toHaveAttribute('placeholder', /you guessed it/i);
  await expect(g2.page.getByTestId('word-plain')).toContainText(word);
  await expect(g1.page.getByTestId('word-mask')).toBeVisible();

  // The last guesser ends the turn.
  await sendChat(g1.page, word);
  for (const p of players) {
    const overlay = p.page.getByTestId('overlay-turn-end');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(word);
  }
  expect(await scoreOf(host.page, g1.name)).toBeGreaterThan(0);
  expect(await scoreOf(host.page, drawer.name)).toBeGreaterThan(0);
});

test('the remaining turns rotate the drawer until the podium appears', async () => {
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
    await expect(end.getByTestId('podium-entry')).toHaveCount(3);
    for (const other of players) await expect(end).toContainText(other.name);
  }
  await expect(host.page.getByTestId('back-to-lobby')).toBeVisible();
  await expect(bob.page.getByTestId('back-to-lobby')).toHaveCount(0);
});

test('a reload brings a player back into the same seat with the same score', async () => {
  const scoreBefore = await scoreOf(bob.page, bob.name);
  expect(scoreBefore).toBeGreaterThan(0);
  await bob.page.reload();
  await expect(bob.page.getByTestId('overlay-game-end')).toBeVisible({ timeout: 15_000 });
  await expect(bob.page.getByTestId('player-item')).toHaveCount(3);
  await expect(playerItem(bob.page, bob.name)).toHaveCount(1);
  expect(await scoreOf(bob.page, bob.name)).toBe(scoreBefore);
  await expect(bob.page.getByTestId('chat-log')).toContainText('guessed the word!');
  for (const p of players) {
    await expect(p.page.getByTestId('player-item')).toHaveCount(3);
    await expect(playerItem(p.page, bob.name)).toHaveCount(1);
  }
  await expect(host.page.getByTestId('chat-log')).toContainText(`${bob.name} reconnected`);
});

test('back to lobby resets the scores for everyone', async () => {
  await host.page.getByTestId('back-to-lobby').click();
  for (const p of players) {
    await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
    await expect(p.page.getByTestId('player-item')).toHaveCount(3);
    for (const other of players) expect(await scoreOf(p.page, other.name)).toBe(0);
  }
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
});

test('leaving removes the player and tells the others', async () => {
  await carol.page.getByTestId('leave-room').click();
  await expect(carol.page.getByTestId('home-create')).toBeVisible();
  await expect(carol.page).toHaveURL(/\/skribble$/);
  await expect(carol.page.getByTestId('invite-banner')).toHaveCount(0);
  for (const p of [host, bob]) {
    await expect(p.page.getByTestId('player-item')).toHaveCount(2);
    await expect(p.page.getByTestId('chat-log')).toContainText(`${carol.name} left`);
  }
});

test('no page errors were raised in any browser', async () => {
  const all = players.flatMap((p) => p.errors);
  expect(all).toEqual([]);
});
