import { expect, type Page } from '@playwright/test';

/**
 * The card tables' players grid reads at every size: every total badge (Blackjack's hand total,
 * Poker's stack) sits inside its tile rather than being cut to one digit, and no tile is squeezed
 * under `minHeight` px (a desktop big table once gave its tiles 8 to 14px).
 */
export async function tilesReadable(page: Page, label: string, minHeight = 0): Promise<void> {
  const read = () =>
    page.evaluate((min) => {
      const tiles = Array.from(document.querySelectorAll('[data-testid="seat"]'));
      let cut = 0;
      let short = 0;
      for (const tile of tiles) {
        const t = tile.getBoundingClientRect();
        if (t.height < min) short++;
        const total = tile.querySelector('[data-testid="seat-total"]');
        if (!total || getComputedStyle(total).display === 'none' || getComputedStyle(total.parentElement ?? total).display === 'none') continue;
        const r = total.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < t.left - 1 || r.right > t.right + 1 || r.top < t.top - 1 || r.bottom > t.bottom + 1) cut++;
      }
      return { cut, short };
    }, minHeight);
  await expect.poll(read, { message: `${label}: every tile's total inside it, no tile under ${minHeight}px` }).toEqual({ cut: 0, short: 0 });
}

/** My hand at the bottom of the table is wholly on screen. */
export async function myAreaOnScreen(page: Page, testId: string, label: string): Promise<void> {
  const read = () =>
    page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return true;
      const r = el.getBoundingClientRect();
      return r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.right <= window.innerWidth + 1;
    }, testId);
  await expect.poll(read, { message: `${label}: my hand is on screen` }).toBe(true);
}
