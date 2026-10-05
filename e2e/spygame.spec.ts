import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * A whole two-round Spy Game between a desktop host and two phones (390x844, touch): roles,
 * the shared location, the spy's two-column grid, a wrong guess, a failed vote, a passed vote,
 * the reveal, a correct guess in round two and the podium. Serial: the tests build on each other.
 */
test.describe.configure({ mode: 'serial' });

const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const PORTRAIT = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const MIN_TARGET = 44;

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
/** Round one's cast. */
let spy: Player;
let agents: Player[] = [];
let locationId = '';

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

async function readCode(page: Page): Promise<string> {
  const code = ((await page.getByTestId('room-code').textContent()) ?? '').replace(/\s+/g, '');
  expect(code).toMatch(ROOM_CODE_RE);
  return code;
}

async function roleOf(p: Player): Promise<string> {
  return (await p.page.getByTestId('spygame-role').getAttribute('data-role')) ?? '';
}

/** Round one's cast from the role markers: exactly one spy, everyone else an agent. */
async function castOf(): Promise<{ spy: Player; agents: Player[] }> {
  const roles = await Promise.all(players.map(roleOf));
  const spies = players.filter((_, i) => roles[i] === 'spy');
  expect(spies).toHaveLength(1);
  return { spy: spies[0], agents: players.filter((_, i) => roles[i] === 'agent') };
}

/** The round clock in the header (the vote and the reveal carry timers of their own). */
function clock(p: Player): Locator {
  return p.page.getByTestId('spygame-header').getByTestId('timer');
}

function guessTile(p: Player, id: string): Locator {
  return p.page.locator(`[data-testid="guess-tile"][data-location-id="${id}"]`);
}

function accuseRow(p: Player, name: string): Locator {
  return p.page.locator(`[data-testid="accuse-row"][data-name="${name}"]`);
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

async function noHorizontalOverflow(p: Player): Promise<void> {
  await expect.poll(() => p.page.evaluate(() => document.documentElement.scrollWidth), { message: `${p.name}: document.scrollWidth` }).toBeLessThanOrEqual(PORTRAIT.width);
}

/**
 * Runs `check` with the page at phone size. The spy is drawn at random, so the phone-layout
 * assertions must not depend on which player (the desktop host included) is drawn.
 */
async function atPhoneSize(p: Player, check: () => Promise<void>): Promise<void> {
  const before = p.page.viewportSize() ?? DESKTOP;
  await p.page.setViewportSize(PORTRAIT);
  try {
    await check();
  } finally {
    await p.page.setViewportSize(before);
  }
}

/** Reads a score from the platform player list, which lives in the scores sheet. */
async function scoreOf(p: Player, name: string): Promise<number> {
  await p.page.getByTestId('players-toggle').click();
  const raw = await p.page.locator(`[data-testid="player-item"][data-name="${name}"]`).getAttribute('data-score');
  await p.page.getByTestId('players-sheet-close').click();
  return Number(raw ?? 'NaN');
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  quinn = await newPlayer(browser, 'Quinn', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host creates a Spy Game room, two phones join by code and the host tunes the settings', async () => {
  await host.page.goto('/spygame');
  await expect(host.page.getByTestId('site-header')).toContainText('The Spy Game');
  await host.page.getByTestId('home-name').fill(host.name);
  await host.page.getByTestId('home-create').click();
  roomCode = await readCode(host.page);
  await expect(host.page).toHaveURL(new RegExp(`/spygame/${roomCode}$`));
  // Three players are needed.
  await expect(host.page.getByTestId('start-game')).toBeDisabled();

  for (const p of [pia, quinn]) {
    await p.page.goto('/spygame');
    await p.page.getByTestId('code-input-0').pressSequentially(roomCode, { delay: 20 });
    await expect(p.page.getByTestId('room-preview')).toContainText(/players/);
    await p.page.getByTestId('home-name').fill(p.name);
    await p.page.getByTestId('home-join').click();
    await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
    await expect(p.page).toHaveURL(new RegExp(`/spygame/${roomCode}$`));
  }
  await expect(host.page.getByTestId('player-item')).toHaveCount(3);

  await host.page.getByTestId('settings-rounds').fill('2');
  await host.page.getByTestId('settings-roundMinutes').fill('3');
  await host.page.getByTestId('settings-voteSeconds').fill('15');
  await expect(pia.page.getByTestId('settings-value-rounds')).toHaveText('2');
  await expect(pia.page.getByTestId('settings-value-roundMinutes')).toHaveText('3 min');
  await expect(pia.page.getByTestId('settings-value-voteSeconds')).toHaveText('15s');
  await expect(pia.page.getByTestId('settings-rounds')).toHaveCount(0);

  await expect(host.page.getByTestId('start-game')).toBeEnabled();
  await host.page.getByTestId('start-game').click();
  for (const p of players) {
    await expect(p.page.getByTestId('spygame-role')).toBeVisible();
    await expect(p.page.getByTestId('round-indicator')).toContainText('Round 1');
    await expect(clock(p)).toBeVisible();
  }
  await expect(host.page.getByTestId('chat-log')).toContainText('Round 1 of 2 — look at your phone');
});

test('exactly one spy; the agents share the location, the spy sees none and gets 24 tiles in two columns of twelve', async () => {
  ({ spy, agents } = await castOf());
  expect(agents).toHaveLength(2);

  const ids = await Promise.all(agents.map((a) => a.page.getByTestId('spygame-location').getAttribute('data-location-id')));
  expect(ids[0]).toBeTruthy();
  expect(ids[1]).toBe(ids[0]);
  locationId = ids[0] ?? '';
  for (const a of agents) {
    await expect(a.page.getByTestId('spygame-role')).toContainText('You are not the spy');
    await expect(a.page.getByTestId('spygame-guesses-left')).toHaveAttribute('data-count', '2');
    await expect(a.page.getByTestId('candidate-tile')).toHaveCount(24);
    await expect(a.page.locator(`[data-testid="candidate-tile"][data-location-id="${locationId}"]`)).toHaveAttribute('data-state', 'real');
    await expect(a.page.getByTestId('accuse-row')).toHaveCount(3);
    await expect(accuseRow(a, a.name)).toBeDisabled();
  }

  await expect(spy.page.getByTestId('spygame-role')).toContainText('You are the spy');
  await expect(spy.page.getByTestId('spygame-location')).toHaveCount(0);
  await expect(spy.page.getByTestId('candidate-tile')).toHaveCount(0);
  const tiles = spy.page.getByTestId('guess-tile');
  await expect(tiles).toHaveCount(24);
  // The grid is a phone layout: assert it at phone size whoever the spy is.
  await atPhoneSize(spy, async () => {
    await expect(spy.page.locator('.spy--phone')).toBeVisible();
    const boxes = await Promise.all(Array.from({ length: 24 }, (_, i) => boxOf(tiles.nth(i))));
    const columns = new Map<number, number>();
    for (const box of boxes) {
      const x = Math.round(box.x);
      columns.set(x, (columns.get(x) ?? 0) + 1);
      expect(box.height, 'a guess tile is a 44px target').toBeGreaterThanOrEqual(MIN_TARGET);
      expect(box.width, 'a guess tile is a 44px target').toBeGreaterThanOrEqual(MIN_TARGET);
    }
    expect([...columns.values()]).toEqual([12, 12]);
    await noHorizontalOverflow(spy);
  });
  // The spy's player list is read-only: no accuse buttons.
  await expect(spy.page.locator('button[data-testid="accuse-row"]')).toHaveCount(0);
  await expect(spy.page.getByTestId('accuse-row')).toHaveCount(3);

  for (const p of phones()) await noHorizontalOverflow(p);
});

test('a wrong guess (two taps) is announced on every screen and rules the tile out', async () => {
  const ids = await spy.page.getByTestId('guess-tile').evaluateAll((els) => els.map((el) => el.getAttribute('data-location-id') ?? ''));
  const wrong = ids.find((id) => id !== locationId);
  if (!wrong) throw new Error('no decoy');
  const tile = guessTile(spy, wrong);
  await tile.click();
  await expect(tile).toHaveAttribute('data-state', 'highlighted');
  await expect(tile).toContainText('Tap again to confirm');
  // Tapping another tile moves the highlight instead of guessing.
  const other = ids.find((id) => id !== locationId && id !== wrong) ?? '';
  await guessTile(spy, other).click();
  await expect(tile).toHaveAttribute('data-state', 'idle');
  await expect(guessTile(spy, other)).toHaveAttribute('data-state', 'highlighted');
  await tile.click();
  await tile.click();

  for (const p of players) {
    await expect(p.page.getByTestId('spygame-wrong-guess')).toContainText('1 guess left');
    await expect(p.page.getByTestId('spygame-guesses-left')).toHaveAttribute('data-count', '1');
  }
  await expect(tile).toHaveAttribute('data-state', 'ruledOut');
  await expect(tile).toBeDisabled();
  await expect(host.page.getByTestId('chat-log')).toContainText('The spy guessed wrong! 1 guess left');
  await expect(spy.page.getByTestId('spygame-location')).toHaveCount(0);
});

test('an accusation pauses the clock and opens the vote sheet; a tie fails and play resumes', async () => {
  const [accuser, other] = agents;
  const row = accuseRow(accuser, spy.name);
  await row.click();
  await expect(row).toHaveAttribute('data-state', 'highlighted');
  await expect(row).toContainText('Tap again to accuse');
  await row.click();

  await expect(other.page.getByTestId('vote-sheet')).toBeVisible();
  await expect(other.page.getByTestId('vote-sheet')).toContainText(`${accuser.name}`);
  await expect(other.page.getByTestId('vote-sheet')).toContainText(`${spy.name}`);
  for (const id of ['vote-yes', 'vote-no']) {
    const box = await boxOf(other.page.getByTestId(id));
    expect(box.height, `${id} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
  }
  // The accuser's auto-Yes is already on the board. Nothing says how many may still vote: that would name the spy.
  await expect(other.page.getByTestId('vote-tally')).toHaveAttribute('data-yes', '1');
  await expect(other.page.getByTestId('vote-tally')).toHaveAttribute('data-no', '0');
  await expect(other.page.getByTestId('vote-tally')).not.toHaveAttribute('data-pending', /.*/);
  await expect(other.page.getByTestId('vote-sheet')).not.toContainText('to go');
  // The spy (here the accused) has no say, and neither does the accuser beyond their fixed Yes.
  await expect(spy.page.getByTestId('vote-panel')).toHaveAttribute('data-role', 'accused');
  await expect(spy.page.getByTestId('vote-panel')).toContainText("You've been accused!");
  await expect(spy.page.getByTestId('vote-yes')).toHaveCount(0);
  await expect(spy.page.getByTestId('vote-sheet')).toHaveCount(0);
  await expect(spy.page.getByTestId('vote-panel-tally')).toHaveAttribute('data-yes', '1');
  await expect(accuser.page.getByTestId('vote-panel')).toHaveAttribute('data-role', 'accuser');
  await expect(accuser.page.getByTestId('vote-yes')).toHaveCount(0);
  for (const p of players) await expect(clock(p)).toHaveAttribute('data-paused', 'vote');
  await expect(host.page.getByTestId('chat-log')).toContainText(`${accuser.name} accuses ${spy.name} of being the spy! Vote now.`);

  // A No makes it 1-1: a tie fails, the clock resumes, the accuser's accusation is spent.
  await other.page.getByTestId('vote-no').click();
  await expect(host.page.getByTestId('chat-log')).toContainText('The vote failed — play on.');
  await expect(host.page.getByTestId('chat-log')).not.toContainText('The vote failed (');
  for (const p of players) {
    await expect(p.page.getByTestId('vote-panel')).toHaveCount(0);
    await expect(clock(p)).not.toHaveAttribute('data-paused', /.+/);
    await expect(p.page.getByTestId('spygame-reveal')).toHaveCount(0);
  }
  await expect(other.page.getByTestId('vote-sheet')).toHaveCount(0);
  await expect(accuser.page.getByTestId('accuse-hint')).toContainText("You've used your accusation this round.");
  await expect(accuseRow(accuser, spy.name)).toBeDisabled();
  await expect(accuseRow(other, spy.name)).toBeEnabled();
});

test('the other agent accuses the spy, the vote passes and the reveal shows spyCaught with +3 / +1', async () => {
  const [first, accuser] = agents;
  await accuseRow(accuser, spy.name).click();
  await accuseRow(accuser, spy.name).click();
  await expect(first.page.getByTestId('vote-sheet')).toBeVisible();
  await expect(first.page.getByTestId('vote-tally')).toHaveAttribute('data-yes', '1');
  await first.page.getByTestId('vote-yes').click();

  for (const p of players) {
    const reveal = p.page.getByTestId('spygame-reveal');
    await expect(reveal).toBeVisible();
    await expect(reveal).toHaveAttribute('data-outcome', 'spyCaught');
    await expect(reveal.getByTestId('reveal-spy')).toContainText(spy.name);
    await expect(reveal.getByTestId('reveal-location')).toHaveAttribute('data-location-id', locationId);
    await expect(reveal.locator(`[data-testid="reveal-points-row"][data-name="${accuser.name}"]`)).toHaveAttribute('data-points', '3');
    await expect(reveal.locator(`[data-testid="reveal-points-row"][data-name="${first.name}"]`)).toHaveAttribute('data-points', '1');
    await expect(reveal.locator(`[data-testid="reveal-points-row"][data-name="${spy.name}"]`)).toHaveCount(0);
    await expect(clock(p)).toHaveAttribute('data-paused', 'reveal');
  }
  await expect(host.page.getByTestId('spygame-next-round')).toBeVisible();
  await expect(host.page.getByTestId('spygame-end-game')).toBeVisible();
  for (const p of phones()) {
    await expect(p.page.getByTestId('reveal-countdown')).toContainText('Next round in');
    await expect(p.page.getByTestId('spygame-next-round')).toHaveCount(0);
    await noHorizontalOverflow(p);
  }
  await expect(host.page.getByTestId('chat-log')).toContainText(`${spy.name} was the spy — caught!`);
});

test('the host starts round two; the spy guesses right for +4; the podium lists three players', async () => {
  await host.page.getByTestId('spygame-next-round').click();
  for (const p of players) {
    await expect(p.page.locator('[data-testid="spygame-screen"][data-phase="playing"]')).toBeVisible();
    await expect(p.page.getByTestId('round-indicator')).toContainText('Round 2');
    await expect(p.page.getByTestId('spygame-wrong-guess')).toHaveCount(0);
  }
  // Round one's scores stand.
  expect(await scoreOf(host, agents[1].name)).toBe(3);
  expect(await scoreOf(host, agents[0].name)).toBe(1);
  expect(await scoreOf(host, spy.name)).toBe(0);

  const cast = await castOf();
  expect(cast.spy).not.toBe(spy); // the spy rotates
  const agent = cast.agents[0];
  const location = (await agent.page.getByTestId('spygame-location').getAttribute('data-location-id')) ?? '';
  expect(location).toBeTruthy();
  await expect(cast.spy.page.getByTestId('guess-tile')).toHaveCount(24);
  const tile = guessTile(cast.spy, location);
  await tile.click();
  await tile.click();

  for (const p of players) {
    const reveal = p.page.getByTestId('spygame-reveal');
    await expect(reveal).toHaveAttribute('data-outcome', 'spyGuessed');
    await expect(reveal.getByTestId('reveal-spy')).toContainText(cast.spy.name);
    await expect(reveal.locator(`[data-testid="reveal-points-row"][data-name="${cast.spy.name}"]`)).toHaveAttribute('data-points', '4');
  }
  await expect(host.page.getByTestId('spygame-next-round')).toContainText('Show results');
  await host.page.getByTestId('spygame-next-round').click();

  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible();
    await expect(end.getByTestId('podium-entry')).toHaveCount(3);
  }
  await expect(host.page.getByTestId('back-to-lobby')).toBeVisible();
  await host.page.getByTestId('back-to-lobby').click();
  for (const p of players) await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
