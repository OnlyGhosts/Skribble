import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { PROMPTS } from '../shared/games/quipgame/prompts';

/**
 * A whole Quip Game between a desktop host and two phones (390x844, touch): the lobby settings,
 * two writing-and-voting rounds (the second at double points), the ranked final and the podium.
 * With three players every matchup has exactly one eligible voter, so the result is predictable.
 * Serial: the tests build on each other.
 */
test.describe.configure({ mode: 'serial' });

const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const PORTRAIT = { width: 390, height: 844 };
const MIN_TARGET = 44;
const MIN_ANSWER_HEIGHT = 64;
const PACK = new Set(PROMPTS.map((p) => p.text));

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

async function readCode(page: Page): Promise<string> {
  const code = ((await page.getByTestId('room-code').textContent()) ?? '').replace(/\s+/g, '');
  expect(code).toMatch(ROOM_CODE_RE);
  return code;
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

async function noHorizontalOverflow(p: Player): Promise<void> {
  await expect.poll(() => p.page.evaluate(() => document.documentElement.scrollWidth), { message: `${p.name}: document.scrollWidth` }).toBeLessThanOrEqual(PORTRAIT.width);
}

/** Reads every player's score from the platform player list, which lives in the scores sheet (one open/close per read). */
async function scoresOn(p: Player): Promise<number[]> {
  await p.page.getByTestId('players-toggle').click();
  await expect(p.page.getByTestId('player-item')).toHaveCount(players.length);
  const scores: number[] = [];
  for (const other of players) scores.push(Number((await p.page.locator(`[data-testid="player-item"][data-name="${other.name}"]`).getAttribute('data-score')) ?? 'NaN'));
  await p.page.getByTestId('players-sheet-close').click();
  await expect(p.page.getByTestId('players-sheet')).toHaveCount(0);
  return scores;
}

/** Everyone writes `count` answers, each embedding the author's name, and reads the prompts from the pack. */
async function writeRound(count: number, suffix: string): Promise<void> {
  for (const p of players) {
    for (let i = 1; i <= count; i++) {
      const progress = p.page.getByTestId('write-progress');
      await expect(progress).toHaveAttribute('data-number', String(i));
      const prompt = (await p.page.getByTestId('write-prompt').textContent()) ?? '';
      expect(PACK.has(prompt), `${p.name} reads a prompt from the pack: ${prompt}`).toBe(true);
      const input = p.page.getByTestId('write-input');
      await input.fill(`${p.name}-${suffix}${i}`);
      await expect(p.page.getByTestId('write-counter')).toContainText(`${p.name.length + suffix.length + 2}/80`);
      await p.page.getByTestId('write-submit').click();
    }
  }
}

interface Reveal {
  outcome: string;
  matchup: string;
  a: { name: string; text: string; points: string; votes: string; flawless: string };
  b: { name: string; text: string; points: string; votes: string; flawless: string };
}

/** One round trip for the whole result card, so the assertions beat the result timer. */
async function readResult(p: Player): Promise<Reveal> {
  const card = p.page.getByTestId('quip-result');
  await expect(card).toBeVisible();
  return card.evaluate((el) => {
    const row = (choice: string) => {
      const r = el.querySelector(`[data-testid="result-answer"][data-choice="${choice}"]`) as HTMLElement;
      return { name: r.dataset.authorName ?? '', text: r.querySelector('[data-testid="result-text"]')?.textContent ?? '', points: r.dataset.points ?? '', votes: r.dataset.votes ?? '', flawless: r.dataset.flawless ?? '' };
    };
    const e = el as HTMLElement;
    return { outcome: e.dataset.outcome ?? '', matchup: e.dataset.matchup ?? '', a: row('a'), b: row('b') };
  });
}

/** The one player who may vote on the open matchup (the other two wrote the answers). */
async function voterOf(): Promise<Player> {
  let voter: Player | undefined;
  await expect
    .poll(
      async () => {
        for (const p of players) {
          const can = await p.page.locator('[data-testid="quip-voting"][data-can-vote="true"]').count();
          if (can > 0) {
            voter = p;
            return p.name;
          }
        }
        return null;
      },
      { message: 'a player who can vote' },
    )
    .not.toBeNull();
  if (!voter) throw new Error('no voter');
  return voter;
}

/** Plays one matchup: the voter picks `choice`, the result names both authors and pays the winner `pool`. */
async function playMatchup(index: number, choice: 'a' | 'b', pool: number, skip: boolean): Promise<Reveal> {
  for (const p of players) await expect(p.page.locator(`[data-testid="quip-voting"][data-matchup="${index}"]`)).toBeVisible();
  const voter = await voterOf();
  const authors = players.filter((p) => p !== voter);
  for (const a of authors) {
    await expect(a.page.getByTestId('vote-author')).toContainText('sit tight');
    await expect(a.page.locator('button[data-testid="vote-answer"]')).toHaveCount(0);
  }
  await expect(voter.page.getByTestId('vote-count')).toHaveAttribute('data-votes', '0');
  const button = voter.page.locator(`button[data-testid="vote-answer"][data-choice="${choice}"]`);
  await expect(button).toBeEnabled();
  await button.click();

  const result = await readResult(host);
  expect(result.matchup).toBe(String(index));
  expect(result.outcome).toBe(choice);
  const winner = result[choice];
  const loser = result[choice === 'a' ? 'b' : 'a'];
  expect(winner.points).toBe(String(pool));
  expect(loser.points).toBe('0');
  expect(winner.votes).toBe('1');
  expect(loser.votes).toBe('0');
  // One vote never counts as flawless.
  expect(winner.flawless).toBe('false');
  expect(loser.flawless).toBe('false');
  // The authors are revealed, and each answer carries its author's name.
  expect(new Set([result.a.name, result.b.name])).toEqual(new Set(authors.map((a) => a.name)));
  expect(result.a.text.startsWith(`${result.a.name}-`)).toBe(true);
  expect(result.b.text.startsWith(`${result.b.name}-`)).toBe(true);
  if (skip) await host.page.getByTestId('quip-next').click();
  return result;
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  quinn = await newPlayer(browser, 'Quinn', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host creates a Quip Game room, two phones join by code and the host tunes the settings', async () => {
  await host.page.goto('/quipgame');
  await expect(host.page.getByTestId('site-header')).toContainText('Quip Game');
  await host.page.getByTestId('home-name').fill(host.name);
  await host.page.getByTestId('home-create').click();
  roomCode = await readCode(host.page);
  await expect(host.page).toHaveURL(new RegExp(`/quipgame/${roomCode}$`));
  await expect(host.page.getByTestId('start-game')).toBeDisabled();

  for (const p of [pia, quinn]) {
    await p.page.goto('/quipgame');
    await p.page.getByTestId('code-input-0').pressSequentially(roomCode, { delay: 20 });
    await expect(p.page.getByTestId('room-preview')).toContainText(/players/);
    await p.page.getByTestId('home-name').fill(p.name);
    await p.page.getByTestId('home-join').click();
    await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
  }
  await expect(host.page.getByTestId('player-item')).toHaveCount(3);

  await host.page.getByTestId('settings-writeSeconds').fill('30');
  await host.page.getByTestId('settings-voteSeconds').fill('15');
  await host.page.getByTestId('settings-resultsSeconds').fill('4');
  await expect(host.page.getByTestId('settings-finalRound')).toBeChecked();
  await expect(host.page.getByTestId('settings-customPromptsOnly')).toBeDisabled();
  await expect(pia.page.getByTestId('settings-value-writeSeconds')).toHaveText('30s');
  await expect(pia.page.getByTestId('settings-value-voteSeconds')).toHaveText('15s');
  await expect(pia.page.getByTestId('settings-value-resultsSeconds')).toHaveText('4s');
  await expect(pia.page.getByTestId('settings-writeSeconds')).toHaveCount(0);
  await expect(pia.page.getByTestId('settings-cheeky')).toBeDisabled();

  await expect(host.page.getByTestId('start-game')).toBeEnabled();
  await host.page.getByTestId('start-game').click();
  for (const p of players) {
    await expect(p.page.getByTestId('quip-writing')).toBeVisible();
    await expect(p.page.getByTestId('round-indicator')).toHaveAttribute('data-round', '1');
    await expect(p.page.getByTestId('round-indicator')).toHaveAttribute('data-total', '3');
    await expect(p.page.getByTestId('quipgame-header').getByTestId('timer')).toBeVisible();
  }
  await expect(host.page.getByTestId('chat-log')).toContainText('Round 1 of 3 — write your answers!');
});

test('round one: the phone layout fits, everyone writes two answers and the room moves on to voting', async () => {
  for (const p of phones()) {
    await noHorizontalOverflow(p);
    const input = p.page.getByTestId('write-input');
    const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize, 'the answer field is at least 16px so iOS does not zoom').toBeGreaterThanOrEqual(16);
    await expect(input).toHaveAttribute('enterkeyhint', 'done');
    await expect(input).toHaveAttribute('maxlength', '80');
    expect((await boxOf(p.page.getByTestId('write-submit'))).height).toBeGreaterThanOrEqual(MIN_TARGET);
    for (const id of ['players-toggle', 'chat-toggle', 'game-menu']) expect((await boxOf(p.page.getByTestId(id))).height).toBeGreaterThanOrEqual(MIN_TARGET);
  }
  // The first phone writes one answer and sees the second prompt slide in; the waiting card lists both answers with Edit.
  await writeRound(2, 'r1-');
  await expect(host.page.getByTestId('chat-log')).toContainText("Everyone's in — time to vote!");
  for (const p of players) await expect(p.page.locator('[data-testid="quipgame-screen"][data-phase="voting"]')).toBeVisible();
});

test('round one: three matchups with one voter each; authors are revealed with 1000 to the winner and 0 to the loser', async () => {
  for (const p of phones()) {
    await noHorizontalOverflow(p);
    const cards = p.page.getByTestId('vote-answer');
    await expect(cards).toHaveCount(2);
    for (let i = 0; i < 2; i++) expect((await boxOf(cards.nth(i))).height, 'an answer card is at least 64px tall').toBeGreaterThanOrEqual(MIN_ANSWER_HEIGHT);
  }
  const first = await playMatchup(0, 'a', 1000, true);
  await expect(host.page.getByTestId('chat-log')).toContainText(`${first.a.name} took it 1-0 (+1000)`);
  // The other two results run their four seconds out on their own.
  await playMatchup(1, 'b', 1000, false);
  await playMatchup(2, 'a', 1000, false);
  for (const p of players) await expect(p.page.getByTestId('round-indicator')).toHaveAttribute('data-round', '2');
  await expect(host.page.getByTestId('chat-log')).toContainText('Round 2 of 3 — write your answers! Double points!');
  // Three matchups at 1000 each: the scores add up to 3000 whoever won them.
  const scores = await scoresOn(host);
  expect(scores.reduce((a, b) => a + b, 0)).toBe(3000);
});

test('round two doubles the pool: 2000 to each winner; then the final round opens with one prompt', async () => {
  await writeRound(2, 'r2-');
  await playMatchup(0, 'b', 2000, true);
  await playMatchup(1, 'a', 2000, true);
  const last = await playMatchup(2, 'b', 2000, false);
  await expect(host.page.getByTestId('chat-log')).toContainText(`${last.b.name} took it 1-0 (+2000)`);
  for (const p of players) {
    await expect(p.page.locator('[data-testid="quipgame-screen"][data-phase="finalWriting"]')).toBeVisible();
    await expect(p.page.getByTestId('round-indicator')).toHaveAttribute('data-round', '3');
    await expect(p.page.getByTestId('write-progress')).toHaveAttribute('data-total', '1');
  }
  await expect(host.page.getByTestId('chat-log')).toContainText('Final round — one prompt, everyone answers!');
  const scores = await scoresOn(host);
  expect(scores.reduce((a, b) => a + b, 0)).toBe(9000);
});

test('the final: everyone answers, ranks the other two with medals, and the result lists three answers with points', async () => {
  await writeRound(1, 'final-');
  for (const p of players) {
    const card = p.page.getByTestId('quip-final-voting');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-max-picks', '2');
    const answers = p.page.getByTestId('final-answer');
    await expect(answers).toHaveCount(3);
    const own = p.page.locator('[data-testid="final-answer"][data-own="true"]');
    await expect(own).toHaveCount(1);
    await expect(own).toBeDisabled();
    await expect(own).toContainText(`${p.name}-final-1`);
    await expect(p.page.getByTestId('final-submit')).toBeDisabled();
    const others = p.page.locator('[data-testid="final-answer"][data-own="false"]');
    await others.nth(0).click();
    await expect(others.nth(0)).toHaveAttribute('data-medal', '1');
    // Tapping a medal again takes it back; the next tap hands it out afresh.
    await others.nth(0).click();
    await expect(others.nth(0)).toHaveAttribute('data-medal', '');
    await others.nth(1).click();
    await others.nth(0).click();
    await expect(others.nth(1)).toHaveAttribute('data-medal', '1');
    await expect(others.nth(0)).toHaveAttribute('data-medal', '2');
    await expect(p.page.getByTestId('final-submit')).toBeEnabled();
  }
  for (const p of phones()) {
    await noHorizontalOverflow(p);
    expect((await boxOf(p.page.getByTestId('final-answer').first())).height).toBeGreaterThanOrEqual(MIN_ANSWER_HEIGHT);
  }
  for (const [i, p] of players.entries()) {
    await p.page.getByTestId('final-submit').click();
    if (i < players.length - 1) await expect(host.page.getByTestId('rank-count')).toHaveAttribute('data-ranked', String(i + 1));
  }

  for (const p of players) {
    const rows = p.page.getByTestId('final-row');
    await expect(rows).toHaveCount(3);
  }
  const rows = await host.page.getByTestId('final-row').evaluateAll((els) => els.map((el) => ({ rank: (el as HTMLElement).dataset.rank, name: (el as HTMLElement).dataset.authorName, points: Number((el as HTMLElement).dataset.points), medal: el.querySelector('.quip-final__medal')?.textContent ?? '' })));
  expect(rows.map((r) => r.name).sort()).toEqual(players.map((p) => p.name).sort());
  // Each voter hands out 1500 + 1000.
  expect(rows.reduce((sum, r) => sum + r.points, 0)).toBe(7500);
  expect(rows[0].rank).toBe('1');
  expect(rows[0].medal).toBe('🥇');
  expect(rows.every((r) => r.points > 0)).toBe(true);
  await expect(host.page.getByTestId('chat-log')).toContainText('Final ranking: 1.');
  await expect(host.page.getByTestId('quip-next')).toContainText('Show results');
  await host.page.getByTestId('quip-next').click();

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
