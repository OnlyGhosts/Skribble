import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Two players: reloads in the middle of a turn must restore the seat, the role and the canvas
 * without abandoning the game, and a kicked player must land cleanly on the home screen.
 */
test.describe.configure({ mode: 'serial' });

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  errors: string[];
}

const players: Player[] = [];
let host: Player;
let guest: Player;
let drawer: Player;
let guesser: Player;
let word = '';

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

async function drawStroke(page: Page, fromX: number, toX: number): Promise<void> {
  const box = await page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x + box.width * fromX, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toX, box.y + box.height * 0.5, { steps: 10 });
  await page.mouse.up();
}

async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('chat-input');
  await input.fill(text);
  await input.press('Enter');
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Dana');
  guest = await newPlayer(browser, 'Eli');
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('two players start a long turn and the drawer draws', async () => {
  await host.page.goto('/');
  await host.page.getByTestId('home-name').fill(host.name);
  await host.page.getByTestId('home-create').click();
  const code = ((await host.page.getByTestId('room-code').textContent()) ?? '').replace(/\s+/g, '');

  await guest.page.goto('/');
  await guest.page.getByTestId('home-name').fill(guest.name);
  await guest.page.getByTestId('code-input-0').pressSequentially(code, { delay: 20 });
  await guest.page.getByTestId('home-join').click();
  await expect(guest.page.getByTestId('room-code')).toHaveText(code);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);

  await host.page.getByTestId('settings-drawTime').fill('120');
  await expect(guest.page.getByTestId('settings-value-drawTime')).toHaveText('120s');
  await host.page.getByTestId('start-game').click();

  await expect
    .poll(async () => {
      for (const p of players) if (await p.page.getByTestId('word-choice').first().isVisible()) return p.name;
      return null;
    })
    .not.toBeNull();
  drawer = (await host.page.getByTestId('word-choice').first().isVisible()) ? host : guest;
  guesser = drawer === host ? guest : host;

  await drawer.page.getByTestId('word-choice').first().click();
  await expect(drawer.page.getByTestId('toolbar')).toBeVisible();
  word = ((await drawer.page.getByTestId('word-plain').locator('.word__text').textContent()) ?? '').trim();
  expect(word.length).toBeGreaterThan(0);

  await drawStroke(drawer.page, 0.2, 0.5);
  await expect.poll(() => nonWhitePixels(guesser.page), { timeout: 2_000 }).toBeGreaterThan(0);

  // Ratings: the guesser likes the drawing, the drawer sees the count but cannot rate.
  await expect(drawer.page.getByTestId('rate-like')).toBeDisabled();
  await guesser.page.getByTestId('rate-like').click();
  await expect(drawer.page.getByTestId('rate-like')).toContainText('1');
  await expect(guesser.page.getByTestId('rate-like')).toHaveAttribute('aria-pressed', 'true');
});

test('the guesser reloads mid-turn: same seat, canvas restored, game still running', async () => {
  await guesser.page.reload();
  await expect(guesser.page.getByTestId('word-mask')).toBeVisible({ timeout: 15_000 });
  await expect(guesser.page.getByTestId('toolbar')).toHaveCount(0);
  await expect.poll(() => nonWhitePixels(guesser.page), { timeout: 5_000 }).toBeGreaterThan(0);
  await expect(guesser.page.getByTestId('player-item')).toHaveCount(2);
  await expect(drawer.page.getByTestId('player-item')).toHaveCount(2);
  await expect(drawer.page.getByTestId('chat-log')).toContainText(`${guesser.name} reconnected`);
  await expect(drawer.page.getByTestId('toolbar')).toBeVisible();
  await expect(drawer.page.getByTestId('room-code')).toHaveCount(0);
});

test('the drawer reloads mid-turn: still the drawer, and new strokes still reach the guesser', async () => {
  await drawer.page.reload();
  await expect(drawer.page.getByTestId('toolbar')).toBeVisible({ timeout: 15_000 });
  await expect(drawer.page.getByTestId('word-plain')).toContainText(word);
  await expect.poll(() => nonWhitePixels(drawer.page), { timeout: 5_000 }).toBeGreaterThan(0);

  const before = await nonWhitePixels(guesser.page);
  await drawStroke(drawer.page, 0.6, 0.9);
  await expect.poll(() => nonWhitePixels(guesser.page), { timeout: 2_000 }).toBeGreaterThan(before);

  await sendChat(guesser.page, word);
  await expect(drawer.page.getByTestId('overlay-turn-end')).toBeVisible();
  await expect(drawer.page.getByTestId('overlay-turn-end')).toContainText(word);
});

test('the host kicks the other player, who lands on the home screen', async () => {
  const target = guest;
  await host.page.getByTestId('kick-player').first().click();
  await host.page.getByTestId('kick-confirm').click();

  await expect(target.page.getByTestId('home-create')).toBeVisible();
  await expect(target.page.getByTestId('toast')).toContainText(/removed|kicked/i);
  await expect(target.page).toHaveURL(/\/$/);
  await expect(target.page.getByTestId('invite-banner')).toHaveCount(0);

  await expect(host.page.getByTestId('chat-log')).toContainText(`${target.name} was kicked`);
  await expect(host.page.getByTestId('player-item')).toHaveCount(1);
  await expect(host.page.getByTestId('room-code')).toBeVisible();
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
