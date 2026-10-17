import { expect, test, type Browser, type Page } from '@playwright/test';
import { closeResults, createParty, endGameAsHost, enterNameIfAsked, readyAll } from './party';
import { tilesReadable } from './tableFit';

/**
 * Joining a running game means watching it: three phones, two play a Blackjack game, the third
 * joins with the code mid-game, watches it with no controls, and plays the next game. In that next
 * game a player who sat it out watches the same way.
 */
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const WATCHING = "You’re watching. You can play the next game.";

async function phone(browser: Browser): Promise<Page> {
  const context = await browser.newContext(PHONE);
  return context.newPage();
}

/** A spectator's table: the one line in place of the panel, not a single move, nothing scrolling. */
async function expectWatching(page: Page): Promise<void> {
  await expect(page.getByTestId('blackjack-screen')).toBeVisible();
  await expect(page.getByTestId('bj-panel')).toHaveAttribute('data-watching', 'true');
  await expect(page.getByTestId('watching-note')).toHaveText(WATCHING);
  for (const id of ['place-bet', 'bet-input', 'action-hit', 'action-stand', 'action-split', 'action-double', 'sit-out']) await expect(page.getByTestId(id)).toHaveCount(0);
  const scroll = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth }));
  expect(scroll.height).toBeLessThanOrEqual(844);
  expect(scroll.width).toBeLessThanOrEqual(390);
  await tilesReadable(page, 'a Blackjack spectator');
}

test('a third phone joins a running game, watches it without controls, and plays the next one', async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await phone(browser);
  const code = await createParty(host, 'Hana', 'blackjack');
  const pia = await phone(browser);
  await pia.goto(`/blackjack/${code}`);
  await pia.getByTestId('home-join').click();
  await enterNameIfAsked(pia, 'Pia');
  await readyAll([pia]);
  await host.getByTestId('start-game').click();
  for (const p of [host, pia]) await expect(p.getByTestId('place-bet')).toBeVisible();

  // The front door says the game is running and that joining means watching; Join lets the third phone in.
  const rae = await phone(browser);
  await rae.goto('/');
  await rae.getByTestId('code-input-0').pressSequentially(code, { delay: 20 });
  await expect(rae.getByTestId('room-preview')).toHaveText('Blackjack in progress · 2 players. Join to watch.');
  await expect(rae.getByTestId('room-preview')).not.toContainText('closed');
  await rae.getByTestId('home-join').click();
  await enterNameIfAsked(rae, 'Rae');
  await expectWatching(rae);
  await expect(rae).toHaveURL(new RegExp(`/blackjack/${code}$`));
  // Everyone sees Rae in the party, watching.
  for (const p of [host, pia]) {
    await p.getByTestId('players-toggle').click();
    await expect(p.getByTestId('players-sheet').locator('[data-testid="player-item"][data-name="Rae"]')).toHaveAttribute('data-status', 'sittingOut');
    await p.getByTestId('players-sheet-close').click();
  }

  // The two players play a round to its end (everyone stands); Rae follows it and still has nothing to press.
  for (const p of [host, pia]) await p.getByTestId('place-bet').click();
  const round = () => rae.getByTestId('blackjack-screen').getAttribute('data-round');
  await expect
    .poll(
      async () => {
        for (const p of [host, pia]) if (await p.getByTestId('action-stand').isEnabled()) await p.getByTestId('action-stand').click();
        await expectWatching(rae);
        return round();
      },
      { timeout: 30_000 },
    )
    .toBe('2');

  // The host ends the game; Rae is not in the results, but sees them and readies up for the next one in the lobby.
  await endGameAsHost(host);
  for (const p of [host, pia, rae]) await expect(p.getByTestId('overlay-game-end')).toBeVisible({ timeout: 20_000 });
  await expect(rae.getByTestId('results-place')).toHaveText('You watched this one');
  await expect(rae.getByTestId('overlay-game-end').getByTestId('results-entry')).toHaveCount(2);
  for (const p of [host, pia, rae]) await closeResults(p);
  for (const p of [host, pia, rae]) await expect(p.getByTestId('room-code')).toHaveText(code);

  // Next game: Rae plays, and Pia, who sits this one out, watches it the same way.
  await readyAll([rae]);
  await pia.getByTestId('sitout-toggle').click();
  await expect(pia.getByTestId('ready-controls')).toHaveAttribute('data-sitting-out', 'true');
  await host.getByTestId('start-game').click();
  await expect(rae.getByTestId('bj-panel')).not.toHaveAttribute('data-watching');
  await expect(rae.getByTestId('place-bet')).toBeEnabled();
  await expectWatching(pia);
  await rae.getByTestId('place-bet').click();
  await expect(rae.getByTestId('place-bet')).toHaveAttribute('data-placed', 'true');
});

test('a phone that joins a running Poker hand watches it, every seat read in full: stack, bet and blind', async ({ browser }) => {
  test.setTimeout(60_000);
  const host = await phone(browser);
  const code = await createParty(host, 'Hana', 'poker');
  const pia = await phone(browser);
  await pia.goto(`/poker/${code}`);
  await pia.getByTestId('home-join').click();
  await enterNameIfAsked(pia, 'Pia');
  await readyAll([pia]);
  await host.getByTestId('start-game').click();
  for (const p of [host, pia]) await expect(p.getByTestId('poker-screen')).toHaveAttribute('data-phase', 'acting');

  const rae = await phone(browser);
  await rae.goto(`/poker/${code}`);
  await rae.getByTestId('home-join').click();
  await enterNameIfAsked(rae, 'Rae');
  await expect(rae.getByTestId('pk-panel')).toHaveAttribute('data-watching', 'true');
  await expect(rae.getByTestId('watching-note')).toHaveText(WATCHING);
  for (const id of ['action-fold', 'action-raise', 'action-call']) await expect(rae.getByTestId(id)).toHaveCount(0);
  // Not dealt in, Rae watches the hand in play on the stage, named by its pill; that seat leaves its cards to the stage, so they show once.
  const turn = (await rae.getByTestId('poker-screen').getAttribute('data-turn-player')) ?? '';
  await expect(rae.getByTestId('hand-stage')).toHaveAttribute('data-player-id', turn);
  await expect(rae.getByTestId('stage-owner')).toBeVisible();
  await expect(rae.getByTestId('stage-card')).toHaveCount(2);
  await expect(rae.locator(`[data-testid="seat"][data-player-id="${turn}"] [data-testid="seat-card"]`)).toHaveCount(0);
  // Both players sit as tiles side by side; the big blind's line ("BB 10") reads in full beside the stack and the bet.
  await expect(rae.getByTestId('seat')).toHaveCount(2);
  await expect(rae.locator('[data-testid="seat-line"]', { hasText: /^BB \d+$/ })).toBeVisible();
  await tilesReadable(rae, 'a Poker spectator at 390x844');
});
