import { expect, test, type Browser, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';
import WebSocket from 'ws';
import { createParty, expectReadyCount, joinByCode, readyAll } from './party';

/**
 * Play that stays smooth on a real phone link: a second tap never plays a second move or shows a
 * red box, a blink in the connection costs nothing, a phone that went quiet shows as away and
 * anyone may skip it, a tap made on a dead link still arrives after the reconnect, typing the code
 * of a room again goes back into the same seat, and a server restart says so plainly.
 */

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  errors: string[];
}

async function newPlayer(browser: Browser, name: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<Player> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`${name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${name}: ${msg.text()}`);
  });
  return { name, context, page, errors };
}

async function roundOn(page: Page): Promise<number> {
  return Number(await page.getByTestId('round-indicator').getAttribute('data-round'));
}

/** Cards across my hands on the table. */
async function myCards(page: Page): Promise<number> {
  const counts = await page.getByTestId('my-hand').evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.cards ?? 0)));
  return counts.reduce((a, b) => a + b, 0);
}

/** Error toasts (the red box) on screen right now. */
const redBoxes = (page: Page) => page.locator('[data-testid="toast"].toast--error');

/** A Blackjack table between a desktop host and a phone, both in the first round's betting. */
async function blackjackTable(browser: Browser): Promise<{ host: Player; phone: Player; code: string }> {
  const host = await newPlayer(browser, 'Hana', { viewport: { width: 1280, height: 800 } });
  const phone = await newPlayer(browser, 'Pia', PHONE);
  const code = await createParty(host.page, host.name, 'blackjack');
  await joinByCode(phone.page, phone.name, code);
  await readyAll([phone.page]);
  await expectReadyCount(host.page, 2);
  await host.page.getByTestId('start-game').click();
  for (const p of [host, phone]) await expect(p.page.getByTestId('blackjack-screen')).toHaveAttribute('data-phase', 'betting');
  return { host, phone, code };
}

/** A player on a bare socket: it joins, readies, bets a chip, and otherwise does only what the test says. */
interface RawPlayer {
  id: string;
  token: string;
  code: string;
  socket: WebSocket;
  latest: { phase: string; game: { phase: string; round: number; turn: { playerId: string; handIndex: number } | null; players: Record<string, { bet: number; hands: { cards: unknown[] }[] }> } | null } | null;
  send(msg: object): void;
}

function rawPlayer(base: string, code: string, name: string): Promise<RawPlayer> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`);
    const player: RawPlayer = { id: '', token: '', code, socket, latest: null, send: (msg) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(msg)) };
    let betRound = 0;
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { t: string; playerId?: string; token?: string; room?: RawPlayer['latest'] };
      if (msg.t === 'welcome' && msg.playerId && msg.token) {
        player.id = msg.playerId;
        player.token = msg.token;
        player.send({ t: 'ready', ready: true });
        resolve(player);
      }
      if (msg.room) player.latest = msg.room;
      const g = player.latest?.game;
      if (g && g.phase === 'betting' && g.round !== betRound && g.players[player.id]?.bet === 0) {
        betRound = g.round;
        player.send({ t: 'bet', amount: 1, round: g.round });
      }
    });
    socket.on('open', () => socket.send(JSON.stringify({ t: 'join', code, name, avatar: { color: 3, emoji: 3 } })));
    socket.on('error', reject);
  });
}

/** A fresh socket back into the raw player's seat. */
function rejoin(base: string, player: RawPlayer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`);
    socket.on('open', () => socket.send(JSON.stringify({ t: 'rejoin', code: player.code, token: player.token })));
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { t: string; room?: RawPlayer['latest'] };
      if (msg.room) player.latest = msg.room;
      if (msg.t === 'welcome') {
        player.socket = socket;
        player.send = (out) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(out));
        resolve();
      }
    });
    socket.on('error', reject);
  });
}

test.describe('a second tap', () => {
  test('never deals twice, draws a second card or shows a red box', async ({ browser }) => {
    test.setTimeout(120_000);
    const { host, phone } = await blackjackTable(browser);
    try {
      await phone.page.getByTestId('place-bet').click();
      // The last bet deals the cards: a double tap on it is one bet, and nothing turns red.
      await host.page.getByTestId('place-bet').dblclick();
      for (const p of [host, phone]) await expect(p.page.getByTestId('blackjack-screen')).not.toHaveAttribute('data-phase', 'betting');
      for (const p of [host, phone]) await expect(p.page.getByTestId('my-hand')).toHaveCount(1);
      await expect(redBoxes(host.page)).toHaveCount(0);

      // A double tap of Hit draws one card, whenever a hand to hit comes up in the next rounds.
      let tapped = false;
      for (let tries = 0; tries < 40 && !tapped; tries++) {
        const actor = (await host.page.getByTestId('action-hit').isEnabled()) ? host : (await phone.page.getByTestId('action-hit').isEnabled()) ? phone : null;
        if (actor) {
          const before = await myCards(actor.page);
          await actor.page.getByTestId('action-hit').dblclick();
          await expect.poll(() => myCards(actor.page)).toBe(before + 1);
          // Long enough for a second card to have come, had the second tap gone out.
          await actor.page.waitForTimeout(1500);
          expect(await myCards(actor.page)).toBe(before + 1);
          tapped = true;
          break;
        }
        // Nobody can hit right now: stand whoever acts, or bet into the next round.
        for (const p of [host, phone]) {
          if (await p.page.getByTestId('action-stand').isEnabled()) await p.page.getByTestId('action-stand').click();
          if (await p.page.getByTestId('place-bet').isEnabled()) await p.page.getByTestId('place-bet').click();
        }
        await host.page.waitForTimeout(500);
      }
      expect(tapped, 'a hand to hit came up').toBe(true);
      for (const p of [host, phone]) await expect(redBoxes(p.page)).toHaveCount(0);
      expect([...host.errors, ...phone.errors]).toEqual([]);
    } finally {
      await host.context.close();
      await phone.context.close();
    }
  });
});

test.describe('a weak connection', () => {
  test('a blink on my turn neither stands my hand nor moves the play on', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const base = baseURL ?? 'http://localhost:4173';
    const host = await newPlayer(browser, 'Hana');
    try {
      const code = await createParty(host.page, host.name, 'blackjack');
      const bot = await rawPlayer(base, code, 'Bo');
      await expectReadyCount(host.page, 2);
      await host.page.getByTestId('start-game').click();
      await expect(host.page.getByTestId('place-bet')).toBeEnabled();
      await host.page.getByTestId('place-bet').click();
      // The host plays first; once the bot's turn comes, its phone blinks: the socket drops and comes straight back.
      for (let i = 0; i < 20; i++) {
        if (bot.latest?.game?.turn?.playerId === bot.id) break;
        if (await host.page.getByTestId('action-stand').isEnabled()) await host.page.getByTestId('action-stand').click();
        await host.page.waitForTimeout(300);
        if ((await roundOn(host.page)) > 1) {
          // The round ended without the bot acting (a natural, the dealer's blackjack): bet again.
          if (await host.page.getByTestId('place-bet').isEnabled()) await host.page.getByTestId('place-bet').click();
        }
      }
      expect(bot.latest?.game?.turn?.playerId).toBe(bot.id);
      const screen = host.page.getByTestId('blackjack-screen');
      await expect(screen).toHaveAttribute('data-turn-player', bot.id);
      bot.socket.terminate();
      await rejoin(base, bot);
      // Well past the moment the game would have heard of the drop: still the bot's turn, its hand unplayed.
      await host.page.waitForTimeout(6000);
      await expect(screen).toHaveAttribute('data-turn-player', bot.id);
      await expect(host.page.getByTestId('toast').filter({ hasText: 'is away and stands' })).toHaveCount(0);
      bot.send({ t: 'stand' });
      await expect(screen).not.toHaveAttribute('data-turn-player', bot.id);
      bot.socket.close();
      expect(host.errors).toEqual([]);
    } finally {
      await host.context.close();
    }
  });

  test('a tap made on a dead link still arrives after the reconnect, once', async ({ browser }) => {
    test.setTimeout(120_000);
    const { host, phone } = await blackjackTable(browser);
    try {
      // The phone's link goes dead without closing: nothing gets through either way.
      let dead = false;
      let upstream: WebSocketRoute | null = null;
      await phone.page.routeWebSocket(/\/ws$/, (route) => {
        const server = route.connectToServer();
        upstream = server;
        route.onMessage((m) => {
          if (!dead) server.send(m);
        });
        server.onMessage((m) => {
          if (!dead) route.send(m);
        });
        route.onClose(() => server.close());
        server.onClose((code, reason) => route.close({ code, reason }));
      });
      // The route applies to sockets opened from now on: a reload puts the phone's socket through it.
      await phone.page.reload();
      await expect(phone.page.getByTestId('blackjack-screen')).toHaveAttribute('data-phase', 'betting');
      await expect.poll(() => upstream !== null).toBe(true);
      dead = true;
      await phone.page.getByTestId('place-bet').click();
      await expect(phone.page.getByTestId('place-bet')).toHaveText('Bet placed');
      // The server never got it: the host still waits for the bet.
      await expect(host.page.getByTestId('turn-status')).toHaveText(/Waiting for Pia|Place your bet/);
      // The phone notices the silence, says so, and reconnects once the link carries again.
      await expect(phone.page.getByTestId('reconnecting-banner')).toBeVisible({ timeout: 8000 });
      dead = false;
      await expect(phone.page.getByTestId('reconnecting-banner')).toHaveCount(0, { timeout: 20_000 });
      await host.page.getByTestId('place-bet').click();
      // The bet that went out on the dead link was sent again: the cards are dealt to both.
      for (const p of [host, phone]) await expect(p.page.getByTestId('my-hand')).toHaveCount(1, { timeout: 15_000 });
      for (const p of [host, phone]) await expect(redBoxes(p.page)).toHaveCount(0);
    } finally {
      await host.context.close();
      await phone.context.close();
    }
  });
});

test.describe('a phone that went quiet', () => {
  test('shows as away on its turn, and anyone may skip it; nothing is played for it', async ({ browser, baseURL }) => {
    // The room marks a connection idle after 90 s of silence (checked every 10 s).
    test.setTimeout(240_000);
    const base = baseURL ?? 'http://localhost:4173';
    const host = await newPlayer(browser, 'Hana', { viewport: { width: 1280, height: 800 } });
    const phone = await newPlayer(browser, 'Pia', PHONE);
    try {
      const code = await createParty(host.page, host.name, 'blackjack');
      // Second in the seat order: it bets, then never sends anything again (its socket still answers
      // the server's pings, like a frozen or backgrounded tab).
      const quiet = await rawPlayer(base, code, 'Bo');
      await joinByCode(phone.page, phone.name, code);
      await readyAll([phone.page]);
      await expectReadyCount(host.page, 3);
      await host.page.getByTestId('start-game').click();
      for (let round = 1; round < 6; round++) {
        for (const p of [host, phone]) {
          await expect(p.page.getByTestId('place-bet')).toBeEnabled({ timeout: 20_000 });
          await p.page.getByTestId('place-bet').click();
        }
        // Stand whatever comes up on the two pages until it is the quiet seat's turn (a natural or the
        // dealer's blackjack can skip it: then the next round).
        const state = async () => {
          if (quiet.latest?.game?.turn?.playerId === quiet.id) return 'quiet';
          if ((await roundOn(host.page)) > round) return 'settled';
          for (const p of [host, phone]) if (await p.page.getByTestId('action-stand').isEnabled()) return p.name;
          return null;
        };
        for (let moves = 0; moves < 6; moves++) {
          await expect.poll(state, { timeout: 20_000 }).not.toBeNull();
          const now = await state();
          if (now === 'quiet' || now === 'settled') break;
          const actor = now === host.name ? host : phone;
          await actor.page.getByTestId('action-stand').click();
          await expect(actor.page.getByTestId('action-stand')).toBeDisabled();
        }
        if (quiet.latest?.game?.turn?.playerId === quiet.id) break;
      }
      expect(quiet.latest?.game?.turn?.playerId).toBe(quiet.id);
      const seat = phone.page.locator(`[data-testid="seat"][data-player-id="${quiet.id}"]`);
      // Before the silence is long: an ordinary turn, and only the host may skip it.
      await expect(phone.page.getByTestId('skip-turn')).toHaveCount(0);
      // Then the seat shows as away, and the other player (not the host) may skip it.
      await expect(phone.page.getByTestId('turn-status')).toHaveText('Bo is away', { timeout: 130_000 });
      await expect(seat).toHaveAttribute('data-state', 'away');
      await expect(seat.getByTestId('seat-line')).toHaveText('Away');
      await expect(seat.getByTestId('seat-playing')).toHaveText('Away');
      // Nothing was played for it in all that time.
      await expect(host.page.getByTestId('blackjack-screen')).toHaveAttribute('data-turn-player', quiet.id);
      await phone.page.getByTestId('skip-turn').click();
      await expect(host.page.getByTestId('blackjack-screen')).not.toHaveAttribute('data-turn-player', quiet.id);
      for (const p of [host, phone]) await expect(p.page.getByTestId('toast').filter({ hasText: "Pia stood Bo's hand." })).toBeVisible();
      quiet.socket.close();
      expect([...host.errors, ...phone.errors]).toEqual([]);
    } finally {
      await host.context.close();
      await phone.context.close();
    }
  });
});

test.describe('coming back to a room', () => {
  test('typing the code of a room this phone holds a seat in goes back into that seat', async ({ browser }) => {
    const host = await newPlayer(browser, 'Hana');
    const guest = await newPlayer(browser, 'Pia', PHONE);
    try {
      const code = await createParty(host.page, host.name);
      await joinByCode(guest.page, guest.name, code);
      await readyAll([guest.page]);
      await expect(host.page.getByTestId('player-item')).toHaveCount(2);
      // The tab is closed; the same phone opens the site again and types the code.
      await guest.page.close();
      await expect(host.page.locator('[data-testid="player-item"][data-name="Pia"]')).toHaveClass(/player--offline/);
      const page = await guest.context.newPage();
      await page.goto('/');
      await page.getByTestId('code-input-0').pressSequentially(code, { delay: 20 });
      await page.getByTestId('home-join').click();
      await expect(page.getByTestId('room-code')).toHaveText(code);
      // Back in the same seat: still two players, Pia connected and still ready.
      await expect(host.page.getByTestId('player-item')).toHaveCount(2);
      await expect(host.page.locator('[data-testid="player-item"][data-name="Pia"]')).not.toHaveClass(/player--offline/);
      await expect(page.getByTestId('ready-toggle')).toHaveAttribute('aria-pressed', 'true');
      expect(host.errors).toEqual([]);
    } finally {
      await host.context.close();
      await guest.context.close();
    }
  });

  test('a server restart says the game ended, not that the room does not exist', async ({ browser }) => {
    const host = await newPlayer(browser, 'Hana');
    const guest = await newPlayer(browser, 'Pia', PHONE);
    try {
      let restarted = false;
      let upstream: WebSocketRoute | null = null;
      let pageSide: WebSocketRoute | null = null;
      await guest.page.routeWebSocket(/\/ws$/, (route) => {
        if (restarted) {
          // The restarted server knows no rooms: every rejoin is refused.
          route.onMessage((m) => {
            const msg = JSON.parse(String(m)) as { t: string; code?: string };
            if (msg.t === 'rejoin') route.send(JSON.stringify({ t: 'error', code: 'REJOIN_FAILED', message: `No room with code ${msg.code ?? ''} exists.` }));
            if (msg.t === 'ping') route.send(JSON.stringify({ t: 'pong', serverTime: Date.now() }));
          });
          return;
        }
        const server = route.connectToServer();
        upstream = server;
        pageSide = route;
        route.onMessage((m) => server.send(m));
        server.onMessage((m) => route.send(m));
        route.onClose(() => server.close());
        server.onClose((code, reason) => route.close({ code, reason }));
      });
      const code = await createParty(host.page, host.name);
      await joinByCode(guest.page, guest.name, code);
      await expect.poll(() => upstream !== null).toBe(true);
      // The server goes down for a deploy (1001 going away) and comes back empty.
      restarted = true;
      await pageSide?.close({ code: 1001, reason: 'restart' });
      await upstream?.close();
      await expect(guest.page.getByTestId('toast').filter({ hasText: 'The server restarted, so that game ended.' })).toBeVisible({ timeout: 20_000 });
      await expect(guest.page.getByTestId('toast').filter({ hasText: 'No room' })).toHaveCount(0);
      await expect(guest.page.getByTestId('home-create')).toBeVisible();
    } finally {
      await host.context.close();
      await guest.context.close();
    }
  });
});
