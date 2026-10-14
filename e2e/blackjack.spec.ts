import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createParty, expectReadyCount, joinByCode, readyAll } from './party';

/**
 * A whole two-round Blackjack between a desktop host and two phones (390x844, touch): the chip
 * settings in the lobby, the betting panel (quick bets, slider, Place bet), every hand played out
 * (a stand each, the host doubling down in round two when the cards allow it), the dealer's hole
 * card hidden from every page until the dealer acts, the round's results with the payouts, the
 * chips kept equal to the platform score, and the podium ranked by chips. The shoe is really
 * shuffled, so the assertions hold whatever is dealt. Serial: the tests build on each other.
 */
test.describe.configure({ mode: 'serial' });

const PORTRAIT = { width: 390, height: 844 };
const MIN_TARGET = 44;
const MIN_MOVE_HEIGHT = 56;
/** The other players' strip must show whole seat cards, never a crushed sliver. */
const MIN_SEATS_HEIGHT = 80;
const OUTCOMES = new Set(['win', 'blackjack', 'push', 'loss']);
const STARTING_CHIPS = 500;
const MIN_BET = 25;
const MAX_BET = 200;

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
const screen = (p: Player): Locator => p.page.getByTestId('blackjack-screen');

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

async function noHorizontalOverflow(p: Player): Promise<void> {
  await expect.poll(() => p.page.evaluate(() => document.documentElement.scrollWidth), { message: `${p.name}: document.scrollWidth` }).toBeLessThanOrEqual(PORTRAIT.width);
}

/** My chips as the table shows them. */
async function chipsOf(p: Player): Promise<number> {
  return Number((await p.page.getByTestId('my-chips').getAttribute('data-chips')) ?? 'NaN');
}

/** Every player's platform score, read from the host's player column. */
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

/** Nobody sees the hole card while it is down: one face-up dealer card and one back without a rank anywhere. */
async function holeCardStaysHidden(): Promise<void> {
  for (const p of players) {
    await expect(p.page.getByTestId('dealer-hand')).toHaveAttribute('data-hole-hidden', 'true');
    const cards = p.page.getByTestId('dealer-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute('data-face', 'up');
    await expect(cards.nth(1)).toHaveAttribute('data-face', 'down');
    await expect(cards.nth(1)).not.toHaveAttribute('data-rank', /./);
    await expect(p.page.locator('[data-testid="dealer-card"][data-face="down"] [data-rank]')).toHaveCount(0);
  }
}

/**
 * Plays the round out: whoever holds the hand in play stands (the host doubles down when the
 * table offers it and `hostDoubles` is set), while every other page has its moves greyed out,
 * until the results come up. A natural or a bust ends a hand without a move.
 */
async function playOutRound(hostDoubles: boolean): Promise<void> {
  for (let moves = 0; moves < 12; moves++) {
    const phase = await screen(host).getAttribute('data-phase');
    if (phase === 'results') return;
    let actor: Player | null = null;
    await expect
      .poll(
        async () => {
          if ((await screen(host).getAttribute('data-phase')) === 'results') return 'results';
          for (const p of players) {
            if ((await p.page.getByTestId('my-area').getAttribute('data-my-turn')) === 'true') {
              actor = p;
              return p.name;
            }
          }
          return null;
        },
        { message: 'a player whose move it is, or the results' },
      )
      .not.toBeNull();
    if (!actor) return;
    const acting: Player = actor;
    await holeCardStaysHidden();
    for (const p of players) {
      if (p === acting) continue;
      await expect(p.page.locator('[data-testid="action-hit"]:not([disabled])')).toHaveCount(0);
      await expect(p.page.locator('[data-testid="action-stand"]:not([disabled])')).toHaveCount(0);
    }
    await expect(acting.page.getByTestId('action-hit')).toBeEnabled();
    await expect(acting.page.getByTestId('action-stand')).toBeEnabled();
    const double = acting.page.getByTestId('action-double');
    if (hostDoubles && acting === host && (await double.isEnabled())) {
      const bet = Number(await acting.page.getByTestId('my-hand').first().getAttribute('data-bet'));
      await double.click();
      // One card, then the hand stands with twice the stake down.
      const hand = acting.page.getByTestId('my-hand').first();
      await expect(hand).toHaveAttribute('data-bet', String(bet * 2));
      await expect(hand).toHaveAttribute('data-status', /^(stood|bust)$/);
    } else {
      await acting.page.getByTestId('action-stand').click();
      await expect(acting.page.locator('[data-testid="my-hand"][data-status="acting"]')).toHaveCount(0);
    }
  }
  throw new Error('the round did not reach its results');
}

interface Result {
  name: string;
  outcome: string;
  bet: number;
  payout: number;
  chips: number;
}

async function readResults(p: Player): Promise<Result[]> {
  await expect(p.page.getByTestId('overlay-results')).toBeVisible();
  return p.page.getByTestId('result-hand').evaluateAll((els) =>
    els.map((el) => {
      const e = el as HTMLElement;
      return { name: e.dataset.name ?? '', outcome: e.dataset.outcome ?? '', bet: Number(e.dataset.bet), payout: Number(e.dataset.payout), chips: Number(e.dataset.chips) };
    }),
  );
}

/** The results add up: every page reads the same settlement, each outcome pays by the rules and the chips follow. */
async function checkResults(before: Record<string, number>, bets: Record<string, number>): Promise<Result[]> {
  const results = await readResults(host);
  expect(results.map((r) => r.name).sort()).toEqual(players.map((p) => p.name).sort());
  for (const r of results) {
    expect(OUTCOMES.has(r.outcome), `${r.name}: outcome ${r.outcome}`).toBe(true);
    expect(r.bet).toBeGreaterThanOrEqual(bets[r.name]);
    switch (r.outcome) {
      case 'loss':
        expect(r.payout).toBe(0);
        break;
      case 'push':
        expect(r.payout).toBe(r.bet);
        break;
      case 'win':
        expect(r.payout).toBe(r.bet * 2);
        break;
      case 'blackjack':
        expect(r.payout).toBe(r.bet + Math.floor((r.bet * 3) / 2));
        break;
    }
    // `before` is the stack once the stake left it; a double took the extra stake since, and the payout comes back.
    expect(r.chips).toBe(before[r.name] - (r.bet - bets[r.name]) + r.payout);
  }
  for (const p of phones()) expect(await readResults(p)).toEqual(results);
  for (const p of players) {
    await expect(p.page.getByTestId('dealer-hand')).toHaveAttribute('data-hole-hidden', 'false');
    await expect(p.page.locator('[data-testid="dealer-card"][data-face="down"]')).toHaveCount(0);
    expect(Number(await p.page.getByTestId('dealer-hand').getAttribute('data-cards'))).toBeGreaterThanOrEqual(2);
  }
  return results;
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  quinn = await newPlayer(browser, 'Quinn', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host creates a Blackjack party, two phones join, and the host sets the chips, the limits and the clocks', async () => {
  roomCode = await createParty(host.page, host.name, 'blackjack');
  await expect(host.page.getByTestId('game-picker-meta')).toContainText('Blackjack');
  await expect(host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="blackjack"]')).toHaveAttribute('aria-checked', 'true');
  for (const p of phones()) await joinByCode(p.page, p.name, roomCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(3);

  // Chips: a preset, then a typed amount (the native numeric field), both echoed read-only on the phones.
  await host.page.getByTestId('settings-startingChips-2500').click();
  await expect(pia.page.getByTestId('settings-value-startingChips')).toHaveText('2,500');
  await host.page.getByTestId('settings-startingChips').fill(String(STARTING_CHIPS));
  await host.page.getByTestId('settings-startingChips').press('Enter');
  await expect(pia.page.getByTestId('settings-value-startingChips')).toHaveText(String(STARTING_CHIPS));
  await host.page.getByTestId(`settings-minBet-${MIN_BET}`).click();
  await expect(quinn.page.getByTestId('settings-value-minBet')).toHaveText(String(MIN_BET));
  await host.page.getByTestId('settings-maxBet').fill(String(MAX_BET));
  await host.page.getByTestId('settings-maxBet').press('Enter');
  await expect(quinn.page.getByTestId('settings-value-maxBet')).toHaveText(String(MAX_BET));
  // A maximum under the minimum is lifted back to it by the server.
  await host.page.getByTestId('settings-maxBet').fill('5');
  await host.page.getByTestId('settings-maxBet').press('Enter');
  await expect(quinn.page.getByTestId('settings-value-maxBet')).toHaveText(String(MIN_BET));
  await host.page.getByTestId('settings-maxBet').fill(String(MAX_BET));
  await host.page.getByTestId('settings-maxBet').press('Enter');
  await expect(quinn.page.getByTestId('settings-value-maxBet')).toHaveText(String(MAX_BET));

  await host.page.getByTestId('settings-rounds').fill('2');
  await host.page.getByTestId('settings-betSeconds').fill('60');
  await host.page.getByTestId('settings-actSeconds').fill('60');
  await host.page.getByTestId('settings-resultsSeconds').fill('20');
  await expect(pia.page.getByTestId('settings-value-rounds')).toHaveText('2');
  await expect(pia.page.getByTestId('settings-value-betSeconds')).toHaveText('60s');
  await expect(pia.page.getByTestId('settings-value-resultsSeconds')).toHaveText('20s');
  await expect(pia.page.getByTestId('settings-startingChips')).toHaveCount(0);
  await expect(pia.page.getByTestId('settings-blackjackPayout')).toHaveCount(0);
  await expect(pia.page.getByTestId('settings-value-blackjackPayout')).toHaveText('3 to 2');
  await expect(host.page.getByTestId('settings-allowDouble')).toBeChecked();
  await expect(host.page.getByTestId('settings-allowSplit')).toBeChecked();
  await expect(host.page.getByTestId('settings-dealerHitsSoft17')).not.toBeChecked();

  // A solo table is a legal game (minPlayers 1): Start is open to the host alone, and counts the phones once they ready up.
  await expectReadyCount(host.page, 1);
  await readyAll([pia.page, quinn.page]);
  await expectReadyCount(host.page, 3);
  await host.page.getByTestId('start-game').click();
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'betting');
    await expect(p.page.getByTestId('round-indicator')).toHaveAttribute('data-round', '1');
    await expect(p.page.getByTestId('round-indicator')).toHaveAttribute('data-total', '2');
    await expect(p.page.getByTestId('blackjack-header').getByTestId('timer')).toBeVisible();
    expect(await chipsOf(p)).toBe(STARTING_CHIPS);
  }
  await expect(host.page.getByTestId('chat-log')).toContainText('Round 1 of 2: place your bets!');
  await scoresMatchChips();
});

test('round one: the phone betting panel fits, the quick bets and the slider set the stake, and the deal follows the last bet', async () => {
  for (const p of phones()) {
    await noHorizontalOverflow(p);
    const panel = p.page.getByTestId('bet-panel');
    await expect(panel).toHaveAttribute('data-min', String(MIN_BET));
    await expect(panel).toHaveAttribute('data-max', String(MAX_BET));
    const input = p.page.getByTestId('bet-input');
    expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), 'the bet field is at least 16px so iOS does not zoom').toBeGreaterThanOrEqual(16);
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    expect((await boxOf(p.page.getByTestId('place-bet'))).height).toBeGreaterThanOrEqual(MIN_MOVE_HEIGHT);
    for (const id of ['bet-min', 'bet-plus-10', 'bet-plus-50', 'bet-plus-100', 'bet-double', 'bet-max', 'players-toggle', 'chat-toggle', 'game-menu']) {
      expect((await boxOf(p.page.getByTestId(id))).height, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    }
    expect((await boxOf(p.page.getByTestId('seats'))).height, 'the other seats are not crushed by the overflowing column').toBeGreaterThanOrEqual(MIN_SEATS_HEIGHT);
  }

  // The host: Max then Min then +50 lands on 75; the slider and the field follow the quick bets.
  const panel = host.page.getByTestId('bet-panel');
  await host.page.getByTestId('bet-max').click();
  await expect(panel).toHaveAttribute('data-amount', String(MAX_BET));
  await expect(host.page.getByTestId('bet-slider')).toHaveValue(String(MAX_BET));
  await host.page.getByTestId('bet-min').click();
  await expect(panel).toHaveAttribute('data-amount', String(MIN_BET));
  await host.page.getByTestId('bet-plus-50').click();
  await expect(panel).toHaveAttribute('data-amount', '75');
  await expect(host.page.getByTestId('bet-input')).toHaveValue('75');
  await host.page.getByTestId('place-bet').click();
  await expect(host.page.getByTestId('bet-placed')).toHaveAttribute('data-bet', '75');
  await expect(host.page.getByTestId('bet-waiting')).toContainText('Waiting for Pia, Quinn');
  expect(await chipsOf(host)).toBe(STARTING_CHIPS - 75);
  // The stake can still be changed until the cards come: back to 50.
  await host.page.getByTestId('change-bet').click();
  await host.page.getByTestId('bet-input').fill('50');
  await host.page.getByTestId('place-bet').click();
  await expect(host.page.getByTestId('bet-placed')).toHaveAttribute('data-bet', '50');
  expect(await chipsOf(host)).toBe(STARTING_CHIPS - 50);
  await expect(pia.page.locator('[data-testid="seat"][data-name="Hana"]')).toHaveAttribute('data-bet', '50');

  // Quinn types an amount over the cap and sends it with the keyboard's Go: the cap is placed at
  // once, with no native validation bubble swallowing the submit; then she drags the slider to 125.
  await quinn.page.getByTestId('bet-input').fill('9999');
  await quinn.page.getByTestId('bet-input').press('Enter');
  await expect(quinn.page.getByTestId('bet-placed')).toHaveAttribute('data-bet', String(MAX_BET));
  expect(await chipsOf(quinn)).toBe(STARTING_CHIPS - MAX_BET);
  await quinn.page.getByTestId('change-bet').click();
  await quinn.page.getByTestId('bet-slider').fill('125');
  await expect(quinn.page.getByTestId('bet-panel')).toHaveAttribute('data-amount', '125');
  await expect(quinn.page.getByTestId('bet-input')).toHaveValue('125');
  await quinn.page.getByTestId('place-bet').click();
  await expect(quinn.page.getByTestId('bet-placed')).toHaveAttribute('data-bet', '125');
  await expect(host.page.locator('[data-testid="seat"][data-name="Quinn"]')).toHaveAttribute('data-bet', '125');

  // Pia doubles the minimum with ×2; her stake is the last and deals the cards.
  await pia.page.getByTestId('bet-min').click();
  await pia.page.getByTestId('bet-double').click();
  await expect(pia.page.getByTestId('bet-panel')).toHaveAttribute('data-amount', String(MIN_BET * 2));
  await pia.page.getByTestId('place-bet').click();

  // The last stake deals the cards: two each, the dealer's hole card face down everywhere.
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', /^(acting|results)$/);
    await expect(p.page.getByTestId('my-hand')).toHaveCount(1);
    expect(Number(await p.page.getByTestId('my-hand').getAttribute('data-total'))).toBeGreaterThanOrEqual(4);
    await expect(p.page.getByTestId('seat')).toHaveCount(2);
  }
  for (const p of phones()) expect((await boxOf(p.page.getByTestId('seats'))).height, 'the acting strip keeps its height').toBeGreaterThanOrEqual(MIN_SEATS_HEIGHT);
  expect(await chipsOf(host)).toBe(450);
  expect(await chipsOf(pia)).toBe(450);
  expect(await chipsOf(quinn)).toBe(375);
  await scoresMatchChips();
  for (const p of phones()) await noHorizontalOverflow(p);
});

test('round one: every hand is played out in turn, the dealer settles and the results pay by the rules', async () => {
  const before = { Hana: 450, Pia: 450, Quinn: 375 };
  const bets = { Hana: 50, Pia: 50, Quinn: 125 };
  if ((await screen(host).getAttribute('data-phase')) === 'acting') {
    for (const p of phones()) {
      await noHorizontalOverflow(p);
      for (const id of ['action-hit', 'action-stand', 'action-double', 'action-split']) {
        const button = p.page.getByTestId(id);
        if (await button.count()) expect((await boxOf(button)).height, `${id} is a 56px target`).toBeGreaterThanOrEqual(MIN_MOVE_HEIGHT);
      }
    }
  }
  await playOutRound(false);
  const results = await checkResults(before, bets);
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'results');
    await expect(p.page.getByTestId('results-headline')).toContainText(/The dealer/);
  }
  for (const p of phones()) {
    await noHorizontalOverflow(p);
    await expect(p.page.getByTestId('results-countdown')).toHaveAttribute('data-countdown', 'running');
  }
  await scoresMatchChips();
  const line = results.map((r) => r.name);
  expect(line).toHaveLength(3);
  await expect(host.page.getByTestId('bj-next')).toContainText('Next round');
  await host.page.getByTestId('bj-next').click();
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'betting');
    await expect(p.page.getByTestId('round-indicator')).toHaveAttribute('data-round', '2');
    await expect(p.page.getByTestId('overlay-results')).toHaveCount(0);
  }
});

test('round two: minimum bets all round, the host doubles down when offered, and the last round ends on the podium ranked by chips', async () => {
  const before: Record<string, number> = {};
  for (const p of players) {
    before[p.name] = await chipsOf(p);
    expect(before[p.name]).toBeGreaterThanOrEqual(MIN_BET);
    await p.page.getByTestId('bet-min').click();
    await p.page.getByTestId('place-bet').click();
    await expect(p.page.getByTestId('bet-placed').or(p.page.getByTestId('my-hand')).first()).toBeVisible();
    before[p.name] -= MIN_BET;
  }
  for (const p of players) await expect(p.page.getByTestId('my-hand')).toHaveCount(1);
  await scoresMatchChips();
  await playOutRound(true);
  const results = await checkResults(before, { Hana: MIN_BET, Pia: MIN_BET, Quinn: MIN_BET });
  const hana = results.find((r) => r.name === host.name);
  if (!hana) throw new Error('no result for the host');
  // A double is twice the stake; a natural (no move) keeps it.
  expect([MIN_BET, MIN_BET * 2]).toContain(hana.bet);
  const chips: Record<string, number> = {};
  for (const p of players) chips[p.name] = await chipsOf(p);
  await scoresMatchChips();

  await expect(host.page.getByTestId('bj-next')).toContainText('Final standings');
  await host.page.getByTestId('bj-next').click();
  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible();
    await expect(end.getByTestId('podium-entry')).toHaveCount(3);
  }
  // The podium ranks by chips: scores equal the stacks, ranks follow them.
  const entries = await host.page.getByTestId('podium-entry').evaluateAll((els) => els.map((el) => ({ rank: Number((el as HTMLElement).dataset.rank), name: el.textContent ?? '' })));
  const ranked = [...players].map((p) => ({ name: p.name, chips: chips[p.name] })).sort((a, b) => b.chips - a.chips);
  for (const entry of entries) {
    const me = ranked.find((r) => entry.name.includes(r.name));
    if (!me) throw new Error(`podium entry without a player: ${entry.name}`);
    expect(entry.rank).toBe(1 + ranked.filter((r) => r.chips > me.chips).length);
  }
  await expect(host.page.getByTestId('chat-log')).toContainText('Game over!');

  await expect(host.page.getByTestId('back-to-lobby')).toBeVisible();
  await host.page.getByTestId('back-to-lobby').click();
  for (const p of players) await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
  await readyAll([pia.page, quinn.page]);
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
