import { expect, test, type Browser, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';

/**
 * Phones that go dark must not end the game. Part one (Skribble, two players): a guesser's link
 * drops for a while; the game holds at the next turn boundary instead of falling back to the
 * lobby, the other player sees the waiting overlay, and the comeback restores the seat, name and
 * score. Then the same player's tab is discarded and reopened: localStorage brings the seat back
 * without the join form. Part two (Spy Game, three players): a phone drops right before the round
 * boundary; the host removes it from the waiting overlay and the game, now below its minimum,
 * returns to the lobby with a message. The wake lock is checked through a stubbed API.
 *
 * Going offline: Chromium's offline emulation does not close the server side of an open
 * WebSocket, so the server would only notice through its heartbeat. Each guest's socket is routed
 * through a link the test can cut, which also drops the server side (what a hosting cut does), and
 * the context goes offline at the same time so reconnects fail until the link is back.
 */
test.describe.configure({ mode: 'serial' });

const PORTRAIT = { width: 390, height: 844 };

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Uncaught exceptions and console errors, checked at the end. */
  errors: string[];
}

/** A severable WebSocket link: while down, new sockets are refused and the current one is closed. */
interface Link {
  down: boolean;
  upstream: WebSocketRoute | null;
}

const WAKE_LOCK_STUB = `
  (() => {
    const requests = [];
    window.__wakeLockRequests = requests;
    const sentinel = () => {
      const s = { released: false, type: 'screen', release: async () => { s.released = true; }, addEventListener() {}, removeEventListener() {} };
      return s;
    };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (type) => { requests.push(type); return sentinel(); } } });
  })();
`;

async function newPlayer(browser: Browser, name: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<Player> {
  const context = await browser.newContext(options);
  await context.addInitScript(WAKE_LOCK_STUB);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`${name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${name}: ${msg.text()}`);
  });
  return { name, context, page, errors };
}

/** Routes the page's sockets through a link the test can cut. Page-scoped, so it follows reloads too. */
async function routeLink(page: Page): Promise<Link> {
  const link: Link = { down: false, upstream: null };
  await page.routeWebSocket(/\/ws$/, (route) => {
    if (link.down) {
      route.close({ code: 1001, reason: 'link down' });
      return;
    }
    const server = route.connectToServer();
    link.upstream = server;
    route.onMessage((m) => server.send(m));
    server.onMessage((m) => route.send(m));
    route.onClose(() => server.close());
    server.onClose((code, reason) => route.close({ code, reason }));
  });
  return link;
}

async function goOffline(p: Player, link: Link): Promise<void> {
  link.down = true;
  await p.context.setOffline(true);
  await link.upstream?.close();
}

async function goOnline(p: Player, link: Link): Promise<void> {
  link.down = false;
  await p.context.setOffline(false);
}

async function wakeLockRequests(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __wakeLockRequests?: string[] }).__wakeLockRequests?.length ?? 0);
}

async function readCode(page: Page): Promise<string> {
  const code = ((await page.getByTestId('room-code').textContent()) ?? '').replace(/\s+/g, '');
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  return code;
}

async function joinByCode(p: Player, slug: string, code: string): Promise<void> {
  await p.page.goto(`/${slug}`);
  await p.page.getByTestId('home-name').fill(p.name);
  await p.page.getByTestId('code-input-0').pressSequentially(code, { delay: 20 });
  await p.page.getByTestId('home-join').click();
  await expect(p.page.getByTestId('room-code')).toHaveText(code);
}

async function scoreOf(page: Page, name: string): Promise<number> {
  const raw = await page.locator(`[data-testid="player-item"][data-name="${name}"]`).getAttribute('data-score');
  return Number(raw ?? 'NaN');
}

async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('chat-input');
  await input.fill(text);
  await input.press('Enter');
}

// ---------------------------------------------------------------------------
// Part one: Skribble, a dropped link and a discarded tab
// ---------------------------------------------------------------------------

test.describe('Skribble keeps going through a dropped link and a discarded tab', () => {
  let host: Player;
  let guest: Player;
  const links = new Map<Player, Link>();
  let code = '';
  /** The player who loses the link: the guesser of turn two, who scored as turn one's drawer. */
  let offline: Player;
  let other: Player;
  let scoreBefore = 0;

  test.beforeAll(async ({ browser }) => {
    host = await newPlayer(browser, 'Dana');
    guest = await newPlayer(browser, 'Eli');
    // Either player may draw first, so both links are severable; a host going dark hands the role to the other.
    links.set(host, await routeLink(host.page));
    links.set(guest, await routeLink(guest.page));
  });

  test.afterAll(async () => {
    await host.context.close();
    await guest.context.close();
  });

  test('two players join; the screen wake lock is requested once in a room', async () => {
    await host.page.goto('/skribble');
    expect(await wakeLockRequests(host.page)).toBe(0);
    await host.page.getByTestId('home-name').fill(host.name);
    await host.page.getByTestId('home-create').click();
    code = await readCode(host.page);
    await expect.poll(() => wakeLockRequests(host.page)).toBeGreaterThan(0);

    await joinByCode(guest, 'skribble', code);
    await expect.poll(() => wakeLockRequests(guest.page)).toBeGreaterThan(0);
    await expect(host.page.getByTestId('player-item')).toHaveCount(2);

    await host.page.getByTestId('settings-drawTime').fill('20');
    await expect(guest.page.getByTestId('settings-value-drawTime')).toHaveText('20s');
    await host.page.getByTestId('start-game').click();
  });

  test('turn one is played out so both players hold a score', async () => {
    const players = [host, guest];
    await expect.poll(async () => (await host.page.getByTestId('word-choice').first().isVisible()) || (await guest.page.getByTestId('word-choice').first().isVisible())).toBe(true);
    const drawer = (await host.page.getByTestId('word-choice').first().isVisible()) ? host : guest;
    const guesser = drawer === host ? guest : host;
    await drawer.page.getByTestId('word-choice').first().click();
    const word = ((await drawer.page.getByTestId('word-plain').locator('.word__text').textContent()) ?? '').trim();
    expect(word.length).toBeGreaterThan(0);
    await expect(guesser.page.getByTestId('word-mask')).toBeVisible();
    await sendChat(guesser.page, word);
    await expect(drawer.page.getByTestId('overlay-turn-end')).toBeVisible();
    for (const p of players) await expect.poll(() => scoreOf(p.page, drawer.name)).toBeGreaterThan(0);
    // Turn two: the other player draws, turn one's drawer guesses and is the one who goes dark.
    offline = drawer;
    other = guesser;
  });

  test('the guesser drops: the game holds at the turn boundary (no lobby), then resumes with the seat and score intact', async () => {
    test.setTimeout(120_000);
    await expect(other.page.getByTestId('word-choice').first()).toBeVisible({ timeout: 20_000 });
    await other.page.getByTestId('word-choice').first().click();
    await expect(offline.page.getByTestId('word-mask')).toBeVisible();
    scoreBefore = await scoreOf(host.page, offline.name);
    expect(scoreBefore).toBeGreaterThan(0);

    const wentOffline = Date.now();
    await goOffline(offline, links.get(offline) as Link);
    await expect(other.page.locator(`[data-testid="player-item"][data-name="${offline.name}"]`)).toHaveClass(/player--offline/);
    await expect(offline.page.getByTestId('connection-status')).toHaveAttribute('data-status', 'reconnecting');
    // The game screen itself says so, persistently (the toast comes later and goes again).
    await expect(offline.page.getByTestId('reconnecting-banner')).toBeVisible();
    await expect(offline.page.getByTestId('reconnecting-banner')).toHaveAttribute('data-status', 'reconnecting');
    await expect(other.page.getByTestId('reconnecting-banner')).toHaveCount(0);

    // The game holds at the next boundary rather than returning to the lobby.
    await expect(other.page.getByTestId('overlay-waiting')).toBeVisible({ timeout: 60_000 });
    await expect(other.page.getByTestId('overlay-waiting')).toContainText(`Waiting for ${offline.name} to reconnect`);
    await expect(other.page.getByTestId('overlay-waiting')).toContainText('1 of 2 players connected');
    // Whoever is connected hosts for now (the role moves to the stand-in while the host is away).
    await expect(other.page.getByTestId('waiting-remove')).toHaveCount(1);
    await expect(other.page.getByTestId('waiting-remove-hint')).toBeVisible();
    await expect(other.page.getByTestId('room-code')).toHaveCount(0);
    await expect(other.page.getByTestId('start-game')).toHaveCount(0);
    await expect(other.page.getByTestId('timer').first()).toHaveAttribute('data-paused', 'players');
    await expect(other.page.getByTestId('chat-log')).toContainText(`Waiting for ${offline.name} to reconnect`);

    // At least twenty seconds in the dark before coming back.
    const remaining = 20_000 - (Date.now() - wentOffline);
    if (remaining > 0) await other.page.waitForTimeout(remaining);
    await goOnline(offline, links.get(offline) as Link);

    await expect(offline.page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });
    await expect(offline.page.getByTestId('reconnecting-banner')).toHaveCount(0);
    await expect(other.page.getByTestId('overlay-waiting')).toHaveCount(0, { timeout: 15_000 });
    // The player who came back never saw a nameless "waiting for players" of their own.
    await expect(offline.page.getByTestId('overlay-waiting')).toHaveCount(0);
    await expect(other.page.getByTestId('chat-log')).toContainText(`${offline.name} reconnected`);
    for (const p of [host, guest]) {
      await expect(p.page.getByTestId('player-item')).toHaveCount(2);
      await expect(p.page.locator(`[data-testid="player-item"][data-name="${offline.name}"]`)).not.toHaveClass(/player--offline/);
      expect(await scoreOf(p.page, offline.name)).toBe(scoreBefore);
      await expect(p.page.getByTestId('room-code')).toHaveCount(0);
      await expect(p.page.getByTestId('game-header')).toBeVisible();
    }
    // The game went on: a new turn is being chosen or drawn.
    await expect(offline.page.getByTestId('timer').first()).not.toHaveAttribute('data-paused', /.+/, { timeout: 15_000 });
  });

  test('the tab is discarded: a fresh page at the room link is back in the same seat without the join form', async () => {
    const nameBefore = guest.name;
    const score = await scoreOf(host.page, nameBefore);
    await guest.page.close();
    await expect(host.page.locator(`[data-testid="player-item"][data-name="${nameBefore}"]`)).toHaveClass(/player--offline/);

    const page = await guest.context.newPage();
    page.on('pageerror', (err) => guest.errors.push(`${guest.name}: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') guest.errors.push(`${guest.name}: ${msg.text()}`);
    });
    guest.page = page;
    await page.goto(`/skribble/${code}`);
    await expect(page.getByTestId('game-header')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('home-join')).toHaveCount(0);
    await expect(page.getByTestId('invite-banner')).toHaveCount(0);
    await expect(page.locator(`[data-testid="player-item"][data-name="${nameBefore}"]`)).toHaveClass(/player--me/);
    await expect(host.page.getByTestId('player-item')).toHaveCount(2);
    await expect(host.page.locator(`[data-testid="player-item"][data-name="${nameBefore}"]`)).not.toHaveClass(/player--offline/);
    expect(await scoreOf(host.page, nameBefore)).toBe(score);
    await expect.poll(() => wakeLockRequests(page)).toBeGreaterThan(0);
  });

  test('no page errors were raised in any browser', async () => {
    expect([...host.errors, ...guest.errors]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Part two: Spy Game, a phone drops before the round boundary and the host removes it
// ---------------------------------------------------------------------------

test.describe('Spy Game holds for a dropped phone and the host may remove it', () => {
  let host: Player;
  let pia: Player;
  let quinn: Player;
  const links = new Map<Player, Link>();
  let offline: Player;
  let code = '';

  const players = () => [host, pia, quinn];

  test.beforeAll(async ({ browser }) => {
    host = await newPlayer(browser, 'Hana');
    pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true });
    quinn = await newPlayer(browser, 'Quinn', { viewport: PORTRAIT, isMobile: true, hasTouch: true });
    links.set(pia, await routeLink(pia.page));
    links.set(quinn, await routeLink(quinn.page));
  });

  test.afterAll(async () => {
    for (const p of players()) await p.context.close();
  });

  test('three players start a Spy Game and the spy ends round one by naming the location', async () => {
    await host.page.goto('/spygame');
    await host.page.getByTestId('home-name').fill(host.name);
    await host.page.getByTestId('home-create').click();
    code = await readCode(host.page);
    for (const p of [pia, quinn]) await joinByCode(p, 'spygame', code);
    await expect(host.page.getByTestId('player-item')).toHaveCount(3);
    await host.page.getByTestId('settings-rounds').fill('2');
    await host.page.getByTestId('settings-roundMinutes').fill('3');
    await host.page.getByTestId('start-game').click();
    for (const p of players()) await expect(p.page.getByTestId('spygame-role')).toBeVisible();

    const roles = await Promise.all(players().map(async (p) => (await p.page.getByTestId('spygame-role').getAttribute('data-role')) ?? ''));
    const spy = players()[roles.indexOf('spy')];
    const agents = players().filter((_, i) => roles[i] === 'agent');
    expect(agents).toHaveLength(2);
    // The one who goes dark is a phone that is not the spy (a vanished spy ends the round on its own).
    offline = agents.find((a) => a !== host) ?? pia;
    expect(offline).not.toBe(host);

    const locationId = (await agents[0].page.getByTestId('spygame-location').getAttribute('data-location-id')) ?? '';
    expect(locationId).not.toBe('');
    const tile = spy.page.locator(`[data-testid="guess-tile"][data-location-id="${locationId}"]`);
    await tile.click();
    await tile.click();
    for (const p of players()) await expect(p.page.getByTestId('spygame-screen')).toHaveAttribute('data-phase', 'reveal');
  });

  test('a phone drops during the reveal: the others see the waiting overlay at the round boundary, above an open sheet', async () => {
    test.setTimeout(90_000);
    const others = players().filter((p) => p !== offline);
    const guest = others.find((p) => p !== host) ?? pia;
    // The other phone is looking at the scores when the hold starts.
    await guest.page.getByTestId('players-toggle').click();
    await expect(guest.page.getByTestId('players-sheet')).toBeVisible();

    await goOffline(offline, links.get(offline) as Link);
    await expect(offline.page.getByTestId('reconnecting-banner')).toBeVisible();
    for (const p of others) {
      await expect(p.page.getByTestId('overlay-waiting')).toBeVisible({ timeout: 45_000 });
      await expect(p.page.getByTestId('overlay-waiting')).toContainText(`Waiting for ${offline.name} to reconnect`);
      await expect(p.page.getByTestId('overlay-waiting')).toContainText('2 of 3 players connected');
      await expect(p.page.getByTestId('room-code')).toHaveCount(0);
      await expect(p.page.getByTestId('spygame-header').getByTestId('timer')).toHaveAttribute('data-paused', 'players');
      // The reveal's own countdown reads as paused too (the host's Next is disabled meanwhile).
      if (p === host) {
        await expect(p.page.getByTestId('spygame-next-round')).toHaveAttribute('data-countdown', 'paused');
        await expect(p.page.getByTestId('spygame-next-round')).toBeDisabled();
      } else {
        await expect(p.page.getByTestId('reveal-countdown')).toHaveAttribute('data-countdown', 'paused');
      }
    }
    await expect(host.page.getByTestId('waiting-remove')).toHaveCount(1);
    await expect(host.page.getByTestId('waiting-remove')).toHaveAttribute('data-player-id', /.+/);
    await expect(guest.page.getByTestId('waiting-remove')).toHaveCount(0);
    await expect(guest.page.getByTestId('waiting-leave')).toBeVisible();

    // The overlay sits on top of the sheet that was open and is the dialog that holds the focus.
    const box = await guest.page.getByTestId('waiting-title').boundingBox();
    expect(box).not.toBeNull();
    const onTop = await guest.page.evaluate(
      ([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        const overlay = document.querySelector('[data-testid="overlay-waiting"]');
        return { overlay: Boolean(overlay && hit && overlay.contains(hit)), sheet: Boolean(hit?.closest('.sheet')), focused: Boolean(overlay && document.activeElement && overlay.contains(document.activeElement)) };
      },
      [(box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2],
    );
    expect(onTop).toEqual({ overlay: true, sheet: false, focused: true });
    // Tab stays inside the overlay, not the sheet underneath.
    await guest.page.keyboard.press('Tab');
    expect(await guest.page.evaluate(() => document.activeElement?.closest('[data-testid="overlay-waiting"]') !== null)).toBe(true);
  });

  test('the host removes the missing player: below three seats the game returns to the lobby with a message', async () => {
    await host.page.getByTestId('waiting-remove').click();
    for (const p of players().filter((p) => p !== offline)) {
      await expect(p.page.getByTestId('room-code')).toHaveText(code, { timeout: 15_000 });
      await expect(p.page.getByTestId('overlay-waiting')).toHaveCount(0);
      await expect(p.page.getByTestId('player-item')).toHaveCount(2);
      await expect(p.page.getByTestId('chat-log')).toContainText(`${offline.name} was kicked`);
      await expect(p.page.getByTestId('chat-log')).toContainText('Not enough players — back to the lobby.');
    }
    await expect(host.page.getByTestId('start-game')).toBeDisabled();

    // The removed phone comes back: its seat is gone, so it lands on the join form for this room.
    await goOnline(offline, links.get(offline) as Link);
    await expect(offline.page.getByTestId('home-join')).toBeVisible({ timeout: 15_000 });
    await expect(offline.page).toHaveURL(new RegExp(`/spygame/${code}$`));
    // ...and is told why: removed, not "the room may have closed".
    await expect(offline.page.getByTestId('toast').filter({ hasText: /removed from this room/i })).toBeVisible();
    await expect(offline.page.getByTestId('toast').filter({ hasText: /closed/i })).toHaveCount(0);
  });

  test('no page errors were raised in any browser', async () => {
    expect(players().flatMap((p) => p.errors)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Part three: the waiting overlay on a small phone, three long names to remove
// ---------------------------------------------------------------------------

test.describe('the waiting overlay fits a small phone with three long names', () => {
  const SMALL = { width: 320, height: 568 };
  let host: Player;
  let guests: Player[] = [];

  test.beforeAll(async ({ browser }) => {
    host = await newPlayer(browser, 'Wolfgang Amadeus', { viewport: SMALL, isMobile: true, hasTouch: true });
    guests = [];
    for (const name of ['Maximiliano Wolf', 'Bartholomew Quin', 'Christopher Long']) guests.push(await newPlayer(browser, name, { viewport: PORTRAIT, isMobile: true, hasTouch: true }));
  });

  test.afterAll(async () => {
    for (const p of [host, ...guests]) await p.context.close();
  });

  test('three phones drop during the reveal: the host sees every name and a 44px Remove for each, nothing overflows', async () => {
    test.setTimeout(120_000);
    await host.page.goto('/spygame');
    await host.page.getByTestId('home-name').fill(host.name);
    await host.page.getByTestId('home-create').click();
    const code = await readCode(host.page);
    for (const g of guests) await joinByCode(g, 'spygame', code);
    await expect(host.page.getByTestId('player-item')).toHaveCount(4);
    await host.page.getByTestId('settings-rounds').fill('2');
    await host.page.getByTestId('settings-roundMinutes').fill('3');
    await host.page.getByTestId('start-game').click();
    const all = [host, ...guests];
    for (const p of all) await expect(p.page.getByTestId('spygame-role')).toBeVisible();
    const roles = await Promise.all(all.map(async (p) => (await p.page.getByTestId('spygame-role').getAttribute('data-role')) ?? ''));
    const spy = all[roles.indexOf('spy')];
    const agent = all[roles.indexOf('agent')];
    const locationId = (await agent.page.getByTestId('spygame-location').getAttribute('data-location-id')) ?? '';
    const tile = spy.page.locator(`[data-testid="guess-tile"][data-location-id="${locationId}"]`);
    await tile.click();
    await tile.click();
    for (const p of all) await expect(p.page.getByTestId('spygame-screen')).toHaveAttribute('data-phase', 'reveal');

    // Three tabs discarded at once (the seats stay for the reconnect grace).
    for (const g of guests) await g.page.close();
    // The phone host keeps the player list in a sheet: every drop must have reached the server before the boundary.
    await host.page.getByTestId('players-toggle').click();
    for (const g of guests) await expect(host.page.locator(`[data-testid="player-item"][data-name="${g.name}"]`)).toHaveClass(/player--offline/, { timeout: 20_000 });
    await host.page.getByTestId('players-sheet-close').click();
    const overlay = host.page.getByTestId('overlay-waiting');
    await expect(overlay).toBeVisible({ timeout: 45_000 });
    for (const g of guests) await expect(overlay.getByTestId('waiting-title')).toContainText(g.name);
    await expect(overlay).toContainText('1 of 3 players connected');
    await expect(host.page.getByTestId('waiting-remove')).toHaveCount(3);

    const check = async (width: number) => {
      const metrics = await host.page.evaluate(() => {
        const card = document.querySelector('[data-testid="overlay-waiting"] .overlay__card') as HTMLElement;
        return { pageOverflow: document.documentElement.scrollWidth > window.innerWidth, cardOverflow: card.scrollWidth > card.clientWidth + 1, cardWidth: card.getBoundingClientRect().width };
      });
      expect(metrics.pageOverflow, `page overflows at ${width}`).toBe(false);
      expect(metrics.cardOverflow, `card overflows at ${width}`).toBe(false);
      expect(metrics.cardWidth).toBeLessThanOrEqual(width);
      const buttons = [...(await host.page.getByTestId('waiting-remove').all()), host.page.getByTestId('waiting-leave')];
      for (const button of buttons) {
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        expect(box, `button box at ${width}`).not.toBeNull();
        expect(box?.height ?? 0, `button height at ${width}`).toBeGreaterThanOrEqual(44);
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 0.5);
      }
      await host.page.screenshot({ path: test.info().outputPath(`waiting-overlay-${width}.png`) });
    };
    await check(SMALL.width);
    await host.page.setViewportSize(PORTRAIT);
    await check(PORTRAIT.width);
  });

  test('no page errors were raised in any browser', async () => {
    expect([host, ...guests].flatMap((p) => p.errors)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Part four: a rejoin nobody answers gives the join form back, without the spinner
// ---------------------------------------------------------------------------

test.describe('a rejoin that never gets an answer', () => {
  test('shows the join form alone after the safety valve, not next to the rejoining spinner', async ({ browser }) => {
    test.setTimeout(60_000);
    const player = await newPlayer(browser, 'Lost');
    try {
      // The server never sees the rejoin: whatever it would answer, the client waits in vain.
      await player.page.routeWebSocket(/\/ws$/, (route) => {
        const server = route.connectToServer();
        route.onMessage((m) => {
          if (typeof m === 'string' && (JSON.parse(m) as { t?: string }).t === 'rejoin') return;
          server.send(m);
        });
        server.onMessage((m) => route.send(m));
        route.onClose(() => server.close());
        server.onClose((code, reason) => route.close({ code, reason }));
      });
      await player.page.goto('/');
      await player.page.evaluate(() => {
        localStorage.setItem('boredgames.seat.ABCD', JSON.stringify({ code: 'ABCD', token: 'stale-token', playerId: 'p1', savedAt: Date.now() }));
      });
      await player.page.goto('/skribble/ABCD');
      await expect(player.page.getByTestId('rejoining-banner')).toBeVisible();
      await expect(player.page.getByTestId('home-join')).toHaveCount(0);
      await expect(player.page.getByTestId('home-join')).toBeVisible({ timeout: 25_000 });
      await expect(player.page.getByTestId('rejoining-banner')).toHaveCount(0);
      await expect(player.page.getByTestId('rejoin-stale-banner')).toBeVisible();
      await expect(player.page.getByTestId('rejoin-stale-banner')).toContainText('ABCD');
      expect(player.errors).toEqual([]);
    } finally {
      await player.context.close();
    }
  });
});
