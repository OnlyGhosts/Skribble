import { expect, type Page } from '@playwright/test';

/**
 * Shared steps for the party lobby. A game only starts with the players who readied up (the host
 * counts as ready by pressing Start), so every spec readies its non-host pages before starting.
 */
export async function readyAll(pages: Page[]): Promise<void> {
  for (const page of pages) {
    const toggle = page.getByTestId('ready-toggle');
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
}

/** "Start · N ready" on the host's page once N players are counted. */
export async function expectReadyCount(hostPage: Page, count: number): Promise<void> {
  await expect(hostPage.getByTestId('start-game')).toHaveAttribute('data-ready', String(count));
}
