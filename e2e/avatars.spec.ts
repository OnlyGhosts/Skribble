import { expect, test, type Browser, type Page } from '@playwright/test';
import { readRoomCode } from './party';

/**
 * The avatars are bundled Fluent Emoji pictures, the same on every device: the picker lays all 50
 * out in full rows of equal columns, each picture loads at its 104px size, the chosen face follows
 * the player into the room, only the faces on screen are fetched, and a picture that fails to
 * load shows the emoji instead.
 */

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

async function openPicker(browser: Browser, options: Parameters<Browser['newContext']>[0]): Promise<Page> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto('/');
  await page.getByTestId('home-create').click();
  await expect(page.getByTestId('avatar-picker')).toBeVisible();
  return page;
}

interface Box {
  left: number;
  top: number;
  width: number;
  right: number;
}

/** The boxes of every choice in one of the picker's groups, and of the group itself. */
async function grid(page: Page, group: string): Promise<{ outer: Box; cells: Box[] }> {
  return page.locator(group).evaluate((el) => {
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, right: r.right };
    };
    return { outer: box(el), cells: [...el.children].map(box) };
  });
}

/** Rows of equal length with equal columns, from the group's left edge to its right. */
function fullRows({ outer, cells }: { outer: Box; cells: Box[] }, columns: number[]): number {
  const rows = new Map<number, Box[]>();
  for (const cell of cells) rows.set(Math.round(cell.top), [...(rows.get(Math.round(cell.top)) ?? []), cell]);
  const lengths = [...rows.values()].map((row) => row.length);
  expect(new Set(lengths).size, `row lengths ${lengths.join(',')}`).toBe(1);
  expect(columns).toContain(lengths[0]);
  const widths = cells.map((c) => c.width);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
  for (const row of rows.values()) {
    expect(Math.abs(row[0].left - outer.left)).toBeLessThan(1);
    expect(Math.abs(row[row.length - 1].right - outer.right)).toBeLessThan(1);
  }
  return lengths[0];
}

for (const [label, options] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
  test(`${label}: 50 faces in full rows of equal columns, every picture at 104px`, async ({ browser }) => {
    const page = await openPicker(browser, options);
    const faces = page.locator('.emoji-choice');
    await expect(faces).toHaveCount(50);
    const columns = fullRows(await grid(page, '.avatar-picker__emojis'), [5, 10]);
    expect(50 % columns).toBe(0);
    fullRows(await grid(page, '.avatar-picker__colors'), [4, 6, 12]);
    for (const size of await page.locator('.emoji-choice, .avatar-picker__colors .swatch').evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)))) {
      expect(size).toBeGreaterThanOrEqual(44);
    }
    await page.locator('.emoji-choice').last().scrollIntoViewIfNeeded();
    const pictures = page.locator('.emoji-choice img');
    await expect(pictures).toHaveCount(50);
    await expect
      .poll(() => pictures.evaluateAll((imgs) => imgs.filter((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth === 104).length))
      .toBe(50);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(options.viewport.width);
    await page.context().close();
  });
}

test('the chosen face follows the player into the room, and only the faces on screen are fetched', async ({ browser }) => {
  const page = await openPicker(browser, PHONE);
  await page.getByRole('radio', { name: 'Avocado' }).click();
  await expect(page.getByRole('radio', { name: 'Avocado' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('img', { name: 'Your avatar: Avocado' })).toHaveAttribute('src', '/avatars/avocado.webp');
  await page.getByTestId('home-name').fill('Ada');
  await page.getByTestId('home-continue').click();
  await readRoomCode(page);
  const row = page.getByTestId('lobby').locator('.player__avatar img');
  await expect(row).toHaveAttribute('src', '/avatars/avocado.webp');
  await expect(row).toHaveAttribute('alt', '');

  // A second visit (a new tab, the name and face saved) skips the picker: the room fetches this player's face and nothing else.
  const again = await page.context().newPage();
  const fetched: string[] = [];
  again.on('request', (req) => {
    const match = new URL(req.url()).pathname.match(/^\/avatars\/(.+)\.webp$/);
    if (match) fetched.push(match[1]);
  });
  await again.goto('/');
  await again.getByTestId('home-create').click();
  await readRoomCode(again);
  const mine = again.getByTestId('lobby').locator('.player__avatar img');
  await expect(mine).toHaveAttribute('src', '/avatars/avocado.webp');
  await expect.poll(() => mine.evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)).toBe(true);
  expect(fetched.filter((f) => f !== 'avocado')).toEqual([]);
  await page.context().close();
});

test('a picture that fails to load shows the emoji in its place', async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  await context.route('**/avatars/*.webp', (route) => route.abort());
  const page = await context.newPage();
  await page.goto('/');
  await page.getByTestId('home-create').click();
  await expect(page.getByTestId('avatar-picker')).toBeVisible();
  await page.locator('.emoji-choice').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.emoji-choice .face-img--text')).toHaveCount(50);
  await expect(page.getByRole('radio', { name: 'Grinning face' })).toHaveText('😀');
  await expect(page.getByRole('radio', { name: 'Avocado' })).toHaveText('🥑');
  await expect(page.getByRole('img', { name: /^Your avatar: / })).toHaveClass(/face-img--text/);
  await context.close();
});
