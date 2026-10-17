import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { closeResults, createParty, expectReadyCount, joinByCode, readyAll } from './party';
import { tableBots, type TableBot } from './tableBots';
import { myAreaOnScreen, tilesReadable } from './tableFit';

/**
 * Texas Hold'em on the Stake-style table, between a desktop host and two phones (390x844, touch):
 * the stacks, the blinds and two hands set in the lobby; a hand played through the control panel
 * (1/2 pot, Pot, MAX, a typed raise sent with Enter, a call, a fold, checks down) with only the
 * acting page's moves lit, the board coming out street by street, a showdown on the table (no
 * results screen) with the pot paid to the winner; a hand folded round to one player with no cards
 * shown; the results ranked by chips; and a second game with the desktop shortcuts, the panel at
 * 320x568 and the host's End game. Every step checks that each page's hole cards appear on that
 * page only until a showdown shows them, and that the chips equal the platform score. The deck is
 * really shuffled, so the checks hold whatever is dealt. Serial: the tests build on each other.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const PORTRAIT = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const MIN_TARGET = 44;
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
const byName = (name: string): Player => {
  const p = players.find((q) => q.name === name);
  if (!p) throw new Error(`no player ${name}`);
  return p;
};

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

/** The phone layout holds: no sideways scroll, the whole panel on screen, every control a 44px target, the field 16px. */
async function phoneLayoutHolds(p: Player, size: { width: number; height: number }): Promise<void> {
  await expect.poll(() => p.page.evaluate(() => document.documentElement.scrollWidth), { message: `${p.name}: document.scrollWidth` }).toBeLessThanOrEqual(size.width);
  const panel = await boxOf(p.page.getByTestId('pk-panel'));
  expect(panel.y, `${p.name}: the panel starts on screen`).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.height, `${p.name}: the panel ends on screen`).toBeLessThanOrEqual(size.height + 0.5);
  expect(panel.x + panel.width).toBeLessThanOrEqual(size.width + 0.5);
  const call = (await p.page.getByTestId('action-call').count()) > 0 ? 'action-call' : 'action-check';
  for (const id of ['raise-input', 'raise-half', 'raise-pot', 'raise-max', 'action-fold', call, 'action-raise', 'action-allin', 'players-toggle', 'game-menu']) {
    const box = await boxOf(p.page.getByTestId(id));
    expect(box.height, `${p.name}: ${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box.y + box.height, `${p.name}: ${id} is on screen`).toBeLessThanOrEqual(size.height + 0.5);
  }
  expect(await p.page.getByTestId('raise-input').evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), 'the raise field is 16px so iOS does not zoom').toBeGreaterThanOrEqual(16);
  // My cards and the board are on screen too.
  expect((await boxOf(p.page.getByTestId('my-area'))).y).toBeGreaterThan(0);
  expect((await boxOf(p.page.getByTestId('board'))).y).toBeGreaterThan(0);
  // Nothing scrolls, either way: the document, the table, the players.
  const scrolls = () =>
    p.page.evaluate(() =>
      ['html', '[data-testid="poker-main"]', '[data-testid="pk-table"]', '[data-testid="seats"]', '[data-testid="hand-indicator"]'].filter((sel) => {
        const el = document.querySelector(sel);
        return el !== null && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
      }),
    );
  // Nor is the hand under the name ever cut short.
  await expect.poll(scrolls, { message: `${p.name}: nothing scrolls or is cut short` }).toEqual([]);
}

async function chipsOf(p: Player): Promise<number> {
  return Number((await p.page.getByTestId('my-chips').getAttribute('data-chips')) ?? 'NaN');
}

/** Every player's platform score, read from the host's players sheet. */
async function scoresOnHost(): Promise<Record<string, number>> {
  await host.page.getByTestId('players-toggle').click();
  const sheet = host.page.getByTestId('players-sheet');
  await expect(sheet.getByTestId('player-item')).toHaveCount(players.length);
  const scores: Record<string, number> = {};
  for (const p of players) scores[p.name] = Number((await sheet.locator(`[data-testid="player-item"][data-name="${p.name}"]`).getAttribute('data-score')) ?? 'NaN');
  await host.page.getByTestId('players-sheet-close').click();
  await expect(sheet).toHaveCount(0);
  return scores;
}

/** The platform score is the chip count, for every player. */
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

const cardsOf = (locator: Locator): Promise<string[]> => locator.evaluateAll((els) => els.map((el) => `${(el as HTMLElement).dataset.rank}${(el as HTMLElement).dataset.suit}`));
const cardLocator = (page: Page, card: string): Locator => page.locator(`[data-rank="${card.slice(0, -1)}"][data-suit="${card.slice(-1)}"]`);

/** Every page has played out its animations: the cards on show are the hand in play. */
async function tableAtRest(): Promise<void> {
  for (const p of players) await expect(screen(p)).toHaveAttribute('data-busy', 'false');
}

/**
 * Every page holds two cards of its own, face up, and none of them shows anywhere on another page:
 * the seats show backs without a rank and the board never names them.
 */
async function holeCardsStayPrivate(): Promise<Record<string, string[]>> {
  await tableAtRest();
  const hands: Record<string, string[]> = {};
  for (const p of players) {
    await expect(p.page.locator('[data-testid="my-card"][data-face="up"]')).toHaveCount(2);
    hands[p.name] = await cardsOf(p.page.getByTestId('my-card'));
    await expect(p.page.locator('[data-testid="seat-card"][data-rank]')).toHaveCount(0);
  }
  for (const p of players) {
    for (const q of players) {
      if (q === p) continue;
      for (const card of hands[q.name]) await expect(cardLocator(p.page, card), `${q.name}'s ${card} on ${p.name}'s page`).toHaveCount(0);
    }
  }
  return hands;
}

/** Whose move it is (the host's table and the actor's own page agree, and the actor's moves are lit), or null once the hand is over. */
async function actor(): Promise<Player | null> {
  let found: Player | null = null;
  await expect
    .poll(
      async () => {
        if ((await screen(host).getAttribute('data-phase')) !== 'acting') return 'over';
        const turn = await screen(host).getAttribute('data-turn-player');
        const step = await stepOn(host);
        for (const p of players) {
          const area = p.page.getByTestId('my-area');
          // The actor's own page must have caught up with the same step: a stale page still shows the move just made.
          if ((await area.getAttribute('data-player-id')) === turn && (await stepOn(p)) === step && (await area.getAttribute('data-my-turn')) === 'true' && (await p.page.getByTestId('action-fold').isEnabled())) {
            found = p;
            return p.name;
          }
        }
        return null;
      },
      { message: 'a player whose move it is, or the end of the hand', timeout: 15_000 },
    )
    .not.toBeNull();
  return found;
}

/** A page's step: the hand, the street and whose move it is (a move always changes one of them). */
async function stepOn(p: Player): Promise<string> {
  const s = screen(p);
  return `${await s.getAttribute('data-hand')}:${await s.getAttribute('data-phase')}:${await s.getAttribute('data-street')}:${await s.getAttribute('data-turn-player')}`;
}

const stepOnHost = (): Promise<string> => stepOn(host);

/** Only the actor's moves are lit; every other page has the whole panel dimmed and names the actor. */
async function onlyActorCanMove(acting: Player): Promise<void> {
  for (const p of players) {
    if (p === acting) {
      await expect(p.page.getByTestId('table-turn').locator('.tbl-turn__text')).toHaveText('Your turn');
      continue;
    }
    await expect(p.page.getByTestId('table-turn').locator('.tbl-turn__text')).toHaveText(`${acting.name}’s turn`);
    await expect(p.page.locator('[data-testid="pk-panel"] button:not([disabled])')).toHaveCount(0);
    await expect(p.page.locator(`[data-testid="seat"][data-name="${acting.name}"]`)).toHaveAttribute('data-turn', 'true');
  }
  await expect(acting.page.getByTestId('action-fold')).toBeEnabled();
}

/** Plays one move and waits for the table to take it. */
async function move(acting: Player, id: 'action-fold' | 'action-call' | 'action-check'): Promise<void> {
  const before = await stepOnHost();
  await acting.page.getByTestId(id).click();
  await expect.poll(stepOnHost).not.toBe(before);
}

/** Calls or checks round until the hand is over; checks privacy on every move and that the board comes out three, then one, then one. */
async function callDown(): Promise<number[]> {
  const boards: number[] = [];
  for (let moves = 0; moves < 20; moves++) {
    const acting = await actor();
    if (!acting) return boards;
    await holeCardsStayPrivate();
    await onlyActorCanMove(acting);
    const board = await host.page.locator('[data-testid="community-card"][data-face="up"]').count();
    if (boards[boards.length - 1] !== board) boards.push(board);
    await move(acting, (await acting.page.getByTestId('action-call').count()) > 0 ? 'action-call' : 'action-check');
  }
  throw new Error('the hand did not reach its end');
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana', { viewport: { width: 1440, height: 900 } });
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  quinn = await newPlayer(browser, 'Quinn', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host sets the stacks, the blinds and two hands, two phones join and the first hand is dealt', async () => {
  roomCode = await createParty(host.page, host.name, 'poker');
  await expect(host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="poker"]')).toHaveAttribute('aria-checked', 'true');
  for (const p of phones()) await joinByCode(p.page, p.name, roomCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(3);

  await host.page.getByTestId(`settings-startingChips-${STARTING_CHIPS}`).click();
  await expect(host.page.getByTestId(`settings-startingChips-${STARTING_CHIPS}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(host.page.getByTestId('settings-startingChips')).toHaveValue(String(STARTING_CHIPS));
  await host.page.getByTestId(`settings-smallBlind-${SMALL_BLIND}`).click();
  await expect(host.page.getByTestId(`settings-smallBlind-${SMALL_BLIND}`)).toHaveAttribute('aria-pressed', 'true');
  // The sliders' tracks line up and keep their length as the value changes (the thumb never jumps).
  const trackWidths = () => Promise.all(['hands', 'blindsIncreaseEvery'].map(async (id) => (await host.page.getByTestId(`settings-${id}`).boundingBox())?.width ?? 0));
  await expect(host.page.getByTestId('settings-value-hands')).toHaveText('No limit');
  const before = await trackWidths();
  expect(before[0]).toBeGreaterThan(0);
  expect(before[1]).toBe(before[0]);
  await host.page.getByTestId('settings-hands').fill('2');
  await expect(host.page.getByTestId('settings-value-hands')).toHaveText('2');
  expect(await trackWidths()).toEqual(before);
  // No clocks to set: the turn and the results pause are fixed.
  for (const id of ['actSeconds', 'resultsSeconds']) await expect(host.page.getByTestId(`settings-${id}`)).toHaveCount(0);
  for (const p of phones()) await expect(p.page.getByTestId('settings-panel')).toHaveCount(0);

  await readyAll([pia.page, quinn.page]);
  await expectReadyCount(host.page, 3);
  await host.page.getByTestId('start-game').click();
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'acting');
    await expect(p.page.getByTestId('hand-indicator')).toHaveAttribute('data-hand', '1');
    await expect(p.page.getByTestId('hand-indicator')).toContainText('Hand 1 of 2');
    await expect(p.page.getByTestId('blinds')).toHaveAttribute('data-big', String(SMALL_BLIND * 2));
    // No band across the table: the line under the ribbon says whose turn it is, with the turn clock.
    await expect(p.page.getByTestId('table-turn').getByTestId('timer')).toBeVisible();
    await expect(p.page.getByTestId('spotlight')).toHaveCount(0);
    await expect(p.page.getByTestId('board')).toHaveAttribute('data-street', 'preflop');
    await expect(p.page.getByTestId('community-slot')).toHaveCount(5);
    await expect(p.page.getByTestId('seat')).toHaveCount(2);
    await expect(p.page.getByTestId('table-ribbon')).toContainText(`Blinds ${SMALL_BLIND}/${SMALL_BLIND * 2}`);
    await expect(p.page.getByTestId('table-ribbon')).toContainText('Hand 1 of 2');
    // The hand, the blinds and the street are on the table, not in the top bar.
    await expect(p.page.getByTestId('phase-kicker')).toHaveText('Pre-flop');
    await expect(p.page.getByTestId('poker-header')).not.toContainText('Hand');
    await expect(p.page.getByTestId('poker-header')).not.toContainText('Blinds');
    // Every stack reads in words, every bet as its own pill: never two bare numbers side by side.
    for (const chips of await p.page.getByTestId('seat-chips').allTextContents()) expect(chips).toMatch(/^[\d,.k]+ chips?$/);
    for (const bet of await p.page.locator('[data-testid="seat-bet"] .tbl-stake').allTextContents()) expect(bet).toMatch(/^Bet [\d,.k]+$/);
    await expect(p.page.getByTestId('overlay-results')).toHaveCount(0);
  }
  // The dealer button sits on exactly one seat on every page.
  for (const p of players) await expect(p.page.locator('[data-testid="seat-dealer"], [data-testid="my-dealer"]')).toHaveCount(1);
  await expect(host.page.getByTestId('pot')).toHaveAttribute('data-chips', String(SMALL_BLIND * 3));
  // No status line or shortcut hint in any panel.
  for (const p of players) await expect(p.page.locator('[data-testid="hotkey-hint"], [data-testid="turn-status"]')).toHaveCount(0);
  await holeCardsStayPrivate();
  await scoresMatchChips();
  await chipsConserved();
});

test('hand one: a raise through the panel, a call and a fold, the board street by street, and a showdown on the table with the pot to the winner', async () => {
  for (const p of phones()) await phoneLayoutHolds(p, PORTRAIT);
  for (const p of phones()) await expect(p.page.getByTestId('hand-hint')).toHaveText(/^(Pair of .+|.+ high)$/);

  const raiser = await actor();
  if (!raiser) throw new Error('nobody to act');
  await onlyActorCanMove(raiser);
  const panel = raiser.page.getByTestId('pk-panel');
  await expect(panel).toHaveAttribute('data-kind', 'raise');
  const min = Number(await panel.getAttribute('data-min'));
  const max = Number(await panel.getAttribute('data-max'));
  expect(min).toBe(SMALL_BLIND * 4);
  // The field starts at the minimum raise; the buttons walk it.
  await expect(raiser.page.getByTestId('raise-input')).toHaveValue(String(min));
  await expect(raiser.page.getByTestId('action-raise')).toHaveText('Raise');
  await expect(raiser.page.getByTestId('action-raise')).toHaveAttribute('aria-label', `Raise to ${min}`);
  await raiser.page.getByTestId('raise-max').click();
  await expect(panel).toHaveAttribute('data-amount', String(max));
  await raiser.page.getByTestId('raise-pot').click();
  const pot = Number(await panel.getAttribute('data-amount'));
  expect(pot).toBeGreaterThan(min);
  await raiser.page.getByTestId('raise-half').click();
  expect(Number(await panel.getAttribute('data-amount'))).toBeLessThan(pot);
  // Under the window snaps back to the minimum; the clear button empties the field and the raise waits for an amount.
  await raiser.page.getByTestId('raise-input').fill('3');
  await raiser.page.getByTestId('raise-input').blur();
  await expect(raiser.page.getByTestId('raise-input')).toHaveValue(String(min));
  await raiser.page.getByTestId('raise-clear').click();
  await expect(raiser.page.getByTestId('raise-input')).toHaveValue('');
  await expect(raiser.page.getByTestId('action-raise')).toBeDisabled();
  // A typed amount, sent with Enter (the phone keyboard's Go).
  const to = min + 30;
  await raiser.page.getByTestId('raise-input').fill(String(to));
  await expect(raiser.page.getByTestId('action-raise')).toHaveAttribute('aria-label', `Raise to ${to}`);
  const before = await stepOnHost();
  await raiser.page.getByTestId('raise-input').press('Enter');
  await expect.poll(stepOnHost).not.toBe(before);
  const watcher = raiser === host ? pia : host;
  await expect(watcher.page.locator(`[data-testid="seat"][data-name="${raiser.name}"]`)).toHaveAttribute('data-bet', String(to));
  await expect(watcher.page.locator(`[data-testid="seat"][data-name="${raiser.name}"] [data-testid="seat-line"]`)).toHaveText(`Raise to ${to}`);
  // The raise is said under the ribbon too, and its pill on the raiser's seat reads as a bet, apart from the stack.
  await expect(watcher.page.getByTestId('turn-sub')).toHaveText(`${raiser.name} raises to ${to}`);
  await expect(raiser.page.getByTestId('turn-sub')).toHaveText(`You raise to ${to}`);
  await expect(watcher.page.locator(`[data-testid="seat"][data-name="${raiser.name}"] [data-testid="seat-bet"] .tbl-stake`)).toHaveText(`Bet ${to}`);
  await chipsConserved();

  // The next player calls, the one after folds: a two-way pot goes to the flop.
  const caller = await actor();
  if (!caller) throw new Error('the hand ended early');
  await onlyActorCanMove(caller);
  await expect(caller.page.getByTestId('action-call')).toHaveText(/^Call \d+$/);
  await move(caller, 'action-call');
  const folder = await actor();
  if (!folder) throw new Error('the hand ended early');
  await move(folder, 'action-fold');
  await expect(folder.page.getByTestId('my-area')).toHaveAttribute('data-status', 'folded');
  for (const p of players) {
    if (p === folder) continue;
    await expect(p.page.locator(`[data-testid="seat"][data-name="${folder.name}"]`)).toHaveAttribute('data-status', 'folded');
    // The folded hand went to the muck.
    await expect(p.page.locator(`[data-testid="seat"][data-name="${folder.name}"] [data-testid="seat-card"]`)).toHaveCount(0);
  }
  for (const p of players) await expect(p.page.locator('[data-testid="community-card"][data-face="up"]')).toHaveCount(3);
  await chipsConserved();

  const boards = await callDown();
  // The board came out street by street: the flop, then the turn, then the river.
  expect(boards).toEqual([3, 4, 5]);

  // The showdown stays on the table: no results screen, both contenders' cards shown on every page, the folded hand never.
  const contenders = players.filter((p) => p !== folder);
  const own: Record<string, string[]> = {};
  for (const p of contenders) own[p.name] = (await cardsOf(p.page.getByTestId('my-card'))).sort();
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'results');
    await expect(p.page.getByTestId('overlay-results')).toHaveCount(0);
    await expect(p.page.locator('[data-testid="community-card"][data-face="up"]')).toHaveCount(5);
    await expect(p.page.getByTestId('table-turn')).toHaveAttribute('data-state', 'result');
    await expect(p.page.locator(`[data-testid="seat"][data-name="${folder.name}"] [data-testid="seat-card"]`)).toHaveCount(0);
    for (const q of contenders) {
      if (q === p) continue;
      const shown = p.page.locator(`[data-testid="seat"][data-name="${q.name}"] [data-testid="seat-card"][data-face="up"]`);
      await expect(shown).toHaveCount(2);
      expect((await cardsOf(shown)).sort(), `${q.name}'s cards on ${p.name}'s page`).toEqual(own[q.name]);
    }
  }
  // The pot went to the winner(s): every page agrees on who, the payouts add up to the pot, and the stacks show it.
  const paid: Record<string, number> = {};
  const myOutcome = await host.page.getByTestId('my-area').getAttribute('data-outcome');
  if (myOutcome === 'win') paid[host.name] = Number(await host.page.getByTestId('my-area').getAttribute('data-payout'));
  for (const q of phones()) {
    const seat = host.page.locator(`[data-testid="seat"][data-name="${q.name}"]`);
    if ((await seat.getAttribute('data-outcome')) === 'win') paid[q.name] = Number(await seat.getAttribute('data-payout'));
  }
  expect(Object.keys(paid).length).toBeGreaterThan(0);
  const total = Object.values(paid).reduce((a, b) => a + b, 0);
  const committed: Record<string, number> = {};
  for (const p of players) committed[p.name] = STARTING_CHIPS - (await chipsOf(p)) + (paid[p.name] ?? 0);
  expect(total).toBe(Object.values(committed).reduce((a, b) => a + b, 0));
  for (const [name, amount] of Object.entries(paid)) {
    await expect(byName(name).page.getByTestId('my-area')).toHaveAttribute('data-outcome', 'win');
    await expect(byName(name).page.getByTestId('my-area')).toHaveAttribute('data-payout', String(amount));
  }
  for (const p of phones()) await expect(p.page.getByTestId('table-turn').locator('.tbl-turn__text')).toHaveText(Object.keys(paid).length > 1 ? /^Split pot/ : /(wins|win) \d+/);
  await chipsConserved();
  await scoresMatchChips();

  // After the results pause the next hand deals on its own.
  for (const p of players) await expect(p.page.getByTestId('hand-indicator')).toHaveAttribute('data-hand', '2', { timeout: 20_000 });
});

test('hand two: two folds hand the pot over with no cards shown, and the last hand ends with the results ranked by chips', async () => {
  await holeCardsStayPrivate();
  await chipsConserved();
  const folders: Player[] = [];
  for (let i = 0; i < 2; i++) {
    const acting = await actor();
    if (!acting) throw new Error('the hand ended before two folds');
    await onlyActorCanMove(acting);
    await move(acting, 'action-fold');
    await expect(acting.page.getByTestId('my-area')).toHaveAttribute('data-status', 'folded');
    folders.push(acting);
  }
  const winner = players.find((p) => !folders.includes(p));
  if (!winner) throw new Error('no winner');
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'results');
    // Nobody's cards are shown: not the winner's, not the folders'.
    await expect(p.page.locator('[data-testid="seat-card"][data-rank]')).toHaveCount(0);
    await expect(p.page.getByTestId('table-turn').locator('.tbl-turn__text')).toHaveText(p === winner ? 'You take the pot' : `${winner.name} takes the pot`);
  }
  await expect(winner.page.getByTestId('my-area')).toHaveAttribute('data-outcome', 'win');
  await scoresMatchChips();
  const chips: Record<string, number> = {};
  for (const p of players) chips[p.name] = await chipsOf(p);
  expect(Object.values(chips).reduce((a, b) => a + b, 0)).toBe(TOTAL_CHIPS);

  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible({ timeout: 20_000 });
    await expect(end.getByTestId('results-entry')).toHaveCount(3);
  }
  const entries = await host.page.getByTestId('results-entry').evaluateAll((els) => els.map((el) => ({ rank: Number((el as HTMLElement).dataset.rank), name: el.textContent ?? '' })));
  for (const entry of entries) {
    const me = players.find((p) => entry.name.includes(p.name));
    if (!me) throw new Error(`results entry without a player: ${entry.name}`);
    expect(entry.rank).toBe(1 + players.filter((p) => chips[p.name] > chips[me.name]).length);
  }
  for (const p of players) await closeResults(p.page);
  for (const p of players) await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
});

test('a second game: the desktop shortcuts, the panel at 320x568, and the host ends it mid-hand with every stake back', async () => {
  await readyAll([pia.page, quinn.page]);
  await expectReadyCount(host.page, 3);
  await host.page.getByTestId('start-game').click();
  for (const p of players) await expect(screen(p)).toHaveAttribute('data-phase', 'acting');
  await holeCardsStayPrivate();

  // The small phone: the whole panel still fits at 320x568, and on the standard phone again.
  await quinn.page.setViewportSize(SMALL);
  await phoneLayoutHolds(quinn, SMALL);
  await quinn.page.setViewportSize(PORTRAIT);
  await phoneLayoutHolds(quinn, PORTRAIT);

  // Play until it is the host's move, then C calls or checks from the keyboard.
  for (let moves = 0; moves < 6; moves++) {
    const acting = await actor();
    if (!acting) throw new Error('the hand ended before the host acted');
    if (acting === host) break;
    await move(acting, (await acting.page.getByTestId('action-call').count()) > 0 ? 'action-call' : 'action-check');
  }
  await expect(host.page.getByTestId('action-fold')).toHaveAttribute('aria-keyshortcuts', 'F');
  const before = await stepOnHost();
  await host.page.getByTestId('my-chips').click();
  await host.page.keyboard.press('c');
  await expect.poll(stepOnHost).not.toBe(before);
  await expect(host.page.getByTestId('my-area')).not.toHaveAttribute('data-status', 'folded');

  // The phones' options sheet has no End game for a guest.
  await pia.page.getByTestId('game-menu').click();
  await expect(pia.page.getByTestId('menu-sheet')).toBeVisible();
  await expect(pia.page.getByTestId('end-game')).toHaveCount(0);
  await pia.page.getByTestId('menu-sheet-close').click();

  await host.page.getByTestId('end-game').click();
  await expect(host.page.getByTestId('end-game-confirm')).toContainText('The hand in play is off. Every bet goes back.');
  await host.page.getByTestId('end-game-no').click();
  await expect(screen(host)).toHaveAttribute('data-phase', 'acting');
  await host.page.getByTestId('end-game').click();
  await host.page.getByTestId('end-game-yes').click();
  for (const p of players) {
    await expect(p.page.getByTestId('overlay-game-end')).toBeVisible();
    await expect(p.page.getByTestId('results-entry')).toHaveCount(3);
    await expect(p.page.getByTestId('results-reason')).toHaveText('The host ended the game.');
  }
  // The stakes went back: three stacks of the starting chips, all sharing first place.
  const ranks = await host.page.getByTestId('results-entry').evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.rank)));
  expect(ranks).toEqual([1, 1, 1]);
  for (const p of players) await closeResults(p.page);
});

const PHONES = [PORTRAIT, { width: 360, height: 740 }, SMALL];
const DESKTOPS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

/**
 * A Poker table of `size` players (a desktop host, a phone and bots on their own sockets that hold
 * their turns): at every phone size and both desktops nothing scrolls, my hand is on screen, every
 * tile's stack is inside its tile, and a desktop's tiles are never squeezed under 28px (a 1280x800
 * table once pushed my cards off the bottom and its tiles down to 8px).
 */
async function bigTable(browser: Browser, base: string, size: number): Promise<void> {
  const hostCtx = await browser.newContext({ viewport: DESKTOPS[1] });
  const phoneCtx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const desk = await hostCtx.newPage();
  const phone = await phoneCtx.newPage();
  const errors: string[] = [];
  for (const p of [desk, phone]) p.on('pageerror', (err) => errors.push(err.message));
  let bots: TableBot[] = [];
  try {
    const code = await createParty(desk, 'Hana', 'poker');
    await joinByCode(phone, 'Pia', code);
    bots = await tableBots(size - 2, code, base, { game: 'poker', hold: true, thinkMs: 50 });
    await readyAll([phone]);
    await expectReadyCount(desk, size);
    await desk.getByTestId('start-game').click();
    for (const p of [desk, phone]) {
      await expect(p.getByTestId('poker-screen')).toHaveAttribute('data-phase', 'acting');
      await expect(p.getByTestId('poker-screen')).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });
      await expect(p.getByTestId('seat')).toHaveCount(size - 1);
    }
    const fits = async (page: Page, sizes: { width: number; height: number }[]) => {
      const own = page.viewportSize();
      for (const s of sizes) {
        const label = `${size} players at ${s.width}x${s.height}`;
        await page.setViewportSize(s);
        const scrolls = () =>
          page.evaluate(() =>
            ['html', '[data-testid="poker-main"]', '[data-testid="pk-table"]', '[data-testid="seats"]'].filter((sel) => {
              const el = document.querySelector(sel);
              return el !== null && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
            }),
          );
        await expect.poll(scrolls, { message: `${label}: nothing scrolls` }).toEqual([]);
        await myAreaOnScreen(page, 'my-area', label);
        await tilesReadable(page, label, s.width > 760 ? 28 : 0);
      }
      if (own) await page.setViewportSize(own);
    };
    await fits(phone, PHONES);
    await fits(desk, DESKTOPS);
    // The seat to act is lit on both pages (its tile, unless it is the page's own seat) and named under the ribbon.
    const turn = (await desk.getByTestId('poker-screen').getAttribute('data-turn-player')) ?? '';
    for (const p of [desk, phone]) {
      const own = await p.getByTestId('my-area').getAttribute('data-player-id');
      if (own === turn) await expect(p.getByTestId('table-turn')).toHaveAttribute('data-state', 'mine');
      else {
        await expect(p.locator(`[data-testid="seat"][data-player-id="${turn}"]`)).toHaveAttribute('data-turn', 'true');
        await expect(p.getByTestId('table-turn')).toHaveAttribute('data-state', 'turn');
      }
    }
    expect(errors).toEqual([]);
  } finally {
    for (const b of bots) b.close();
    await hostCtx.close();
    await phoneCtx.close();
  }
}

for (const size of [2, 6, 12, 23]) {
  test(`${size} players: the table never scrolls on a phone or a desktop, my hand stays on screen and every tile reads`, async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    await bigTable(browser, baseURL ?? 'http://localhost:4173', size);
  });
}

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
