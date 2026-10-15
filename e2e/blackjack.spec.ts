import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createParty, expectReadyCount, joinByCode, readyAll } from './party';
import { tableBots, type TableBot } from './tableBots';

/**
 * Blackjack the Stake way, between a desktop host and two phones (390x844, touch): no rounds and
 * no table limits to set (the rounds never run out, any bet from 1 chip to the whole stack), bets
 * through the control panel (1/2, 2x, MAX for all in, a typed amount, Enter, the Space shortcut), hands played one at a time in seat order with only the acting page's
 * moves lit, the hole card hidden on every page until the dealer plays, the settled table staying
 * up through the next betting with each outcome paid by the rules, the chips always equal to the
 * platform score, and the host's End game taking the table to the podium. The phone layout is
 * checked at 390x844 and 320x568. Then tables of 2, 6, 12, 24 and 50 players (bots on their own
 * sockets): nothing scrolls at any phone size or on a desktop, the tiles step down with the table,
 * and the seat in play is marked on every page. The shoe is really shuffled, so the checks hold
 * whatever is dealt; re-splits are covered by the unit tests. Serial: the tests build on each other.
 */
test.describe.configure({ mode: 'serial' });

const PORTRAIT = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const MIN_TARGET = 44;
const STARTING_CHIPS = 500;
/** What the bet field offers before a first bet: a hundredth of the starting stack. */
const SUGGESTED_BET = 5;
const PIA_BET = 2;
const QUINN_BET = STARTING_CHIPS / 2;
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
  await nothingScrolls(p.page, p.name);
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
    const turnBefore = await turnKeyOf(acting);
    if (hostDoubles && acting === host && (await double.isEnabled())) {
      // The keyboard shortcut on the desktop: D doubles, one more card, the stake twice.
      await host.page.keyboard.press('d');
      await expect(host.page.locator(`[data-testid="my-hand"][data-index="${hand}"]`)).toHaveAttribute('data-bet', String(bet * 2));
    } else if (total < 12) {
      await acting.page.getByTestId('action-hit').click();
      await expect.poll(async () => (await settled()) || Number(await acting.page.locator(`[data-testid="my-hand"][data-index="${hand}"]`).getAttribute('data-cards')) > cards).toBe(true);
      continue;
    } else {
      await acting.page.getByTestId('action-stand').click();
    }
    // A stand or a double ends the hand, but the acting page keeps Stand lit until the server's
    // answer reaches it: wait for its turn to move on, or the next poll would find the same turn again.
    await expect
      .poll(async () => (await settled()) || (await turnKeyOf(acting)) !== turnBefore, { message: `${acting.name}: the turn moves on after the move` })
      .toBe(true);
  }
  throw new Error('the round did not settle');
}

/** Whose turn, on which hand, in which round, as `p`'s page has it. */
async function turnKeyOf(p: Player): Promise<string> {
  return screen(p).evaluate((el) => ['phase', 'round', 'turnPlayer', 'turnHand'].map((k) => (el as HTMLElement).dataset[k] ?? '').join(':'));
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

test('the host sets up a Blackjack table (no rounds or table limits to set) and two phones join', async () => {
  roomCode = await createParty(host.page, host.name, 'blackjack');
  for (const p of phones()) await joinByCode(p.page, p.name, roomCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(3);

  await host.page.getByTestId('settings-startingChips').fill(String(STARTING_CHIPS));
  await host.page.getByTestId('settings-startingChips').press('Enter');
  await expect(pia.page.getByTestId('settings-value-startingChips')).toHaveText(String(STARTING_CHIPS));
  // No rounds, minimum or maximum bet anywhere: the game runs until one stack is left or the host ends it.
  for (const p of players) {
    for (const id of ['rounds', 'unlimitedRounds', 'minBet', 'maxBet']) {
      await expect(p.page.getByTestId(`settings-${id}`)).toHaveCount(0);
      await expect(p.page.getByTestId(`settings-value-${id}`)).toHaveCount(0);
    }
  }

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

  // The host: the field starts at a suggested amount; MAX is all in, 1/2 and 2x walk it, then a typed 75 goes in with Enter.
  const panel = host.page.getByTestId('bj-panel');
  await expect(host.page.getByTestId('bet-input')).toHaveValue(String(SUGGESTED_BET));
  await expect(panel).toHaveAttribute('data-min', '1');
  await expect(panel).toHaveAttribute('data-max', String(STARTING_CHIPS));
  await host.page.getByTestId('bet-max').click();
  await expect(panel).toHaveAttribute('data-amount', String(STARTING_CHIPS));
  await host.page.getByTestId('bet-half').click();
  await expect(panel).toHaveAttribute('data-amount', String(STARTING_CHIPS / 2));
  await host.page.getByTestId('bet-double').click();
  await expect(panel).toHaveAttribute('data-amount', String(STARTING_CHIPS));
  await host.page.getByTestId('bet-double').click();
  await expect(panel).toHaveAttribute('data-amount', String(STARTING_CHIPS));
  await host.page.getByTestId('bet-clear').click();
  await expect(host.page.getByTestId('bet-input')).toHaveValue('');
  await expect(host.page.getByTestId('place-bet')).toBeDisabled();
  await host.page.getByTestId('bet-input').fill('75');
  await placeBetWith(host, () => host.page.getByTestId('bet-input').press('Enter'), 75);
  expect(await chipsOf(host)).toBe(STARTING_CHIPS - 75);
  await expect(host.page.getByTestId('turn-status')).toHaveText('Waiting for Pia and Quinn');
  await expect(pia.page.locator('[data-testid="seat"][data-name="Hana"]')).toHaveAttribute('data-bet', '75');

  // Quinn types more than she holds: the amount is clamped to her whole stack; half of it goes in.
  await quinn.page.getByTestId('bet-input').fill('9999');
  await quinn.page.getByTestId('bet-input').blur();
  await expect(quinn.page.getByTestId('bj-panel')).toHaveAttribute('data-amount', String(STARTING_CHIPS));
  await quinn.page.getByTestId('bet-half').click();
  await placeBetWith(quinn, () => quinn.page.getByTestId('place-bet').click(), QUINN_BET);
  expect(await chipsOf(quinn)).toBe(STARTING_CHIPS - QUINN_BET);

  // Pia: 1/2 walks down to a single chip and never under it, 2x doubles it; her bet deals the cards.
  for (const amount of [2, 1, 1]) {
    await pia.page.getByTestId('bet-half').click();
    await expect(pia.page.getByTestId('bj-panel')).toHaveAttribute('data-amount', String(amount));
  }
  await pia.page.getByTestId('bet-double').click();
  await expect(pia.page.getByTestId('bet-input')).toHaveValue(String(PIA_BET));
  await pia.page.getByTestId('place-bet').click();

  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', /^(acting|betting)$/);
    await expect(p.page.getByTestId('my-hand')).toHaveCount(1);
    await expect(p.page.getByTestId('seat')).toHaveCount(2);
  }
  expect(await chipsOf(host)).toBe(STARTING_CHIPS - 75);
  expect(await chipsOf(pia)).toBe(STARTING_CHIPS - PIA_BET);
  expect(await chipsOf(quinn)).toBe(STARTING_CHIPS - QUINN_BET);
});

test('round one: hands are played one at a time in seat order, then the dealer settles and the table stays up', async () => {
  const before = { Hana: STARTING_CHIPS - 75, Pia: STARTING_CHIPS - PIA_BET, Quinn: STARTING_CHIPS - QUINN_BET };
  const turns = await playOutRound(1, false, async () => {
    for (const p of phones()) await phoneLayoutHolds(p, PORTRAIT);
  });
  turnsInSeatOrder(turns);
  await checkSettlement(1, before, { Hana: 75, Pia: PIA_BET, Quinn: QUINN_BET });
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
  await expect(pia.page.getByTestId('bet-input')).toHaveValue(String(Math.min(PIA_BET, before.Pia)));

  for (const p of phones()) {
    const amount = Number(await p.page.getByTestId('bj-panel').getAttribute('data-amount'));
    await expect(p.page.getByTestId('place-bet')).toBeEnabled();
    await placeBetWith(p, () => p.page.getByTestId('place-bet').click(), amount);
    stakes[p.name] = amount;
  }
  // A mouse click on a quick step lets go of the focus: Space then bets rather than pressing the step again.
  const remembered = Number(await host.page.getByTestId('bj-panel').getAttribute('data-amount'));
  await host.page.getByTestId('bet-half').click();
  await expect(host.page.getByTestId('bet-half')).not.toBeFocused();
  const hanaAmount = Number(await host.page.getByTestId('bj-panel').getAttribute('data-amount'));
  expect(hanaAmount).toBeLessThanOrEqual(remembered);
  stakes.Hana = hanaAmount;
  await expect(host.page.getByTestId('place-bet')).toBeEnabled();
  await host.page.keyboard.press('Space');
  // The host bets last, so the cards come straight out: the stake shows on the host's hand.
  await expect(host.page.getByTestId('my-hand').first()).toHaveAttribute('data-bet', String(hanaAmount));
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

/** The document, the table and the players grid fit their boxes both ways: nothing scrolls. */
async function nothingScrolls(page: Page, label: string): Promise<void> {
  const read = () =>
    page.evaluate(() => {
      const over = (el: Element | null) => (el ? el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight : true);
      const doc = document.documentElement;
      // The round under the name is never cut short (a short landscape phone hides it altogether).
      const status = document.querySelector('[data-testid="round-indicator"]');
      return {
        document: over(doc),
        main: over(document.querySelector('[data-testid="blackjack-main"]')),
        table: over(document.querySelector('[data-testid="bj-table"]')),
        seats: document.querySelector('[data-testid="seats"]') ? over(document.querySelector('[data-testid="seats"]')) : false,
        status: status !== null && status.getClientRects().length > 0 && over(status),
      };
    });
  await expect.poll(read, { message: `${label}: nothing scrolls` }).toEqual({ document: false, main: false, table: false, seats: false, status: false });
}

/** At every phone size and both desktops: nothing scrolls. The page ends at its own size. */
async function fitsEverySize(page: Page, sizes: { width: number; height: number }[], label: string): Promise<void> {
  const own = page.viewportSize();
  for (const size of sizes) {
    await page.setViewportSize(size);
    await nothingScrolls(page, `${label} at ${size.width}x${size.height}`);
  }
  if (own) await page.setViewportSize(own);
}

const PHONES = [PORTRAIT, { width: 360, height: 740 }, SMALL];
const DESKTOPS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

/**
 * On every page the seat whose turn it is is lit, and only that one: its tile ringed with the
 * Playing tag on the others' pages, the spotlight on it everywhere (the acting page's own hand).
 */
async function turnMarked(pages: { page: Page; acting: boolean }[], turnId: string): Promise<void> {
  for (const { page, acting } of pages) {
    await expect(page.getByTestId('spotlight')).toHaveAttribute('data-player-id', turnId);
    await expect(page.getByTestId('spotlight')).toHaveAttribute('data-kind', acting ? 'mine' : 'turn');
    const lit = page.locator('[data-testid="seat"][data-turn="true"]');
    if (acting) {
      await expect(lit).toHaveCount(0);
      await expect(page.getByTestId('my-hands')).toHaveCount(1);
    } else {
      await expect(lit).toHaveCount(1);
      await expect(lit).toHaveAttribute('data-player-id', turnId);
      await expect(lit).toHaveAttribute('aria-current', 'true');
    }
  }
}

/**
 * A table of `size` players on a fresh party: a desktop host, a phone (Pia) and bots on their own
 * sockets that hold their turns. Nothing scrolls at any phone size while the bets go down, on the
 * host's turn, on Pia's own turn and on a bot's turn; the seat in play is marked on every page.
 */
async function bigTable(browser: Browser, base: string, size: number): Promise<void> {
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const phoneCtx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const desk = await hostCtx.newPage();
  const phone = await phoneCtx.newPage();
  const errors: string[] = [];
  for (const p of [desk, phone]) p.on('pageerror', (err) => errors.push(err.message));
  let bots: TableBot[] = [];
  try {
    const code = await createParty(desk, 'Hana', 'blackjack');
    await joinByCode(phone, 'Pia', code);
    // Slow clocks: the checks take their time, and nobody should sit a hand out over it.
    for (const id of ['betSeconds', 'actSeconds']) await desk.getByTestId(`settings-${id}`).fill('60');
    await expect(phone.getByTestId('settings-value-actSeconds')).toHaveText('60s');
    bots = await tableBots(size - 2, code, base, { game: 'blackjack', hold: true, thinkMs: 50 });
    await readyAll([phone]);
    await expectReadyCount(desk, size);
    await desk.getByTestId('start-game').click();
    const screenOf = (p: Page) => p.getByTestId('blackjack-screen');
    await expect(screenOf(phone)).toHaveAttribute('data-phase', 'betting');
    await expect(phone.getByTestId('seat')).toHaveCount(size - 1);
    await expect(phone.getByTestId('spotlight')).toHaveAttribute('data-kind', 'bets');
    await fitsEverySize(phone, PHONES, `${size} players, betting`);
    await desk.getByTestId('place-bet').click();
    await phone.getByTestId('place-bet').click();
    await expect(screenOf(phone)).toHaveAttribute('data-phase', 'acting', { timeout: 20_000 });
    await expect(screenOf(phone)).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });

    const botIds = new Set(bots.map((b) => b.id));
    // The humans stand when their turns come; each turn is marked everywhere and nothing scrolls.
    for (let step = 0; step < 4; step++) {
      const turn = (await screenOf(desk).getAttribute('data-turn-player')) ?? '';
      if (botIds.has(turn)) break;
      const acting = (await desk.getByTestId('action-stand').isEnabled()) ? desk : (await phone.getByTestId('action-stand').isEnabled()) ? phone : null;
      if (acting) {
        await turnMarked(
          [desk, phone].map((page) => ({ page, acting: page === acting })),
          turn,
        );
        await fitsEverySize(phone, PHONES, `${size} players, ${acting === phone ? "Pia's own" : "Hana's"} turn`);
        if (acting === desk) await fitsEverySize(desk, DESKTOPS, `${size} players, Hana's own turn`);
        await acting.getByTestId('action-stand').click();
      }
      await expect.poll(async () => (await screenOf(desk).getAttribute('data-turn-player')) !== turn, { timeout: 10_000 }).toBe(true);
    }
    if (bots.length > 0) {
      // A bot holds its turn: its tile is lit on both pages, the spotlight on it.
      const turn = (await screenOf(desk).getAttribute('data-turn-player')) ?? '';
      expect(botIds.has(turn), `${size} players: the turn reaches a bot`).toBe(true);
      for (const p of [desk, phone]) {
        const lit = p.locator('[data-testid="seat"][data-turn="true"]');
        await expect(lit).toHaveCount(1);
        await expect(lit).toHaveAttribute('data-player-id', turn);
        await expect(p.getByTestId('spotlight')).toHaveAttribute('data-player-id', turn);
      }
      await expect(phone.getByTestId('turn-status')).toHaveText(/'s turn$/);
      await fitsEverySize(phone, PHONES, `${size} players, a bot's turn`);
      await fitsEverySize(desk, DESKTOPS, `${size} players, a bot's turn`);
      for (const b of bots) b.setHold(false);
    }
    // The dealer plays in the spotlight, then the settled round stays up with my outcome in it.
    await expect(phone.getByTestId('spotlight')).toHaveAttribute('data-kind', /^(dealer|result)$/, { timeout: 30_000 });
    if ((await phone.getByTestId('spotlight').getAttribute('data-kind')) === 'dealer') await nothingScrolls(phone, `${size} players, the dealer's turn`);
    await expect(phone.getByTestId('spotlight')).toHaveAttribute('data-kind', 'result', { timeout: 30_000 });
    await expect(phone.getByTestId('turn-status')).toHaveAttribute('data-state', 'bet');
    await fitsEverySize(phone, PHONES, `${size} players, settled`);
    // The tiles step down with the table.
    const tier = size - 1 <= 4 ? 'full' : size - 1 <= 9 ? 'compact' : size - 1 <= 23 ? 'small' : 'dense';
    await expect(phone.getByTestId('seats')).toHaveAttribute('data-tier', tier);
    expect(errors).toEqual([]);
  } finally {
    for (const b of bots) b.close();
    await hostCtx.close();
    await phoneCtx.close();
  }
}

for (const size of [2, 6, 12, 24, 50]) {
  test(`${size} players: the table never scrolls on a phone or a desktop, and the seat in play is marked on every page`, async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    await bigTable(browser, baseURL ?? 'http://localhost:4173', size);
  });
}

test('no page errors, and no em dash on any page', async () => {
  for (const p of players) expect(await p.page.evaluate(() => document.body.innerText.includes('\u2014'))).toBe(false);
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
