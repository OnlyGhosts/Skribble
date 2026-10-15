import { expect, test, type Browser, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import { createParty, expectReadyCount } from './party';
import { tableBots, type TableBot } from './tableBots';

/**
 * Blackjack's fixed places. On a real table (a page and bots on their own sockets, at 390x844,
 * 320x568 and 1440x900, with 2 and 6 players) the dealer's hand and my hands never move or resize
 * through the betting, the deal, my turn, another player's turn, the dealer's play and the
 * settled table. Then a harness (e2e/harness: the real components and styles, served by Vite, fed
 * rigged snapshots) seats me with 2 to 16 split hands at every phone size and on a desktop:
 * nothing scrolls, every hand (full or folded into a chip) is wholly inside my row, and another
 * player's many hands fit the spotlight. The cards are really shuffled on the real table, so a
 * natural or the dealer's blackjack just means another round.
 */
test.describe.configure({ mode: 'serial' });

const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 1440, height: 900 },
];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} has no box`);
  return box;
}

/** The two fixed places, read once the layout has settled (two reads a frame apart agree). */
async function places(page: Page): Promise<{ dealer: Box; mine: Box }> {
  const read = async () => ({ dealer: await boxOf(page, 'dealer-area'), mine: await boxOf(page, 'my-area') });
  let last = await read();
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const next = await read();
    if (JSON.stringify(next) === JSON.stringify(last)) return next;
    last = next;
  }
  return last;
}

function expectSame(label: string, a: Box, b: Box): void {
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(a[k] - b[k]), `${label}: ${k} ${a[k]} -> ${b[k]}`).toBeLessThanOrEqual(1);
}

/** Nothing on the page scrolls: the document, the table, the players. */
async function nothingScrolls(page: Page, label: string): Promise<void> {
  const over = await page.evaluate(() => {
    const scrolls = (el: Element | null) => (el ? el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight : false);
    return {
      document: scrolls(document.documentElement),
      main: scrolls(document.querySelector('[data-testid="blackjack-main"]')),
      table: scrolls(document.querySelector('[data-testid="bj-table"]')),
      seats: scrolls(document.querySelector('[data-testid="seats"]')),
      mine: scrolls(document.querySelector('[data-testid="my-hands"]')),
    };
  });
  expect(over, `${label}: nothing scrolls`).toEqual({ document: false, main: false, table: false, seats: false, mine: false });
}

/**
 * One table of `players` at `size`: the places are read in every phase of a round and must never
 * move. Rounds go on until my turn and a bot's turn have both been seen (a natural skips a turn).
 */
async function fixedPlaces(browser: Browser, base: string, size: { width: number; height: number }, players: number): Promise<void> {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  let bots: TableBot[] = [];
  const label = `${players} players at ${size.width}x${size.height}`;
  try {
    const code = await createParty(page, 'Hana', 'blackjack');
    bots = await tableBots(players - 1, code, base, { game: 'blackjack', hold: true, thinkMs: 50 });
    await expectReadyCount(page, players);
    await page.getByTestId('start-game').click();
    const screen = page.getByTestId('blackjack-screen');
    await expect(screen).toHaveAttribute('data-phase', 'betting');
    await expect(page.getByTestId('seat')).toHaveCount(players - 1);
    const botIds = new Set(bots.map((b) => b.id));
    const ref = await places(page);
    const seen = new Set<string>();
    const check = async (phase: string) => {
      const now = await places(page);
      expectSame(`${label}, ${phase}: the dealer's hand`, ref.dealer, now.dealer);
      expectSame(`${label}, ${phase}: my hands`, ref.mine, now.mine);
      await nothingScrolls(page, `${label}, ${phase}`);
      seen.add(phase);
    };
    await check('betting');
    const roundOf = async () => Number(await page.getByTestId('round-indicator').getAttribute('data-round'));
    for (let round = 1; round <= 8 && !(seen.has('my turn') && seen.has("another player's turn")); round++) {
      await expect.poll(roundOf, { timeout: 20_000 }).toBe(round);
      for (const b of bots) b.setHold(true);
      await expect(page.getByTestId('place-bet')).toBeEnabled({ timeout: 20_000 });
      await page.getByTestId('place-bet').click();
      // The deal (or a dealer blackjack, settled at once): read while the cards are still sliding in.
      await expect.poll(async () => (await screen.getAttribute('data-phase')) !== 'betting' || (await roundOf()) > round, { timeout: 20_000 }).toBe(true);
      await check('the deal');
      for (let step = 0; step < 12; step++) {
        const state = async () => {
          if ((await roundOf()) > round) return 'settled';
          if (await page.getByTestId('action-stand').isEnabled()) return 'mine';
          const turn = (await screen.getAttribute('data-turn-player')) ?? '';
          return botIds.has(turn) ? 'bot' : null;
        };
        await expect.poll(state, { timeout: 20_000, message: `${label}: a turn or the settle` }).not.toBeNull();
        const now = await state();
        if (now === 'settled') break;
        if (now === 'mine') {
          await expect(page.getByTestId('spotlight')).toHaveAttribute('data-kind', 'mine');
          await check('my turn');
          const before = await screen.getAttribute('data-turn-hand');
          await page.getByTestId('action-stand').click();
          await expect.poll(async () => (await roundOf()) > round || !(await page.getByTestId('action-stand').isEnabled()) || (await screen.getAttribute('data-turn-hand')) !== before).toBe(true);
          continue;
        }
        await expect(page.getByTestId('spotlight')).toHaveAttribute('data-kind', 'turn');
        await check("another player's turn");
        for (const b of bots) b.setHold(false);
        break;
      }
      // The dealer plays where it always sits (caught when the reveal is still on), then the settled table.
      const kind = page.getByTestId('spotlight');
      await expect(kind).toHaveAttribute('data-kind', /^(dealer|result|bets)$/, { timeout: 30_000 });
      if ((await kind.getAttribute('data-kind')) === 'dealer') await check("the dealer's play");
      await expect(kind).toHaveAttribute('data-kind', /^(result|bets)$/, { timeout: 30_000 });
      await check('the results');
    }
    expect([...seen].sort(), label).toEqual(expect.arrayContaining(['another player\'s turn', 'betting', 'my turn', 'the deal', 'the results']));
    expect(errors).toEqual([]);
  } finally {
    for (const b of bots) b.close();
    await ctx.close();
  }
}

for (const players of [2, 6]) {
  for (const size of SIZES) {
    test(`${players} players at ${size.width}x${size.height}: the dealer's hand and mine never move or resize, whatever the phase`, async ({ browser, baseURL }) => {
      test.setTimeout(120_000);
      await fixedPlaces(browser, baseURL ?? 'http://localhost:4173', size, players);
    });
  }
}

// ---------------------------------------------------------------------------
// The harness: many split hands
// ---------------------------------------------------------------------------

const HARNESS_PORT = 5199;
let vite: ViteDevServer | null = null;

test.describe('many hands (the harness)', () => {
  test.beforeAll(async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    vite = await createServer({
      configFile: false,
      root: `${root}e2e/harness`,
      publicDir: `${root}client/public`,
      plugins: [react()],
      resolve: { alias: { '@shared': `${root}shared` } },
      server: { port: HARNESS_PORT, strictPort: true, fs: { allow: [root] } },
      logLevel: 'error',
    });
    await vite.listen();
  });

  test.afterAll(async () => {
    await vite?.close();
  });

  /** Every hand and chip (and each card of a full hand) lies wholly inside `container`. */
  async function allInside(page: Page, container: string, items: string): Promise<{ outside: number; count: number }> {
    return page.evaluate(
      ([c, q]) => {
        const box = document.querySelector(`[data-testid="${c}"]`)?.getBoundingClientRect();
        if (!box) return { outside: -1, count: 0 };
        const els = Array.from(document.querySelectorAll(`[data-testid="${c}"] :is(${q})`));
        const outside = els.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1;
        }).length;
        return { outside, count: els.length };
      },
      [container, items] as const,
    );
  }

  async function open(page: Page, query: string): Promise<void> {
    await page.goto(`http://localhost:${HARNESS_PORT}/?${query}`);
    await expect(page.getByTestId('blackjack-screen')).toBeVisible();
  }

  const MINE = '[data-testid="my-hand"], [data-testid="my-chip"], [data-testid="my-chip-more"], [data-testid="my-hand"] [data-testid="card"], [data-testid="hand-total"]';

  /**
   * Every chip in `container` (the "+N" too) keeps a readable width (34px mine, 28px the
   * spotlight's) and its whole total inside its pill, mine at the big totals' size (at least 1.4
   * times the old 0.68rem pill), and how many hands the chips stand for.
   */
  async function chipsRead(page: Page, container: string, chip: string): Promise<{ narrow: number; clipped: number; small: number; count: number; hands: number }> {
    return page.evaluate(
      ([c, id]) => {
        const chips = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${c}"] :is([data-testid="${id}"], [data-testid="${id}-more"])`));
        const min = id === 'my-chip' ? 34 : 28;
        const font = id === 'my-chip' ? 15.2 : 12;
        const totals = chips.map((el) => el.querySelector<HTMLElement>('.bj-chip__total')).filter((t): t is HTMLElement => t !== null);
        return {
          narrow: chips.filter((el) => el.getBoundingClientRect().width < min - 0.5).length,
          clipped: totals.filter((t) => t.scrollWidth > t.clientWidth + 0.5).length,
          small: totals.filter((t) => parseFloat(getComputedStyle(t).fontSize) < font).length,
          count: chips.length,
          // The hands the chips stand for: one each, and the "+N" for N.
          hands: chips.reduce((sum, el) => sum + Number(el.dataset.count ?? 1), 0),
        };
      },
      [container, chip] as const,
    );
  }

  for (const size of [{ width: 320, height: 568 }, { width: 360, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
    test(`${size.width}x${size.height}: any number of my hands fits my row, nothing scrolls, the hand in play full size`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: size });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      try {
        let ref: { dealer: Box; mine: Box } | null = null;
        for (const hands of [1, 2, 4, 6, 8, 12, 16]) {
          for (const phase of ['mine', 'results', 'other']) {
            const active = Math.floor(hands / 2);
            await open(page, `phase=${phase}&others=5&hands=${hands}&active=${active}&cards=3`);
            const label = `${hands} hands, ${phase}`;
            await expect.poll(async () => Number((await page.getByTestId('my-hands-row').getAttribute('data-full'))) + Number(await page.getByTestId('my-hands-row').getAttribute('data-chips')), { message: label }).toBe(hands);
            await nothingScrolls(page, label);
            await expect.poll(() => allInside(page, 'my-area', MINE), { message: `${label}: every hand inside my row` }).toMatchObject({ outside: 0 });
            // A folded hand reads: a readable chip, its whole total in the big totals' size; past what fits, a "+N".
            const folded = Number(await page.getByTestId('my-hands-row').getAttribute('data-chips'));
            await expect.poll(() => chipsRead(page, 'my-area', 'my-chip'), { message: `${label}: my chips read` }).toMatchObject({ narrow: 0, clipped: 0, small: 0, hands: folded });
            // My row and the dealer's never move, however many hands.
            const now = await places(page);
            if (ref === null) ref = now;
            expectSame(`${label}: the dealer's hand`, ref.dealer, now.dealer);
            expectSame(`${label}: my row`, ref.mine, now.mine);
            if (phase === 'mine') {
              // The hand in play is always full size and lit.
              const lit = page.locator('[data-testid="my-hand"][data-active="true"]');
              await expect(lit, label).toHaveCount(1);
              await expect(lit, label).toHaveAttribute('data-index', String(active));
              await expect(lit.getByTestId('card'), label).toHaveCount(3);
            }
          }
        }
        // Another player's many hands fit the spotlight: the hand in play full size, a marker, the rest as chips.
        for (const [others, otherHands] of [[5, 2], [5, 7], [5, 16], [23, 9], [49, 16]]) {
          await open(page, `phase=other&others=${others}&otherHands=${otherHands}&active=0`);
          const label = `another player's ${otherHands} hands at a table of ${others + 1}`;
          await nothingScrolls(page, label);
          await expect(page.getByTestId('spot-marker')).toHaveAttribute('aria-label', `Hand 1 of ${otherHands}`);
          await expect.poll(() => allInside(page, 'spotlight', '[data-testid="spot-hand"], [data-testid="spot-chip"], [data-testid="spot-chip-more"]'), { message: label }).toMatchObject({ outside: 0 });
          // Every hand is there: the one in play, a chip each, or in the "+N".
          const full = await page.getByTestId('spot-hand').count();
          await expect.poll(() => chipsRead(page, 'spotlight', 'spot-chip'), { message: `${label}: the chips read` }).toMatchObject({ narrow: 0, clipped: 0, small: 0, hands: otherHands - full });
          // Who is next always shows in full.
          const next = await page.getByTestId('spot-next').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
          expect(next.cw, `${label}: who is next`).toBeGreaterThanOrEqual(next.sw);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  for (const size of [{ width: 320, height: 568 }, { width: 360, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    test(`${size.width}x${size.height}: my next stake, a soft total and a long wait all read in full`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: size });
      const page = await ctx.newPage();
      try {
        // My bet goes down while the last round's hands are still on the table: it never covers a card or a chip.
        for (const hands of [1, 2, 3, 9]) {
          await open(page, `phase=results&others=5&hands=${hands}&myBet=10`);
          await expect(page.getByTestId('my-bet')).toHaveAttribute('data-bet', '10');
          const overlaps = await page.evaluate(() => {
            const bet = document.querySelector('[data-testid="my-bet"]')?.getBoundingClientRect();
            if (!bet) return -1;
            return Array.from(document.querySelectorAll('[data-testid="my-area"] :is([data-testid="card"], [data-testid="my-chip"], [data-testid="my-chip-more"], [data-testid="my-slot"], [data-testid="hand-total"])')).filter((el) => {
              const r = el.getBoundingClientRect();
              return r.left < bet.right && r.right > bet.left && r.top < bet.bottom && r.bottom > bet.top;
            }).length;
          });
          expect(overlaps, `${hands} hands: my bet over the table`).toBe(0);
          await expect.poll(() => allInside(page, 'my-area', '[data-testid="my-bet"]'), { message: `${hands} hands: my bet inside my row` }).toEqual({ outside: 0, count: 1 });
        }
        // A long line under a total (a big payout, a doubled stake) keeps to the room my row leaves: nothing scrolls, no hand outgrows the row.
        for (const query of ['phase=results&hands=1&stake=1000', 'phase=results&hands=2&stake=1000&doubled=1', 'phase=mine&hands=1&stake=1000&doubled=1&cards=3', 'phase=mine&hands=3&active=1&stake=1000&doubled=1']) {
          await open(page, `others=5&${query}`);
          if (query.startsWith('phase=results')) await expect(page.getByTestId('my-area').getByTestId('hand-outcome').first()).toHaveText('Win');
          await nothingScrolls(page, query);
          await expect.poll(() => allInside(page, 'my-area', '[data-testid="my-hand"], [data-testid="hand-total"]'), { message: `${query}: every hand inside my row` }).toMatchObject({ outside: 0 });
          const spill = await page.evaluate(() =>
            Array.from(document.querySelectorAll('[data-testid="my-area"] [data-testid="my-hand"]')).filter((hand) => {
              const foot = hand.querySelector('.bj-hand__foot');
              return foot !== null && foot.getBoundingClientRect().bottom > hand.getBoundingClientRect().bottom + 0.5;
            }).length,
          );
          expect(spill, `${query}: the line under each total stays in its hand`).toBe(0);
        }
        // The "+N" past what my row holds opens every one of my hands.
        await open(page, 'phase=mine&others=5&hands=16&active=8&cards=3');
        const more = page.getByTestId('my-chip-more');
        if (size.width < 760) {
          await more.click();
          await expect(page.getByTestId('seat-detail').getByTestId('detail-hand')).toHaveCount(16);
        } else {
          await expect(more).toHaveCount(0);
        }
        // A soft total ("10/20") stays inside its pill.
        await open(page, 'phase=mine&others=5&hands=1&active=0&soft=1');
        const soft = page.getByTestId('my-area').getByTestId('hand-total');
        await expect(soft).toHaveText('10/20');
        const pill = await soft.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
        expect(pill.sw, 'the soft total fits its pill').toBeLessThanOrEqual(pill.cw);
        // Long names: the count of bets in always shows, and the wait reads in full.
        await open(page, 'phase=betting&others=3&myBet=10&names=Pia,Bartholomew,Christabel');
        const count = page.getByTestId('spot-bets-count');
        await expect(count).toHaveText('2 of 4 bets in');
        const shown = await count.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const parent = el.parentElement?.getBoundingClientRect();
          return { width: r.width, parent: parent?.width ?? 0, sw: el.scrollWidth };
        });
        expect(shown.parent, 'the count has its room').toBeGreaterThanOrEqual(shown.sw);
        await expect(page.getByTestId('turn-status')).toHaveText('Waiting for 2 players');
        const status = await page.getByTestId('turn-status').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
        expect(status.sw, 'the panel line in full').toBeLessThanOrEqual(status.cw);
      } finally {
        await ctx.close();
      }
    });
  }
});
