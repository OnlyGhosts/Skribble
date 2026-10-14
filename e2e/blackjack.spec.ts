import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createParty, expectReadyCount, joinByCode, readyAll } from './party';

/**
 * Blackjack the Stake way, between a desktop host and two phones (390x844, touch): unlimited
 * rounds set in the lobby, bets through the control panel (1/2, 2x, MAX, a typed amount, Enter,
 * the Space shortcut), hands played one at a time in seat order with only the acting page's
 * moves lit, the hole card hidden on every page until the dealer plays, the settled table staying
 * up through the next betting with each outcome paid by the rules, the chips always equal to the
 * platform score, and the host's End game taking the table to the podium. The phone layout is
 * checked at 390x844 and 320x568. The shoe is really shuffled, so the checks hold whatever is
 * dealt; re-splits are covered by the unit tests. Serial: the tests build on each other.
 */
test.describe.configure({ mode: 'serial' });

const PORTRAIT = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const MIN_TARGET = 44;
const STARTING_CHIPS = 500;
const MIN_BET = 25;
const MAX_BET = 200;
const SEATS = ['Hana', 'Pia', 'Quinn'];

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
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

/** The phone layout holds: no sideways scroll, the whole panel on screen, every control a 44px target. */
async function phoneLayoutHolds(p: Player, size: { width: number; height: number }): Promise<void> {
  await expect.poll(() => p.page.evaluate(() => document.documentElement.scrollWidth), { message: `${p.name}: document.scrollWidth` }).toBeLessThanOrEqual(size.width);
  const panel = await boxOf(p.page.getByTestId('bj-panel'));
  expect(panel.y, `${p.name}: the panel starts on screen`).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.height, `${p.name}: the panel ends on screen`).toBeLessThanOrEqual(size.height + 0.5);
  expect(panel.x + panel.width).toBeLessThanOrEqual(size.width + 0.5);
  for (const id of ['bet-input', 'bet-half', 'bet-double', 'bet-max', 'action-hit', 'action-stand', 'action-split', 'action-double', 'place-bet', 'players-toggle', 'chat-toggle', 'game-menu']) {
    const box = await boxOf(p.page.getByTestId(id));
    expect(box.height, `${p.name}: ${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box.y + box.height, `${p.name}: ${id} is on screen`).toBeLessThanOrEqual(size.height + 0.5);
  }
  expect(await p.page.getByTestId('bet-input').evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), 'the bet field is 16px so iOS does not zoom').toBeGreaterThanOrEqual(16);
}

/** My chips, the truth behind the balance. */
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

/** Nobody sees the hole card while it is down: one face-up dealer card and one back without a rank. */
async function holeCardStaysHidden(): Promise<void> {
  for (const p of players) {
    const dealer = p.page.getByTestId('dealer-hand');
    await expect(dealer).toHaveAttribute('data-hole-hidden', 'true');
    const cards = dealer.getByTestId('dealer-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute('data-face', 'up');
    await expect(cards.nth(1)).toHaveAttribute('data-face', 'down');
    await expect(cards.nth(1)).not.toHaveAttribute('data-rank', /./);
    await expect(dealer.locator('[data-face="down"] [data-rank], [data-face="down"][data-rank]')).toHaveCount(0);
  }
}

async function placeBetWith(p: Player, act: () => Promise<void>, expected: number): Promise<void> {
  await act();
  await expect(p.page.getByTestId('my-bet')).toHaveAttribute('data-bet', String(expected));
  await expect(p.page.getByTestId('place-bet')).toBeDisabled();
}

interface Turn {
  player: string;
  hand: number;
}

/**
 * Plays the round out one hand at a time. Whoever's page has Stand lit acts (a hit under 12, the
 * host doubles when `hostDoubles` and the table offers it, otherwise a stand); every other page
 * has its moves dimmed and names the acting player. Returns the turns in the order they came.
 */
async function playOutRound(round: number, hostDoubles: boolean, onFirstTurn?: () => Promise<void>): Promise<Turn[]> {
  const turns: Turn[] = [];
  const settled = async () => (await screen(host).getAttribute('data-phase')) !== 'acting' && (await host.page.getByTestId('bj-table').getAttribute('data-round')) === String(round) && (await host.page.getByTestId('bj-table').getAttribute('data-settled')) === 'true';
  for (let moves = 0; moves < 24; moves++) {
    let actor: Player | null = null;
    await expect
      .poll(
        async () => {
          if (await settled()) return 'settled';
          for (const p of players) {
            if (await p.page.getByTestId('action-stand').isEnabled()) {
              actor = p;
              return p.name;
            }
          }
          return null;
        },
        { message: 'a player whose turn it is, or the settled round' },
      )
      .not.toBeNull();
    if (!actor) return turns;
    const acting: Player = actor;
    const turnPlayer = await screen(host).getAttribute('data-turn-player');
    const hand = Number(await screen(acting).getAttribute('data-turn-hand'));
    turns.push({ player: acting.name, hand });
    if (turns.length === 1) {
      await holeCardStaysHidden();
      await onFirstTurn?.();
    }
    for (const p of players) {
      if (p === acting) {
        await expect(p.page.getByTestId('turn-status')).toHaveAttribute('data-state', 'my-turn');
        continue;
      }
      await expect(p.page.getByTestId('turn-status')).toHaveText(`${acting.name}'s turn`);
      for (const id of ['action-hit', 'action-stand', 'action-double', 'action-split', 'place-bet']) await expect(p.page.getByTestId(id)).toBeDisabled();
    }
    expect(turnPlayer).not.toBeNull();
    await expect(acting.page.getByTestId('action-hit')).toBeEnabled();
    const active = acting.page.locator('[data-testid="my-hand"][data-active="true"]');
    await expect(active).toHaveCount(1);
    const total = Number(await active.getAttribute('data-total'));
    const bet = Number(await active.getAttribute('data-bet'));
    const cards = Number(await active.getAttribute('data-cards'));
    const double = acting.page.getByTestId('action-double');
    if (hostDoubles && acting === host && (await double.isEnabled())) {
      // The keyboard shortcut on the desktop: D doubles, one more card, the stake twice.
      await host.page.keyboard.press('d');
      await expect(host.page.locator(`[data-testid="my-hand"][data-index="${hand}"]`)).toHaveAttribute('data-bet', String(bet * 2));
    } else if (total < 12) {
      await acting.page.getByTestId('action-hit').click();
      await expect.poll(async () => (await settled()) || Number(await acting.page.locator(`[data-testid="my-hand"][data-index="${hand}"]`).getAttribute('data-cards')) > cards).toBe(true);
    } else {
      await acting.page.getByTestId('action-stand').click();
    }
  }
  throw new Error('the round did not settle');
}

/** Turns go seat by seat (join order), each seat's hands left to right, never back. */
function turnsInSeatOrder(turns: Turn[]): void {
  const rank = (t: Turn) => SEATS.indexOf(t.player) * 10 + t.hand;
  for (let i = 1; i < turns.length; i++) expect(rank(turns[i]), `turn ${i}: ${JSON.stringify(turns)}`).toBeGreaterThanOrEqual(rank(turns[i - 1]));
}

interface SettledHand {
  outcome: string;
  bet: number;
  payout: number;
}

async function settledHands(p: Player): Promise<SettledHand[]> {
  const hands = p.page.getByTestId('my-hand');
  await expect(hands.first()).toBeVisible();
  await expect(p.page.locator('[data-testid="my-hand"]:not([data-outcome])')).toHaveCount(0);
  return hands.evaluateAll((els) => els.map((el) => ({ outcome: (el as HTMLElement).dataset.outcome ?? '', bet: Number((el as HTMLElement).dataset.bet), payout: Number((el as HTMLElement).dataset.payout) })));
}

/**
 * The settled round, on every page: the dealer turned over, each hand paid by the rules (loss 0,
 * push the stake, win twice it, blackjack 3 to 2 on top) and the chips following the payouts.
 * `before` is each stack once the round's first stake left it.
 */
async function checkSettlement(round: number, before: Record<string, number>, stakes: Record<string, number>): Promise<void> {
  for (const p of players) {
    await expect(p.page.getByTestId('bj-table')).toHaveAttribute('data-round', String(round));
    await expect(p.page.getByTestId('bj-table')).toHaveAttribute('data-settled', 'true');
    await expect(p.page.getByTestId('dealer-hand')).toHaveAttribute('data-hole-hidden', 'false');
    await expect(p.page.locator('[data-testid="dealer-card"][data-face="down"]')).toHaveCount(0);
    expect(Number(await p.page.getByTestId('dealer-hand').getAttribute('data-cards'))).toBeGreaterThanOrEqual(2);
    const hands = await settledHands(p);
    let staked = 0;
    let back = 0;
    for (const h of hands) {
      staked += h.bet;
      back += h.payout;
      switch (h.outcome) {
        case 'loss':
          expect(h.payout).toBe(0);
          break;
        case 'push':
          expect(h.payout).toBe(h.bet);
          break;
        case 'win':
          expect(h.payout).toBe(h.bet * 2);
          break;
        case 'blackjack':
          expect(h.payout).toBe(h.bet + Math.floor((h.bet * 3) / 2));
          break;
        default:
          throw new Error(`${p.name}: unknown outcome ${h.outcome}`);
      }
    }
    // Doubles and splits took their extra stakes from the stack; the payouts came back to it.
    await expect.poll(() => chipsOf(p), { message: `${p.name}: chips after the settle` }).toBe(before[p.name] - (staked - stakes[p.name]) + back);
    // The other pages show the same seat settled in their strip.
    for (const other of players) {
      if (other === p) continue;
      await expect(other.page.locator(`[data-testid="seat"][data-name="${p.name}"] [data-testid="seat-hand"]:not([data-outcome])`)).toHaveCount(0);
      await expect(other.page.locator(`[data-testid="seat"][data-name="${p.name}"] [data-testid="seat-hand"]`)).toHaveCount(hands.length);
    }
  }
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana', { viewport: { width: 1440, height: 900 } });
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  quinn = await newPlayer(browser, 'Quinn', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host sets up an unlimited Blackjack table and two phones join', async () => {
  roomCode = await createParty(host.page, host.name, 'blackjack');
  for (const p of phones()) await joinByCode(p.page, p.name, roomCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(3);

  await host.page.getByTestId('settings-startingChips').fill(String(STARTING_CHIPS));
  await host.page.getByTestId('settings-startingChips').press('Enter');
  await expect(pia.page.getByTestId('settings-value-startingChips')).toHaveText(String(STARTING_CHIPS));
  await host.page.getByTestId(`settings-minBet-${MIN_BET}`).click();
  await expect(quinn.page.getByTestId('settings-value-minBet')).toHaveText(String(MIN_BET));
  await host.page.getByTestId('settings-maxBet').fill(String(MAX_BET));
  await host.page.getByTestId('settings-maxBet').press('Enter');
  await expect(quinn.page.getByTestId('settings-value-maxBet')).toHaveText(String(MAX_BET));

  // Rounds: 10 by default, then Unlimited (stored as 0), shown as such on every page.
  await expect(pia.page.getByTestId('settings-value-rounds')).toHaveText('10');
  await expect(host.page.getByTestId('settings-unlimitedRounds')).not.toBeChecked();
  await host.page.getByTestId('settings-row-unlimitedRounds').click();
  await expect(host.page.getByTestId('settings-unlimitedRounds')).toBeChecked();
  for (const p of players) await expect(p.page.getByTestId('settings-value-rounds')).toHaveText('Unlimited');
  await expect(host.page.getByTestId('settings-rounds')).toHaveCount(0);

  await host.page.getByTestId('settings-betSeconds').fill('60');
  await host.page.getByTestId('settings-actSeconds').fill('60');
  await host.page.getByTestId('settings-resultsSeconds').fill('4');
  await expect(pia.page.getByTestId('settings-value-betSeconds')).toHaveText('60s');
  await expect(pia.page.getByTestId('settings-value-actSeconds')).toHaveText('60s');
  await expect(pia.page.getByTestId('settings-value-resultsSeconds')).toHaveText('4s');
  await expect(pia.page.getByTestId('settings-value-blackjackPayout')).toHaveText('3 to 2');
  await expect(host.page.getByTestId('settings-allowSplit')).toBeChecked();
  // No insurance anywhere.
  for (const p of players) await expect(p.page.getByText(/insurance/i)).toHaveCount(0);

  await readyAll([pia.page, quinn.page]);
  await expectReadyCount(host.page, 3);
  await host.page.getByTestId('start-game').click();
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'betting');
    await expect(p.page.getByTestId('round-indicator')).toHaveAttribute('data-round', '1');
    await expect(p.page.getByTestId('round-indicator')).toHaveAttribute('data-total', '0');
    await expect(p.page.getByTestId('round-indicator')).toContainText('Round 1');
    await expect(p.page.getByTestId('round-indicator')).not.toContainText(' of ');
    await expect(p.page.getByTestId('table-ribbon')).toContainText('BLACKJACK PAYS 3 TO 2');
    await expect(p.page.getByTestId('turn-status')).toHaveText('Place your bet');
    expect(await chipsOf(p)).toBe(STARTING_CHIPS);
  }
  await expect(host.page.getByTestId('hotkey-hint')).toBeVisible();
  await expect(host.page.getByTestId('place-bet')).toHaveAttribute('aria-keyshortcuts', 'Space');
  for (const p of phones()) await expect(p.page.getByTestId('hotkey-hint')).toHaveCount(0);
  await scoresMatchChips();
});

test('round one: the phone layout fits, and bets go in through the panel', async () => {
  for (const p of phones()) await phoneLayoutHolds(p, PORTRAIT);
  // The small phone: the whole panel still fits at 320x568.
  await quinn.page.setViewportSize(SMALL);
  await phoneLayoutHolds(quinn, SMALL);
  await quinn.page.setViewportSize(PORTRAIT);

  // While the bets are open nobody can play a hand.
  for (const p of players) for (const id of ['action-hit', 'action-stand', 'action-double', 'action-split']) await expect(p.page.getByTestId(id)).toBeDisabled();

  // The host: the field starts at the minimum; MAX, 1/2, 2x walk it, then a typed 75 goes in with Enter.
  const panel = host.page.getByTestId('bj-panel');
  await expect(host.page.getByTestId('bet-input')).toHaveValue(String(MIN_BET));
  await host.page.getByTestId('bet-max').click();
  await expect(panel).toHaveAttribute('data-amount', String(MAX_BET));
  await host.page.getByTestId('bet-half').click();
  await expect(panel).toHaveAttribute('data-amount', String(MAX_BET / 2));
  await host.page.getByTestId('bet-double').click();
  await expect(panel).toHaveAttribute('data-amount', String(MAX_BET));
  await host.page.getByTestId('bet-clear').click();
  await expect(host.page.getByTestId('bet-input')).toHaveValue('');
  await expect(host.page.getByTestId('place-bet')).toBeDisabled();
  await host.page.getByTestId('bet-input').fill('75');
  await placeBetWith(host, () => host.page.getByTestId('bet-input').press('Enter'), 75);
  expect(await chipsOf(host)).toBe(STARTING_CHIPS - 75);
  await expect(host.page.getByTestId('turn-status')).toHaveText('Waiting for Pia and Quinn');
  await expect(pia.page.locator('[data-testid="seat"][data-name="Hana"]')).toHaveAttribute('data-bet', '75');

  // Quinn types more than the table allows: the bet is clamped to the maximum.
  await quinn.page.getByTestId('bet-input').fill('9999');
  await placeBetWith(quinn, () => quinn.page.getByTestId('place-bet').click(), MAX_BET);
  expect(await chipsOf(quinn)).toBe(STARTING_CHIPS - MAX_BET);

  // Pia: 1/2 cannot go under the minimum, 2x doubles it; her bet deals the cards.
  await pia.page.getByTestId('bet-half').click();
  await expect(pia.page.getByTestId('bj-panel')).toHaveAttribute('data-amount', String(MIN_BET));
  await pia.page.getByTestId('bet-double').click();
  await expect(pia.page.getByTestId('bet-input')).toHaveValue(String(MIN_BET * 2));
  await pia.page.getByTestId('place-bet').click();

  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', /^(acting|betting)$/);
    await expect(p.page.getByTestId('my-hand')).toHaveCount(1);
    await expect(p.page.getByTestId('seat')).toHaveCount(2);
  }
  expect(await chipsOf(host)).toBe(STARTING_CHIPS - 75);
  expect(await chipsOf(pia)).toBe(STARTING_CHIPS - 50);
  expect(await chipsOf(quinn)).toBe(STARTING_CHIPS - MAX_BET);
});

test('round one: hands are played one at a time in seat order, then the dealer settles and the table stays up', async () => {
  const before = { Hana: STARTING_CHIPS - 75, Pia: STARTING_CHIPS - 50, Quinn: STARTING_CHIPS - MAX_BET };
  const turns = await playOutRound(1, false, async () => {
    for (const p of phones()) await phoneLayoutHolds(p, PORTRAIT);
  });
  turnsInSeatOrder(turns);
  await checkSettlement(1, before, { Hana: 75, Pia: 50, Quinn: MAX_BET });
  // Straight into the next round's betting, the settled table still on show.
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'betting');
    await expect(p.page.getByTestId('round-indicator')).toHaveAttribute('data-round', '2');
    await expect(p.page.getByTestId('overlay-results')).toHaveCount(0);
  }
  await scoresMatchChips();
});

test('round two: the amount is remembered, Space bets on the desktop, and the host ends the game after the hand', async () => {
  const before: Record<string, number> = {};
  const stakes: Record<string, number> = {};
  for (const p of players) before[p.name] = await chipsOf(p);
  // Each field starts from the bet placed last round, clamped to what the player now holds.
  await expect(host.page.getByTestId('bet-input')).toHaveValue(String(Math.min(75, before.Hana)));
  await expect(pia.page.getByTestId('bet-input')).toHaveValue(String(Math.min(50, before.Pia)));

  for (const p of phones()) {
    const amount = Number(await p.page.getByTestId('bj-panel').getAttribute('data-amount'));
    await expect(p.page.getByTestId('place-bet')).toBeEnabled();
    await placeBetWith(p, () => p.page.getByTestId('place-bet').click(), amount);
    stakes[p.name] = amount;
  }
  const hanaAmount = Number(await host.page.getByTestId('bj-panel').getAttribute('data-amount'));
  stakes.Hana = hanaAmount;
  await expect(host.page.getByTestId('place-bet')).toBeEnabled();
  await host.page.locator('body').click({ position: { x: 700, y: 450 } });
  await host.page.keyboard.press('Space');
  for (const p of players) before[p.name] -= stakes[p.name];

  for (const p of players) await expect(p.page.getByTestId('my-hand')).toHaveCount(1);
  const turns = await playOutRound(2, true, async () => {
    // The host asks to end the game during the hand: it finishes first.
    await host.page.getByTestId('end-game').click();
    await expect(host.page.getByTestId('end-game-confirm')).toContainText('End after this hand?');
    await host.page.getByTestId('end-game-yes').click();
    await expect(host.page.getByTestId('end-game-requested')).toBeVisible();
    await expect(host.page.getByTestId('phase-kicker')).toHaveText('Last hand');
    await expect(host.page.getByTestId('chat-log')).toContainText('The host ends the game after this hand.');
  });
  turnsInSeatOrder(turns);
  await checkSettlement(2, before, stakes);

  const chips: Record<string, number> = {};
  for (const p of players) chips[p.name] = await chipsOf(p);
  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible({ timeout: 20_000 });
    await expect(end.getByTestId('podium-entry')).toHaveCount(3);
  }
  // The podium ranks by chips.
  const entries = await host.page.getByTestId('podium-entry').evaluateAll((els) => els.map((el) => ({ rank: Number((el as HTMLElement).dataset.rank), name: el.textContent ?? '' })));
  const ranked = players.map((p) => ({ name: p.name, chips: chips[p.name] }));
  for (const entry of entries) {
    const me = ranked.find((r) => entry.name.includes(r.name));
    if (!me) throw new Error(`podium entry without a player: ${entry.name}`);
    expect(entry.rank).toBe(1 + ranked.filter((r) => r.chips > me.chips).length);
  }
  await expect(host.page.getByTestId('back-to-lobby')).toBeVisible();
  await host.page.getByTestId('back-to-lobby').click();
  for (const p of players) await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
});

test('no page errors, and no em dash on any page', async () => {
  for (const p of players) expect(await p.page.evaluate(() => document.body.innerText.includes('\u2014'))).toBe(false);
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
