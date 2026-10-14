import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createParty, expectReadyCount, joinByCode, readyAll } from './party';

/**
 * Two hands of Texas Hold'em between a desktop host and two phones (390x844, touch): the stack
 * and blind settings in the lobby, the ready-up, a raise through the bet/raise panel (presets,
 * slider, typed amount) called round to a showdown with every contender's cards revealed, then a
 * hand folded round to the big blind with no cards shown, the podium ranked by chips, and a second
 * game in which a phone turned sideways (844x390 down to 568x320) keeps the board in view and the
 * raise panel's confirm on screen, before the host ends it from the header. On every step each page's hole cards appear on that page
 * only. The deck is really shuffled, so the assertions hold whatever is dealt. Serial: the tests
 * build on each other.
 */
test.describe.configure({ mode: 'serial' });

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPES = [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
];
const MIN_TARGET = 44;
const MIN_MOVE_HEIGHT = 56;
const STARTING_CHIPS = 500;
const SMALL_BLIND = 10;
const TOTAL_CHIPS = STARTING_CHIPS * 3;

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Uncaught exceptions and console errors, checked at the end. */
  errors: string[];
}

const players: Player[] = [];
let host: Player;
let pia: Player;
let quinn: Player;
let roomCode = '';

async function newPlayer(browser: Browser, name: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<Player> {
  const context = await browser.newContext(options);
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

const phones = (): Player[] => players.filter((p) => p !== host);
const screen = (p: Player): Locator => p.page.getByTestId('poker-screen');

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

async function noHorizontalOverflow(p: Player): Promise<void> {
  await expect.poll(() => p.page.evaluate(() => document.documentElement.scrollWidth), { message: `${p.name}: document.scrollWidth` }).toBeLessThanOrEqual(PORTRAIT.width);
}

async function chipsOf(p: Player): Promise<number> {
  return Number((await p.page.getByTestId('my-chips').getAttribute('data-chips')) ?? 'NaN');
}

async function scoresOnHost(): Promise<Record<string, number>> {
  const scores: Record<string, number> = {};
  for (const p of players) scores[p.name] = Number((await host.page.locator(`[data-testid="player-item"][data-name="${p.name}"]`).getAttribute('data-score')) ?? 'NaN');
  return scores;
}

/** The platform score is the chip count, on every page, for every player. */
async function scoresMatchChips(): Promise<void> {
  const chips: Record<string, number> = {};
  for (const p of players) chips[p.name] = await chipsOf(p);
  await expect.poll(scoresOnHost, { message: 'score == chips' }).toEqual(chips);
}

/** Chips on the table: every stack plus the pot. Nothing is created or lost. */
async function chipsConserved(): Promise<void> {
  await expect
    .poll(async () => {
      let sum = Number((await host.page.getByTestId('pot').getAttribute('data-chips')) ?? 'NaN');
      for (const p of players) sum += await chipsOf(p);
      return sum;
    })
    .toBe(TOTAL_CHIPS);
}

/** A page's own hole cards, as "KH", "10S"... */
async function holeCards(p: Player): Promise<string[]> {
  return p.page.getByTestId('my-card').evaluateAll((els) => els.map((el) => `${(el as HTMLElement).dataset.rank}${(el as HTMLElement).dataset.suit}`));
}

const cardLocator = (page: Page, card: string): Locator => page.locator(`[data-rank="${card.slice(0, -1)}"][data-suit="${card.slice(-1)}"]`);

/**
 * Every page holds two cards of its own, and none of them shows anywhere on another page: not on
 * the seats (backs without a rank), not on the board, not in the chat.
 */
async function holeCardsStayPrivate(): Promise<Record<string, string[]>> {
  const hands: Record<string, string[]> = {};
  for (const p of players) {
    await expect(p.page.getByTestId('my-card')).toHaveCount(2);
    hands[p.name] = await holeCards(p);
    await expect(p.page.locator('[data-testid="seat-card"][data-rank]')).toHaveCount(0);
  }
  for (const p of players) {
    for (const q of players) {
      if (q === p) continue;
      for (const card of hands[q.name]) await expect(cardLocator(p.page, card), `${q.name}'s ${card} on ${p.name}'s page`).toHaveCount(0);
    }
  }
  await expect(host.page.getByTestId('chat-log')).not.toContainText(/[♠♥♦♣]/);
  return hands;
}

/** Whose move it is (the host's table and the actor's own page agree), or null once the hand's results are up. */
async function actor(): Promise<Player | null> {
  let found: Player | null = null;
  await expect
    .poll(
      async () => {
        if ((await screen(host).getAttribute('data-phase')) !== 'acting') return 'results';
        const turn = await screen(host).getAttribute('data-turn-player');
        for (const p of players) {
          const area = p.page.getByTestId('my-area');
          if ((await area.getAttribute('data-player-id')) === turn && (await area.getAttribute('data-my-turn')) === 'true') {
            found = p;
            return p.name;
          }
        }
        return null;
      },
      { message: 'a player whose move it is, or the results' },
    )
    .not.toBeNull();
  return found;
}

/** The table's step: the street and whose move it is (a move always changes one of them). */
async function stepOnHost(): Promise<string> {
  return `${await screen(host).getAttribute('data-phase')}:${await screen(host).getAttribute('data-street')}:${await screen(host).getAttribute('data-turn-player')}`;
}

/** Only the actor's moves are live; everybody else's bar is greyed out. */
async function onlyActorCanMove(acting: Player): Promise<void> {
  for (const p of players) {
    if (p === acting) continue;
    await expect(p.page.locator('[data-testid^="action-"]:not([disabled])')).toHaveCount(0);
  }
  await expect(acting.page.getByTestId('action-fold')).toBeEnabled();
}

/** Calls or checks round until the results come up, checking privacy on every move. */
async function callDown(): Promise<void> {
  for (let moves = 0; moves < 20; moves++) {
    const acting = await actor();
    if (!acting) return;
    await holeCardsStayPrivate();
    await onlyActorCanMove(acting);
    const call = acting.page.getByTestId('action-call');
    const before = await stepOnHost();
    if (await call.count()) await call.click();
    else await acting.page.getByTestId('action-check').click();
    await expect.poll(stepOnHost).not.toBe(before);
  }
  throw new Error('the hand did not reach its results');
}

async function resultRows(p: Player): Promise<Array<{ name: string; net: number; revealed: boolean; chips: number }>> {
  await expect(p.page.getByTestId('overlay-results')).toBeVisible();
  return p.page.getByTestId('result-player').evaluateAll((els) =>
    els.map((el) => {
      const e = el as HTMLElement;
      return { name: e.dataset.name ?? '', net: Number(e.dataset.net), revealed: e.dataset.revealed === 'true', chips: Number(e.dataset.chips) };
    }),
  );
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  quinn = await newPlayer(browser, 'Quinn', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host creates a Poker party, two phones join, the host sets the stacks, the blinds and two hands, and everyone readies up', async () => {
  roomCode = await createParty(host.page, host.name, 'poker');
  await expect(host.page.getByTestId('site-header')).toContainText('Poker');
  await expect(host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="poker"]')).toHaveAttribute('aria-checked', 'true');
  for (const p of phones()) await joinByCode(p.page, p.name, roomCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(3);

  await host.page.getByTestId(`settings-startingChips-${STARTING_CHIPS}`).click();
  await expect(pia.page.getByTestId('settings-value-startingChips')).toHaveText(String(STARTING_CHIPS));
  await host.page.getByTestId(`settings-smallBlind-${SMALL_BLIND}`).click();
  await expect(quinn.page.getByTestId('settings-value-smallBlind')).toHaveText(`${SMALL_BLIND}/${SMALL_BLIND * 2}`);
  // A blind over half the stack is pulled back by the server.
  await host.page.getByTestId('settings-smallBlind').fill('400');
  await host.page.getByTestId('settings-smallBlind').press('Enter');
  await expect(quinn.page.getByTestId('settings-value-smallBlind')).toHaveText('250/500');
  await host.page.getByTestId(`settings-smallBlind-${SMALL_BLIND}`).click();
  await expect(quinn.page.getByTestId('settings-value-smallBlind')).toHaveText(`${SMALL_BLIND}/${SMALL_BLIND * 2}`);
  await expect(pia.page.getByTestId('settings-value-blindsIncreaseEvery')).toHaveText('Never');
  await expect(pia.page.getByTestId('settings-value-hands')).toHaveText('Until one is left');
  await host.page.getByTestId('settings-hands').fill('2');
  await host.page.getByTestId('settings-actSeconds').fill('60');
  await host.page.getByTestId('settings-resultsSeconds').fill('20');
  await expect(pia.page.getByTestId('settings-value-hands')).toHaveText('2');
  await expect(pia.page.getByTestId('settings-value-actSeconds')).toHaveText('60s');
  await expect(pia.page.getByTestId('settings-value-resultsSeconds')).toHaveText('20s');
  await expect(pia.page.getByTestId('settings-startingChips')).toHaveCount(0);

  await readyAll([pia.page, quinn.page]);
  await expectReadyCount(host.page, 3);
  await host.page.getByTestId('start-game').click();
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'acting');
    await expect(p.page.getByTestId('hand-indicator')).toHaveAttribute('data-hand', '1');
    await expect(p.page.getByTestId('hand-indicator')).toHaveAttribute('data-total', '2');
    await expect(p.page.getByTestId('poker-header').getByTestId('timer')).toBeVisible();
    await expect(p.page.getByTestId('board')).toHaveAttribute('data-street', 'preflop');
    await expect(p.page.getByTestId('community-slot')).toHaveCount(5);
    await expect(p.page.getByTestId('seat')).toHaveCount(2);
  }
  await expect(host.page.getByTestId('pot')).toHaveAttribute('data-chips', String(SMALL_BLIND * 3));
  await expect(host.page.getByTestId('chat-log')).toContainText(`Hand 1 (blinds ${SMALL_BLIND}/${SMALL_BLIND * 2})`);
  await holeCardsStayPrivate();
  await scoresMatchChips();
  await chipsConserved();
});

test('hand one: the phone bar fits, a raise goes in through the panel, everyone calls down and the showdown reveals every contender', async () => {
  for (const p of phones()) {
    await noHorizontalOverflow(p);
    for (const id of ['players-toggle', 'chat-toggle', 'game-menu']) expect((await boxOf(p.page.getByTestId(id))).height, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    for (const id of ['action-fold', 'action-raise']) expect((await boxOf(p.page.getByTestId(id))).height, `${id} is a 56px target`).toBeGreaterThanOrEqual(MIN_MOVE_HEIGHT);
    // My cards and the moves stay on screen without scrolling.
    expect((await boxOf(p.page.getByTestId('actions'))).y + (await boxOf(p.page.getByTestId('actions'))).height).toBeLessThanOrEqual(PORTRAIT.height);
    expect((await boxOf(p.page.getByTestId('my-card').first())).y).toBeGreaterThan(0);
    await expect(p.page.getByTestId('hand-hint')).toHaveText(/^(Pair of .+|.+ high)$/);
  }

  const raiser = await actor();
  if (!raiser) throw new Error('nobody to act');
  await onlyActorCanMove(raiser);
  await raiser.page.getByTestId('action-raise').click();
  const panel = raiser.page.getByTestId('raise-panel');
  await expect(panel).toHaveAttribute('data-kind', 'raise');
  const min = Number(await panel.getAttribute('data-min'));
  const max = Number(await panel.getAttribute('data-max'));
  expect(min).toBe(SMALL_BLIND * 4);
  await raiser.page.getByTestId('raise-pot').click();
  await expect(panel).toHaveAttribute('data-amount', (await raiser.page.getByTestId('raise-pot').getAttribute('data-amount')) ?? '');
  await raiser.page.getByTestId('raise-allIn').click();
  await expect(panel).toHaveAttribute('data-amount', String(max));
  await expect(raiser.page.getByTestId('raise-confirm')).toContainText('All in');
  await raiser.page.getByTestId('raise-min').click();
  await expect(panel).toHaveAttribute('data-amount', String(min));
  // An amount under the window, typed while the panel sits at its minimum: the field snaps back to what the confirm sends.
  await raiser.page.getByTestId('raise-input').fill('3');
  await raiser.page.getByTestId('raise-input').blur();
  await expect(panel).toHaveAttribute('data-amount', String(min));
  await expect(raiser.page.getByTestId('raise-input')).toHaveValue(String(min));
  await expect(raiser.page.getByTestId('raise-confirm')).toHaveText(`Raise to ${min}`);
  await raiser.page.getByTestId('raise-slider').fill(String(min + 20));
  await expect(raiser.page.getByTestId('raise-input')).toHaveValue(String(min + 20));
  if (raiser !== host) {
    await noHorizontalOverflow(raiser);
    const confirm = await boxOf(raiser.page.getByTestId('raise-confirm'));
    expect(confirm.height).toBeGreaterThanOrEqual(MIN_MOVE_HEIGHT);
    expect(confirm.y + confirm.height).toBeLessThanOrEqual(PORTRAIT.height);
    expect(await raiser.page.getByTestId('raise-input').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  }
  // A typed amount, sent with the keyboard's Go.
  const to = min + 30;
  await raiser.page.getByTestId('raise-input').fill(String(to));
  await raiser.page.getByTestId('raise-input').press('Enter');
  const watcher = raiser === host ? pia : host;
  await expect(watcher.page.locator(`[data-testid="seat"][data-name="${raiser.name}"]`)).toHaveAttribute('data-bet', String(to));
  await expect(watcher.page.locator(`[data-testid="seat"][data-name="${raiser.name}"] [data-testid="seat-note"]`)).toHaveText(`Raise to ${to}`);
  await chipsConserved();

  await callDown();
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'results');
    await expect(p.page.getByTestId('overlay-results')).toHaveAttribute('data-uncontested', 'false');
    await expect(p.page.getByTestId('results-board-card')).toHaveCount(5);
  }
  // Everyone called to the river: every hand is revealed, on every page, with the cards each player held.
  const rows = await resultRows(host);
  expect(rows.map((r) => r.name).sort()).toEqual(players.map((p) => p.name).sort());
  expect(rows.every((r) => r.revealed)).toBe(true);
  expect(rows.reduce((sum, r) => sum + r.net, 0)).toBe(0);
  expect(rows.reduce((sum, r) => sum + r.chips, 0)).toBe(TOTAL_CHIPS);
  for (const p of phones()) expect(await resultRows(p)).toEqual(rows);
  for (const p of players) {
    const own = (await holeCards(p)).sort();
    const shown = await host.page.locator(`[data-testid="result-player"][data-name="${p.name}"] [data-testid="revealed-card"]`).evaluateAll((els) => els.map((el) => `${(el as HTMLElement).dataset.rank}${(el as HTMLElement).dataset.suit}`));
    expect(shown.sort()).toEqual(own);
    await expect(host.page.locator(`[data-testid="result-player"][data-name="${p.name}"] [data-testid="revealed-hand"]`)).not.toBeEmpty();
  }
  for (const p of phones()) {
    await noHorizontalOverflow(p);
    await expect(p.page.getByTestId('results-countdown')).toHaveAttribute('data-countdown', 'running');
  }
  await scoresMatchChips();
  await expect(host.page.getByTestId('poker-next')).toContainText('Next hand');
  await host.page.getByTestId('poker-next').click();
  for (const p of players) {
    await expect(p.page.getByTestId('hand-indicator')).toHaveAttribute('data-hand', '2');
    await expect(p.page.getByTestId('overlay-results')).toHaveCount(0);
  }
});

test('hand two: two folds hand the big blind the pot with no cards shown, and the last hand ends on the podium ranked by chips', async () => {
  await holeCardsStayPrivate();
  await chipsConserved();
  const folders: Player[] = [];
  for (let i = 0; i < 2; i++) {
    const acting = await actor();
    if (!acting) throw new Error('the hand ended before two folds');
    await onlyActorCanMove(acting);
    const before = await stepOnHost();
    await acting.page.getByTestId('action-fold').click();
    await expect.poll(stepOnHost).not.toBe(before);
    await expect(acting.page.getByTestId('my-area')).toHaveAttribute('data-status', 'folded');
    folders.push(acting);
  }
  const winner = players.find((p) => !folders.includes(p));
  if (!winner) throw new Error('no winner');
  for (const p of players) {
    await expect(p.page.getByTestId('overlay-results')).toHaveAttribute('data-uncontested', 'true');
    // Nobody's cards are revealed: not the winner's, not the folders'.
    await expect(p.page.getByTestId('revealed-card')).toHaveCount(0);
    await expect(p.page.getByTestId('results-headline')).toHaveText(`${winner.name} takes the pot`);
  }
  await holeCardsStayPrivate();
  const rows = await resultRows(host);
  expect(rows.find((r) => r.name === winner.name)?.net).toBeGreaterThan(0);
  expect(rows.every((r) => !r.revealed)).toBe(true);
  await scoresMatchChips();
  const chips: Record<string, number> = {};
  for (const p of players) chips[p.name] = await chipsOf(p);
  expect(Object.values(chips).reduce((a, b) => a + b, 0)).toBe(TOTAL_CHIPS);

  await expect(host.page.getByTestId('poker-next')).toContainText('Final standings');
  await host.page.getByTestId('poker-next').click();
  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible();
    await expect(end.getByTestId('podium-entry')).toHaveCount(3);
  }
  const entries = await host.page.getByTestId('podium-entry').evaluateAll((els) => els.map((el) => ({ rank: Number((el as HTMLElement).dataset.rank), name: el.textContent ?? '' })));
  const ranked = players.map((p) => ({ name: p.name, chips: chips[p.name] }));
  for (const entry of entries) {
    const me = ranked.find((r) => entry.name.includes(r.name));
    if (!me) throw new Error(`podium entry without a player: ${entry.name}`);
    expect(entry.rank).toBe(1 + ranked.filter((r) => r.chips > me.chips).length);
  }
  await expect(host.page.getByTestId('chat-log')).toContainText('Game over!');
  await host.page.getByTestId('back-to-lobby').click();
  for (const p of players) await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
});

test('a second game: only the host has End game, and ending mid-hand gives every stake back', async () => {
  await readyAll([pia.page, quinn.page]);
  await expectReadyCount(host.page, 3);
  await host.page.getByTestId('start-game').click();
  for (const p of players) await expect(screen(p)).toHaveAttribute('data-phase', 'acting');
  await holeCardsStayPrivate();

  // Pia turns her phone sideways on her move: the table keeps its own column and the raise panel's confirm stays on screen.
  for (let moves = 0; moves < 3; moves++) {
    const acting = await actor();
    if (!acting) throw new Error('the hand ended before Pia acted');
    if (acting === pia) break;
    const before = await stepOnHost();
    const call = acting.page.getByTestId('action-call');
    if (await call.count()) await call.click();
    else await acting.page.getByTestId('action-check').click();
    await expect.poll(stepOnHost).not.toBe(before);
  }
  await expect(pia.page.getByTestId('my-area')).toHaveAttribute('data-my-turn', 'true');
  for (const size of LANDSCAPES) {
    await pia.page.setViewportSize(size);
    await expect.poll(() => pia.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    // The board, its cards and the pot are in view beside my cards, not squeezed out above them.
    for (const id of ['community-slot', 'pot']) {
      const box = await boxOf(pia.page.getByTestId(id).first());
      expect(box.y, `${id} at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `${id} at ${size.width}x${size.height}`).toBeLessThanOrEqual(size.height);
    }
    await expect(pia.page.getByTestId('my-card')).toHaveCount(2);
    await pia.page.getByTestId('action-raise').click();
    await expect(pia.page.getByTestId('raise-panel')).toBeVisible();
    for (const id of ['raise-confirm', 'raise-cancel']) {
      const button = pia.page.getByTestId(id);
      await expect.poll(async () => {
        const box = await boxOf(button);
        return box.y >= 0 && box.y + box.height <= size.height;
      }, { message: `${id} inside ${size.width}x${size.height}` }).toBe(true);
      const box = await boxOf(button);
      expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET);
      const hit = await pia.page.evaluate(({ x, y, testId }) => document.elementFromPoint(x, y)?.closest(`[data-testid="${testId}"]`) !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2, testId: id });
      expect(hit, `${id} takes the tap at ${size.width}x${size.height}`).toBe(true);
    }
    await pia.page.getByTestId('raise-cancel').click();
    await expect(pia.page.getByTestId('raise-panel')).toHaveCount(0);
  }
  await pia.page.setViewportSize(PORTRAIT);

  // The phones' options sheet has no End game for a guest.
  await pia.page.getByTestId('game-menu').click();
  await expect(pia.page.getByTestId('menu-sheet')).toBeVisible();
  await expect(pia.page.getByTestId('end-game')).toHaveCount(0);
  await expect(pia.page.getByTestId('menu-sheet').getByTestId('leave-room')).toBeVisible();
  await pia.page.getByTestId('menu-sheet-close').click();
  await expect(pia.page.getByTestId('menu-sheet')).toHaveCount(0);

  await host.page.getByTestId('end-game').click();
  await expect(host.page.getByTestId('end-game-confirm')).toBeVisible();
  await host.page.getByTestId('end-game-cancel').click();
  await expect(screen(host)).toHaveAttribute('data-phase', 'acting');
  await host.page.getByTestId('end-game').click();
  await host.page.getByTestId('end-game-yes').click();
  for (const p of players) {
    await expect(p.page.getByTestId('overlay-game-end')).toBeVisible();
    await expect(p.page.getByTestId('podium-entry')).toHaveCount(3);
  }
  // The blinds went back: three stacks of the starting chips, all sharing first place.
  const ranks = await host.page.getByTestId('podium-entry').evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.rank)));
  expect(ranks).toEqual([1, 1, 1]);
  expect(await scoresOnHost()).toEqual({ Hana: STARTING_CHIPS, Pia: STARTING_CHIPS, Quinn: STARTING_CHIPS });
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
