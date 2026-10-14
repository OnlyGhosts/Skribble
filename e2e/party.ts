import { expect, type Page } from '@playwright/test';
import { GAME_LIST } from '../shared/platform/games';

/** The slug a new party starts on: the first live game (Scribble, whose internal id stays 'skribble'). */
export const FIRST_LIVE_SLUG = (GAME_LIST.find((g) => g.status === 'live') ?? GAME_LIST[0]).slug;

/**
 * Shared steps for the party lobby. A game only starts with the players who readied up (the host
 * counts as ready by pressing Start), so every spec readies its non-host pages before starting.
 */
export async function readyAll(pages: Page[]): Promise<void> {
  for (const page of pages) {
    // A player sitting out has one button, Count me in, which comes back in and readies at once.
    const countMeIn = page.locator('[data-testid="ready-controls"][data-sitting-out="true"] [data-testid="sitout-toggle"]');
    if (await countMeIn.isVisible()) await countMeIn.click();
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

export const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

/** The code shown in the lobby. */
export async function readRoomCode(page: Page): Promise<string> {
  const code = ((await page.getByTestId('room-code').textContent()) ?? '').replace(/\s+/g, '');
  expect(code).toMatch(ROOM_CODE_RE);
  return code;
}

/**
 * The "Who's playing?" step after Join room / Create room: shown on a first visit, skipped once a
 * name is saved on the device. Fills it when it shows; either way the lobby is next (or, for a
 * join the server refuses, the front door again with the error).
 */
export async function enterNameIfAsked(page: Page, name: string): Promise<void> {
  const step = page.getByTestId('name-step');
  const settled = step.or(page.getByTestId('room-code')).or(page.getByTestId('join-error'));
  await expect(settled.first()).toBeVisible();
  if (await step.isVisible()) {
    await page.getByTestId('home-name').fill(name);
    await page.getByTestId('home-continue').click();
  }
}

/**
 * Creates a party from the front door and returns its code. `gameSlug` picks the game the party
 * starts on ('/?game=slug', the only way to reach the hidden template game); otherwise the first
 * live game, and the host picks another in the lobby.
 */
export async function createParty(page: Page, name: string, gameSlug?: string, base = ''): Promise<string> {
  await page.goto(`${base}/${gameSlug ? `?game=${gameSlug}` : ''}`);
  await expect(page.getByTestId('home-create')).toBeVisible();
  await page.getByTestId('home-create').click();
  await enterNameIfAsked(page, name);
  const code = await readRoomCode(page);
  await expect(page).toHaveURL(new RegExp(`/${gameSlug ?? FIRST_LIVE_SLUG}/${code}$`));
  return code;
}

/** Types the code into the four boxes (they auto-advance) and joins. */
export async function joinByCode(page: Page, name: string, code: string, base = ''): Promise<void> {
  await page.goto(`${base}/`);
  await page.getByTestId('code-input-0').pressSequentially(code, { delay: 20 });
  await page.getByTestId('home-join').click();
  await enterNameIfAsked(page, name);
  await expect(page.getByTestId('room-code')).toHaveText(code);
}

/** Opens an invite link ('/:slug/:CODE' or '/:CODE'): the boxes are filled, one tap joins. */
export async function joinByLink(page: Page, name: string, path: string, code: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('code-input-3')).toHaveValue(code[3]);
  await page.getByTestId('home-join').click();
  await enterNameIfAsked(page, name);
  await expect(page.getByTestId('room-code')).toHaveText(code);
}
