import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createParty, joinByCode, readyAll } from './party';

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

async function sendGuess(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('guess-input');
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

test('two players start a turn and the drawer draws', async () => {
  const code = await createParty(host.page, host.name);
  await joinByCode(guest.page, guest.name, code);
  await expect(host.page.getByTestId('player-item')).toHaveCount(2);

  await readyAll([guest.page]);
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
  await expect(drawer.page.getByTestId('guess-feed')).toContainText(`${guesser.name} reconnected`);
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

  await sendGuess(guesser.page, word);
  await expect(drawer.page.getByTestId('overlay-turn-end')).toBeVisible();
  await expect(drawer.page.getByTestId('overlay-turn-end')).toContainText(word);
});

test('the host kicks the other player, who lands on the home screen', async () => {
  const target = guest;
  await host.page.getByTestId('kick-player').first().click();
  // The row's points ("+395") pop in with a transform, which paints them over their neighbours. Held
  // in that state, they still never sit over Kick: a tap there is a tap on Kick.
  const onTop = await host.page.getByTestId('kick-confirm').evaluate((button) => {
    const pops = Array.from(document.querySelectorAll('.player__turn-points')).map((el) => el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1)' }], { duration: 60_000 }));
    const r = button.getBoundingClientRect();
    const hits = [r.left + 2, r.left + r.width / 2, r.right - 2].every((x) => {
      const hit = document.elementFromPoint(x, r.top + r.height / 2);
      return hit !== null && button.contains(hit);
    });
    for (const pop of pops) pop.cancel();
    return hits;
  });
  expect(onTop, 'Kick is the top element wherever it is tapped').toBe(true);
  await host.page.getByTestId('kick-confirm').click();

  await expect(target.page.getByTestId('home-create')).toBeVisible();
  await expect(target.page.getByTestId('toast').filter({ hasText: /removed|kicked/i })).toBeVisible();
  await expect(target.page).toHaveURL(/\/$/);
  await expect(target.page.getByTestId('code-input-0')).toHaveValue('');

  await expect(host.page.getByTestId('player-item')).toHaveCount(1);
  await expect(host.page.locator(`[data-testid="player-item"][data-name="${target.name}"]`)).toHaveCount(0);
  await expect(host.page.getByTestId('room-code')).toBeVisible();
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
