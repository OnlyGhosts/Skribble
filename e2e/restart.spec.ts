import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createParty, endGameAsHost, expectReadyCount, joinByCode, readyAll } from './party';

/**
 * Games survive a server restart, held by the phones. Each test runs its own production server
 * (on E2E_RESTART_PORT), kills it mid-game and starts it again: with the same ROOM_CHECKPOINT_KEY
 * the pages carry on where they were without a "game ended" message (Blackjack through a deploy's
 * SIGTERM, Scribble through a crash's SIGKILL); with a new key the checkpoints no longer open and
 * every page ends the game cleanly with the restart message.
 */

const PORT = Number(process.env.E2E_RESTART_PORT ?? 5365);
const BASE = `http://localhost:${PORT}`;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const ENDED = 'The server restarted, so that game ended.';
const SEAT_PREFIX = 'boredgames.seat.';

class Server {
  private child: ChildProcess | null = null;
  output = '';

  constructor(private key: string) {}

  /** Starts `node dist/server/index.js`, with a new key from now on when one is given. */
  async start(key = this.key): Promise<void> {
    this.key = key;
    this.output = '';
    const child = spawn(process.execPath, ['dist/server/index.js'], {
      env: { ...process.env, PORT: String(PORT), ROOM_CHECKPOINT_KEY: key },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => (this.output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (this.output += chunk.toString()));
    await expect
      .poll(async () => {
        if (child.exitCode !== null) throw new Error(`the server exited:\n${this.output}`);
        return fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
      }, { message: `the server on ${PORT}`, timeout: 20_000 })
      .toBe(true);
  }

  /** Sends `signal` and waits for the process to be gone. */
  async stop(signal: NodeJS.Signals): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill(signal);
    await gone;
  }
}

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
  // Console errors are not collected: a browser logs every refused WebSocket while the server is down.
  page.on('pageerror', (err) => errors.push(`${name}: ${err.message}`));
  return { name, context, page, errors };
}

/** Host on a desktop, two phones; the host's page creates the party for `slug` and the phones join by code. */
async function party(browser: Browser, slug: string): Promise<{ players: Player[]; code: string }> {
  const players = [
    await newPlayer(browser, 'Hana', { viewport: { width: 1280, height: 800 } }),
    await newPlayer(browser, 'Pia', PHONE),
    await newPlayer(browser, 'Quinn', PHONE),
  ];
  const [host, ...guests] = players;
  const code = await createParty(host.page, host.name, slug, BASE);
  for (const g of guests) await joinByCode(g.page, g.name, code, BASE);
  await readyAll(guests.map((g) => g.page));
  await expectReadyCount(host.page, players.length);
  return { players, code };
}

/** When the checkpoint kept with the page's seat was issued (its plain header), or 0 without one. */
function checkpointIssuedAt(page: Page, code: string): Promise<number> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    const text = raw ? (JSON.parse(raw) as { checkpoint?: { text?: string } }).checkpoint?.text : undefined;
    if (!text) return 0;
    const bytes = atob(text.slice(0, 12).replace(/-/g, '+').replace(/_/g, '/'));
    let at = 0;
    for (let i = 1; i <= 8; i++) at = at * 256 + bytes.charCodeAt(i);
    return at;
  }, `${SEAT_PREFIX}${code}`);
}

/** The "game ended" toast on the page, and the front door behind it. */
async function sawGameEnd(p: Player): Promise<void> {
  await expect(p.page.getByTestId('toast').filter({ hasText: ENDED })).toBeVisible({ timeout: 30_000 });
  await expect(p.page.getByTestId('home-create')).toBeVisible();
  await expect(p.page.getByTestId('reconnecting-banner')).toHaveCount(0);
  await expect(p.page.getByTestId('connection-status')).toHaveCount(0);
}

/** Back in the game: the notice gone and no "game ended", "connection lost" or red box. */
async function carriedOn(p: Player): Promise<void> {
  await expect(p.page.getByTestId('reconnecting-banner')).toHaveCount(0, { timeout: 20_000 });
  await expect(p.page.getByTestId('toast').filter({ hasText: /game ended|Connection lost/ })).toHaveCount(0);
  await expect(p.page.locator('[data-testid="toast"].toast--error')).toHaveCount(0);
  await expect(p.page.getByTestId('home-create')).toHaveCount(0);
}

const bj = (p: Player) => p.page.getByTestId('blackjack-screen');

/** Where a Blackjack page stands: round, phase, whose turn on which hand, its chips and its hands. */
async function blackjackState(p: Player): Promise<string> {
  const table = await bj(p).evaluate((el) => ['phase', 'round', 'turnPlayer', 'turnHand'].map((k) => (el as HTMLElement).dataset[k] ?? '').join(':'));
  const chips = await p.page.getByTestId('my-chips').getAttribute('data-chips');
  const hands = await p.page.getByTestId('my-hand').evaluateAll((els) => els.map((el) => `${(el as HTMLElement).dataset.bet}/${(el as HTMLElement).dataset.cards}/${(el as HTMLElement).dataset.total}`).join(','));
  return `${table} chips ${chips} hands ${hands}`;
}

/** Everyone bets until a round deals into turns (a dealer blackjack settles one at the deal). */
async function dealIntoTurns(players: Player[]): Promise<void> {
  const [host] = players;
  for (let rounds = 0; rounds < 4; rounds++) {
    const round = await bj(host).getAttribute('data-round');
    for (const p of players) {
      await expect(p.page.getByTestId('place-bet')).toBeEnabled();
      await p.page.getByTestId('place-bet').click();
    }
    await expect.poll(async () => {
      const phase = await bj(host).getAttribute('data-phase');
      return phase === 'acting' || (phase === 'results' && (await bj(host).getAttribute('data-round')) === round);
    }, { message: 'the round dealt' }).toBe(true);
    if ((await bj(host).getAttribute('data-phase')) === 'acting') {
      for (const p of players) await expect(bj(p)).toHaveAttribute('data-phase', 'acting');
      return;
    }
  }
  throw new Error('no round dealt into turns');
}

/** Stands every hand in turn until the round settles. */
async function standOut(players: Player[]): Promise<void> {
  const [host] = players;
  for (let moves = 0; moves < 12; moves++) {
    let actor: Player | null = null;
    await expect
      .poll(async () => {
        if ((await bj(host).getAttribute('data-phase')) !== 'acting') return 'settled';
        for (const p of players) {
          if (await p.page.getByTestId('action-stand').isEnabled()) {
            actor = p;
            return p.name;
          }
        }
        return null;
      }, { message: 'a player to act, or the settled round' })
      .not.toBeNull();
    if (!actor) return;
    const acting: Player = actor;
    const before = await blackjackState(acting);
    await acting.page.getByTestId('action-stand').click();
    await expect.poll(async () => (await bj(host).getAttribute('data-phase')) !== 'acting' || (await blackjackState(acting)) !== before).toBe(true);
  }
  throw new Error('the round did not settle');
}

/** The drawer is whoever sees the word choices. */
async function drawerOf(players: Player[]): Promise<Player> {
  let drawer: Player | null = null;
  await expect
    .poll(async () => {
      for (const p of players) {
        if (await p.page.getByTestId('word-choice').first().isVisible()) {
          drawer = p;
          return p.name;
        }
      }
      return null;
    }, { message: 'a drawer choosing', timeout: 20_000 })
    .not.toBeNull();
  if (!drawer) throw new Error('unreachable');
  return drawer;
}

/** The drawer picks the first word and draws a line; returns the word. */
async function startDrawing(drawer: Player): Promise<string> {
  await drawer.page.getByTestId('word-choice').first().click();
  await expect(drawer.page.getByTestId('word-plain')).toBeVisible();
  const box = await drawer.page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await drawer.page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await drawer.page.mouse.down();
  await drawer.page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
  await drawer.page.mouse.up();
  return ((await drawer.page.getByTestId('word-plain').locator('.word__text').textContent()) ?? '').trim();
}

async function guess(p: Player, word: string): Promise<void> {
  const input = p.page.getByTestId('guess-input');
  await input.fill(word);
  await input.press('Enter');
}

/** Every player's score, from the players list on `p`'s page (a desktop shows it beside the canvas). */
async function scribbleScores(p: Player, players: Player[]): Promise<Record<string, number>> {
  const scores: Record<string, number> = {};
  for (const q of players) scores[q.name] = Number(await p.page.locator(`[data-testid="player-item"][data-name="${q.name}"]`).getAttribute('data-score'));
  return scores;
}

/** A whole Scribble turn: the drawer picks, everyone else guesses right. */
async function playTurn(players: Player[]): Promise<void> {
  const drawer = await drawerOf(players);
  const word = await startDrawing(drawer);
  for (const p of players) if (p !== drawer) await guess(p, word);
  await expect(drawer.page.getByTestId('overlay-turn-end')).toBeVisible();
}

test.describe('a server restart mid-game', () => {
  let server: Server;
  let players: Player[] = [];

  test.beforeEach(async () => {
    server = new Server(randomBytes(32).toString('base64'));
    await server.start();
  });

  test.afterEach(async () => {
    for (const p of players) await p.context.close();
    players = [];
    await server.stop('SIGKILL');
  });

  test('Blackjack carries on through a deploy: same turn, chips and hands, then plays on to the results', async ({ browser }) => {
    test.setTimeout(120_000);
    const table = await party(browser, 'blackjack');
    players = table.players;
    const [host, pia] = players;
    await host.page.getByTestId('start-game').click();
    for (const p of players) await expect(bj(p)).toHaveAttribute('data-phase', 'betting');
    await dealIntoTurns(players);
    // Every page shows its two cards landed before the state is read.
    for (const p of players) await expect(p.page.locator('[data-testid="my-hand"]:not([data-cards="2"])')).toHaveCount(0);
    const before = await Promise.all(players.map(blackjackState));

    await server.stop('SIGTERM');
    // The deploy's close says the server is restarting: the notice says the game carries on.
    for (const p of players.slice(1)) {
      await expect(p.page.getByTestId('reconnecting-banner')).toHaveAttribute('data-status', 'restarting');
      await expect(p.page.getByTestId('reconnecting-banner')).toContainText('The server is restarting. Your game will carry');
    }
    await expect(pia.page.getByTestId('toast').filter({ hasText: 'Connection lost' })).toHaveCount(0);
    await server.start();

    for (const p of players) await carriedOn(p);
    await expect.poll(() => Promise.all(players.map(blackjackState))).toEqual(before);

    await standOut(players);
    for (const p of players) await expect(p.page.getByTestId('bj-table')).toHaveAttribute('data-settled', 'true');
    await endGameAsHost(host.page);
    for (const p of players) {
      await expect(p.page.getByTestId('overlay-game-end')).toBeVisible();
      await expect(p.page.getByTestId('toast').filter({ hasText: 'game ended' })).toHaveCount(0);
      expect(p.errors).toEqual([]);
    }
  });

  test('Scribble carries on through a crash: the turn caught mid-drawing restarts with its drawer, the scores kept, and the game ends normally', async ({ browser }) => {
    test.setTimeout(150_000);
    const room = await party(browser, 'scribble');
    players = room.players;
    const [host] = players;
    await host.page.getByTestId('settings-rounds').fill('1');
    await expect(host.page.getByTestId('settings-value-rounds')).toHaveText('1');
    await host.page.getByTestId('start-game').click();

    await playTurn(players);
    const drawer = await drawerOf(players);
    const afterFirstTurn = await scribbleScores(host, players);
    expect(Object.values(afterFirstTurn).some((s) => s > 0)).toBe(true);
    const word = await startDrawing(drawer);
    const guesser = players.find((p) => p !== drawer);
    if (!guesser) throw new Error('no guesser');
    await guess(guesser, word);
    await expect.poll(async () => (await scribbleScores(host, players))[guesser.name]).toBeGreaterThan(afterFirstTurn[guesser.name]);
    // A crash keeps only what the phones were sent: wait for a checkpoint issued after the guess.
    const guessedAt = Date.now();
    await expect.poll(() => checkpointIssuedAt(host.page, room.code), { timeout: 10_000 }).toBeGreaterThan(guessedAt);

    await server.stop('SIGKILL');
    await server.start();

    for (const p of players) await carriedOn(p);
    // The turn starts over with the same drawer and the points it had earned taken back.
    await expect(drawer.page.getByTestId('word-choice')).toHaveCount(3);
    for (const p of players) if (p !== drawer) await expect(p.page.getByTestId('overlay-choosing')).toContainText(`${drawer.name} is choosing`);
    await expect.poll(() => scribbleScores(host, players)).toEqual(afterFirstTurn);

    await playTurn(players);
    await playTurn(players);
    for (const p of players) {
      await expect(p.page.getByTestId('overlay-game-end')).toBeVisible({ timeout: 20_000 });
      await expect(p.page.getByTestId('toast').filter({ hasText: 'game ended' })).toHaveCount(0);
      expect(p.errors).toEqual([]);
    }
  });

  test('with a new key the checkpoints no longer open: every page ends the game with the restart message', async ({ browser }) => {
    test.setTimeout(90_000);
    const table = await party(browser, 'blackjack');
    players = table.players;
    const [host] = players;
    await host.page.getByTestId('start-game').click();
    for (const p of players) await expect(bj(p)).toHaveAttribute('data-phase', 'betting');
    for (const p of players) await expect.poll(() => checkpointIssuedAt(p.page, table.code)).toBeGreaterThan(0);

    await server.stop('SIGTERM');
    await server.start(randomBytes(32).toString('base64'));

    for (const p of players) {
      await sawGameEnd(p);
      // The seat and its checkpoint are gone with the room: a reload stays on the front door.
      expect(await p.page.evaluate((prefix) => Object.keys(localStorage).filter((k) => k.startsWith(prefix)), SEAT_PREFIX)).toEqual([]);
    }
    await host.page.goto(`${BASE}/blackjack/${table.code}`);
    await expect(host.page.getByTestId('home-join')).toBeVisible();
    await expect(host.page.getByTestId('room-code')).toHaveCount(0);
    // A new party starts as usual.
    await createParty(host.page, host.name, 'blackjack', BASE);
    for (const p of players) expect(p.errors).toEqual([]);
  });
});
