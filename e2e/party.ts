import { expect, type Page } from '@playwright/test';
import { GAME_LIST } from '../shared/platform/games';

/** The slug a new party starts on: the first live game (Scribble). */
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

/** The browser tab inside a room: the site, a door and the code in Mathematical Sans-Serif Bold ("boredgames.io 🚪 𝗔𝗕𝟮𝟯"). */
export function roomTabTitle(code: string): string {
  const bold = [...code].map((ch) => String.fromCodePoint(/\d/.test(ch) ? 0x1d7ec + Number(ch) : 0x1d5d4 + ch.charCodeAt(0) - 65)).join('');
  return `boredgames.io \u{1F6AA} ${bold}`;
}

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

/** Leaves from the lobby: Leave room is in the gear's menu. */
export async function leaveLobby(page: Page): Promise<void> {
  await page.getByTestId('settings-menu').click();
  await page.getByTestId('leave-room').click();
}

/** Leaves from a game screen: the top bar's back arrow, then Leave room in the confirmation. */
export async function leaveGame(page: Page): Promise<void> {
  await page.getByTestId('game-back').click();
  await page.getByTestId('game-leave-yes').click();
}

/**
 * The host's End game: on a phone through the options sheet, on a desktop the top bar's button;
 * either way the confirm step's End game.
 */
export async function endGameAsHost(page: Page): Promise<void> {
  const menu = page.getByTestId('game-menu');
  if (await menu.isVisible()) await menu.click();
  await page.getByTestId('end-game').click();
  await expect(page.getByTestId('end-game-confirm')).toContainText('End the game for everyone?');
  await page.getByTestId('end-game-yes').click();
}

/** The results popup is up over the lobby (the room's code under it). */
export async function expectResults(page: Page): Promise<void> {
  await expect(page.getByTestId('overlay-game-end')).toBeVisible();
  await expect(page.getByTestId('room-code')).toBeAttached();
}

/** Closes the results with Back to the room: the player is in the lobby, ready to play again. */
export async function closeResults(page: Page): Promise<void> {
  await page.getByTestId('results-done').click();
  await expect(page.getByTestId('overlay-game-end')).toHaveCount(0);
  await expect(page.getByTestId('room-code')).toBeVisible();
}

/**
 * The game's name in the top bar is shown and never cut short on a phone (390, 360 and 320
 * wide), the round sits on one line under it, and neither runs into the buttons (the players
 * button, the clock, the menu). Back to the page's own size after.
 */
export async function gameNameWhole(page: Page): Promise<void> {
  const own = page.viewportSize();
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 740 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(size);
    const cut = () =>
      page.evaluate(() => {
        const name = document.querySelector('.gbar__name');
        const status = document.querySelector('.gbar__status');
        const title = document.querySelector('.gbar__title')?.getBoundingClientRect();
        const side = document.querySelector('.gbar__side')?.getBoundingClientRect();
        return {
          // The text's own laid-out width (an ellipsis can hide a fraction of a pixel that scrollWidth rounds away).
          name: name ? name.clientWidth === 0 || (() => { const r = document.createRange(); r.selectNodeContents(name); return r.getBoundingClientRect().width > name.getBoundingClientRect().width + 0.25; })() : true,
          overlap: title && side ? title.right > side.left + 0.5 : true,
          // One line: no taller than the status's own line height allows, and nothing of it hidden ("Round 1/5 · Turn 2/3" whole).
          status: status ? status.getBoundingClientRect().height > parseFloat(getComputedStyle(status).lineHeight) * 1.5 || status.scrollWidth > status.clientWidth : true,
        };
      });
    await expect.poll(cut, { message: `the game’s name and status fit at ${size.width}px` }).toEqual({ name: false, overlap: false, status: false });
  }
  if (own) await page.setViewportSize(own);
}
