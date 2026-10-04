import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Two server instances sharing one Redis (started by e2e/launch-cluster.mjs): the host plays on
 * port 4181, the guesser on 4182. Everything must cross instances, and a player whose connection
 * is cut (as Vercel does at a function's max duration) must rejoin through the other instance
 * with the same seat, score and canvas.
 */
test.describe.configure({ mode: 'serial' });

const INSTANCE_A = 'http://localhost:4181';
const INSTANCE_B = 'http://localhost:4182';
const SESSION_KEY = 'skribble.session';

interface Player {
  name: string;
  base: string;
  context: BrowserContext;
  page: Page;
  errors: string[];
}

const players: Player[] = [];
let host: Player;
let guest: Player;
let drawer: Player;
let guesser: Player;
let code = '';
let secondWord = '';

async function newPlayer(browser: Browser, name: string, base: string): Promise<Player> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`${name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${name}: ${msg.text()}`);
  });
  const player: Player = { name, base, context, page, errors };
  players.push(player);
  return player;
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

async function drawStroke(page: Page, fromX: number, toX: number, y = 0.5): Promise<void> {
  const box = await page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x + box.width * fromX, box.y + box.height * y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toX, box.y + box.height * y, { steps: 10 });
  await page.mouse.up();
}

async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('chat-input');
  await input.fill(text);
  await input.press('Enter');
}

async function readWord(page: Page): Promise<string> {
  const word = ((await page.getByTestId('word-plain').locator('.word__text').textContent()) ?? '').trim();
  expect(word.length).toBeGreaterThan(0);
  return word;
}

async function scoreOf(page: Page, name: string): Promise<number> {
  const raw = await page.locator(`[data-testid="player-item"][data-name="${name}"]`).getAttribute('data-score');
  return Number(raw ?? 'NaN');
}

/** Whoever sees word choices is the drawer. */
async function awaitDrawer(): Promise<Player> {
  let found: Player | null = null;
  await expect
    .poll(
      async () => {
        for (const p of [host, guest]) if (await p.page.getByTestId('word-choice').first().isVisible()) found = p;
        return found?.name ?? null;
      },
      { timeout: 20_000 },
    )
    .not.toBeNull();
  if (!found) throw new Error('no drawer');
  return found;
}

test.beforeAll(async ({ browser, request }) => {
  for (const base of [INSTANCE_A, INSTANCE_B]) {
    await expect
      .poll(async () => (await request.get(`${base}/api/health`).catch(() => null))?.ok() ?? false, { timeout: 30_000 })
      .toBe(true);
    const health = (await (await request.get(`${base}/api/health`)).json()) as { driver?: string };
    expect(health.driver).toBe('redis');
  }
  host = await newPlayer(browser, 'Dana', INSTANCE_A);
  guest = await newPlayer(browser, 'Eli', INSTANCE_B);
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host creates a room on instance A and the guest joins it by code on instance B', async () => {
  await host.page.goto(`${host.base}/`);
  await host.page.getByTestId('home-name').fill(host.name);
  await host.page.getByTestId('home-create').click();
  code = ((await host.page.getByTestId('room-code').textContent()) ?? '').replace(/\s+/g, '');
  expect(code).toMatch(/^[A-Z2-9]{4}$/);

  await guest.page.goto(`${guest.base}/`);
  await guest.page.getByTestId('home-name').fill(guest.name);
  await guest.page.getByTestId('code-input-0').pressSequentially(code, { delay: 20 });
  await expect(guest.page.getByTestId('room-preview')).toContainText(/1\/12 players/);
  await guest.page.getByTestId('home-join').click();
  await expect(guest.page.getByTestId('room-code')).toHaveText(code);

  await expect(host.page.getByTestId('player-item')).toHaveCount(2);
  await expect(guest.page.getByTestId('player-item')).toHaveCount(2);
  await expect(host.page.getByTestId('chat-log')).toContainText(`${guest.name} joined`);
});

test('settings set on A show on B, and the game starts with one round of 80 seconds', async () => {
  await host.page.getByTestId('settings-rounds').fill('1');
  await host.page.getByTestId('settings-drawTime').fill('80');
  await expect(guest.page.getByTestId('settings-value-rounds')).toHaveText('1');
  await expect(guest.page.getByTestId('settings-value-drawTime')).toHaveText('80s');

  await host.page.getByTestId('start-game').click();
  drawer = await awaitDrawer();
  guesser = drawer === host ? guest : host;
  await expect(guesser.page.getByTestId('overlay-choosing')).toContainText(`${drawer.name} is choosing`);
  await drawer.page.getByTestId('word-choice').first().click();
  await expect(drawer.page.getByTestId('toolbar')).toBeVisible();
  await expect(guesser.page.getByTestId('word-mask')).toBeVisible();
});

test('strokes drawn on one instance appear on the other, and undo blanks them again', async () => {
  expect(await nonWhitePixels(guesser.page)).toBe(0);
  await drawStroke(drawer.page, 0.2, 0.5);
  await expect.poll(() => nonWhitePixels(guesser.page), { timeout: 3_000 }).toBeGreaterThan(0);

  await drawer.page.getByTestId('tool-undo').click();
  await expect.poll(() => nonWhitePixels(guesser.page), { timeout: 3_000 }).toBe(0);
  await expect.poll(() => nonWhitePixels(drawer.page), { timeout: 3_000 }).toBe(0);
});

test('a correct guess sent to the other instance ends the turn for both', async () => {
  const word = await readWord(drawer.page);
  await sendChat(guesser.page, 'not even close');
  await expect(drawer.page.getByTestId('chat-log')).toContainText('not even close');

  await sendChat(guesser.page, word);
  for (const p of [host, guest]) {
    await expect(p.page.getByTestId('chat-log')).toContainText(`${guesser.name} guessed the word!`);
    await expect(p.page.getByTestId('overlay-turn-end')).toBeVisible();
    await expect(p.page.getByTestId('overlay-turn-end')).toContainText(word);
  }
  await expect.poll(() => scoreOf(drawer.page, guesser.name)).toBeGreaterThan(0);
});

test('the second drawer draws, is cut off, and rejoins through the other instance with seat, score and canvas intact', async ({ browser }) => {
  // Turn two: the former guesser draws now.
  const second = await awaitDrawer();
  expect(second).toBe(guesser);
  const watcher = drawer;
  await second.page.getByTestId('word-choice').first().click();
  await expect(second.page.getByTestId('toolbar')).toBeVisible();
  secondWord = await readWord(second.page);
  await drawStroke(second.page, 0.3, 0.7, 0.4);
  await expect.poll(() => nonWhitePixels(watcher.page), { timeout: 3_000 }).toBeGreaterThan(0);
  const scoreBefore = await scoreOf(watcher.page, second.name);
  expect(scoreBefore).toBeGreaterThan(0);

  // The connection is cut: the client would reconnect and may land on another instance. Carry the
  // stored seat to a fresh page on the other port, exactly as sessionStorage survives in one tab.
  const stored = await second.page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);
  expect(stored).not.toBeNull();
  const session = JSON.parse(stored ?? '{}') as { code?: string; token?: string; playerId?: string };
  expect(session.code).toBe(code);
  expect(session.token).toBeTruthy();

  const otherBase = second.base === INSTANCE_A ? INSTANCE_B : INSTANCE_A;
  const back = await newPlayer(browser, `${second.name}-back`, otherBase);
  await back.page.goto(`${otherBase}/`);
  await back.page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [SESSION_KEY, stored ?? ''] as const);
  await back.page.goto(`${otherBase}/${code}`);

  // Same seat: still the drawer, same word, same score, the drawing restored, nobody duplicated.
  await expect(back.page.getByTestId('toolbar')).toBeVisible({ timeout: 15_000 });
  await expect(back.page.getByTestId('word-plain')).toContainText(secondWord);
  await expect.poll(() => nonWhitePixels(back.page), { timeout: 5_000 }).toBeGreaterThan(0);
  await expect(back.page.getByTestId('player-item')).toHaveCount(2);
  await expect(back.page.locator(`[data-testid="player-item"][data-name="${second.name}"]`)).toHaveCount(1);
  expect(await scoreOf(back.page, second.name)).toBe(scoreBefore);
  await expect(watcher.page.getByTestId('player-item')).toHaveCount(2);
  await expect(watcher.page.getByTestId('toolbar')).toHaveCount(0);

  // The replaced tab is told so and leaves the room instead of fighting over the seat.
  await expect(second.page.getByTestId('home-create')).toBeVisible({ timeout: 15_000 });
  await expect(second.page.getByTestId('toast')).toContainText(/another tab/i);

  // Drawing continues from the new instance.
  const before = await nonWhitePixels(watcher.page);
  await drawStroke(back.page, 0.6, 0.9, 0.7);
  await expect.poll(() => nonWhitePixels(watcher.page), { timeout: 3_000 }).toBeGreaterThan(before);
  await sendChat(watcher.page, secondWord);
  await expect(back.page.getByTestId('overlay-turn-end')).toBeVisible();
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
