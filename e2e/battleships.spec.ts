import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createParty, joinByCode, readyAll } from './party';

/**
 * A whole solo Battleships on the classic 10x10 board between a desktop host and two phones
 * (390x844, touch) with move or fire on: the lobby settings, the host placing ships by hand (tray,
 * rotate, a rejected spot in red) while the phones auto-place, then turns that open with a die
 * everyone sees and a choice of Fire or Move. Shots use the two-tap Fire (hits, a miss, sinks);
 * one turn secretly moves a ship with the arrows and a ghost, and the next turn of that player
 * cannot move again. Then an eliminated fleet and the podium. The tab strip must keep its height
 * on a phone whatever else the column holds (the choice, the fire row, the move controls), and a
 * phone on its side must show the whole grid. Opponents' ships never reach another page. Board
 * sizes for team crews and their extra ships are covered by the unit tests.
 * Serial: the tests build on each other.
 */
test.describe.configure({ mode: 'serial' });

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const SIZE = 10;
const MIN_TARGET = 44;
const MIN_CELL = 36;

interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Uncaught exceptions and console errors, checked at the end. */
  errors: string[];
}

interface Cell {
  x: number;
  y: number;
}

const players: Player[] = [];
let host: Player;
let pia: Player;
let quinn: Player;
let roomCode = '';
/** The host's expected score, from the shots the test fires for them. */
let hostScore = 0;
let movesMade = 0;

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

function screen(p: Player): Locator {
  return p.page.getByTestId('battleships-screen');
}

function tabOf(p: Player, name: string): Locator {
  return p.page.locator('[data-testid="tab"]', { hasText: name });
}

function ownCell(p: Player, { x, y }: Cell): Locator {
  return p.page.locator(`[data-testid="own-board"] [data-testid="cell"][data-x="${x}"][data-y="${y}"]`);
}

/** The own board after opening its tab (a turn coming round opens a target instead). */
async function ownCellShown(p: Player, cell: Cell): Promise<Locator> {
  await p.page.locator('[data-testid="tab"][data-side="mine"]').click();
  return ownCell(p, cell);
}

function targetCell(p: Player, { x, y }: Cell): Locator {
  return p.page.locator(`[data-testid="target-board"] [data-testid="cell"][data-x="${x}"][data-y="${y}"]`);
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box;
}

async function noHorizontalOverflow(p: Player): Promise<void> {
  await expect.poll(() => p.page.evaluate(() => document.documentElement.scrollWidth), { message: `${p.name}: document.scrollWidth` }).toBeLessThanOrEqual(PORTRAIT.width);
}

async function isTarget(locator: Locator, what: string): Promise<void> {
  const box = await boxOf(locator);
  expect(box.height, `${what} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(box.width, `${what} is a 44px target`).toBeGreaterThanOrEqual(MIN_TARGET);
}

/** The tab strip keeps its full height however tall the column is (it used to squash to a 2px sliver when the column overflowed). */
async function tabsKeepHeight(p: Player, when: string): Promise<void> {
  const tabs = await boxOf(p.page.getByTestId('tabs'));
  expect(tabs.height, `${p.name}: the tab strip is 44px tall ${when}`).toBeGreaterThanOrEqual(MIN_TARGET);
  await isTarget(p.page.getByTestId('tab').first(), `a tab ${when}`);
}

/** The element is wholly inside the viewport: on screen without scrolling. */
async function onScreen(p: Player, locator: Locator, what: string, viewport: { width: number; height: number }): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await boxOf(locator);
  expect(box.y, `${p.name}: ${what} starts on screen`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${p.name}: ${what} ends on screen (${Math.round(box.y + box.height)} of ${viewport.height})`).toBeLessThanOrEqual(viewport.height + 0.5);
  expect(box.x + box.width, `${p.name}: ${what} ends on screen (x)`).toBeLessThanOrEqual(viewport.width + 0.5);
}

/**
 * Cells of `p`'s own ships, read from their own page: the only place those positions may appear.
 * Afloat: neither shot nor a damaged segment that moved off its shot square.
 */
async function fleetCells(p: Player, onlyAfloat = true): Promise<Cell[]> {
  await p.page.locator('[data-testid="tab"][data-side="mine"]').click();
  const selector = onlyAfloat ? '[data-testid="own-board"] [data-testid="cell"][data-ship]:not([data-mark]):not([data-damaged])' : '[data-testid="own-board"] [data-testid="cell"][data-ship]';
  return p.page.locator(selector).evaluateAll((els) => els.map((el) => ({ x: Number(el.getAttribute('data-x')), y: Number(el.getAttribute('data-y')) })));
}

/** Nobody but the owner ever sees a ship: no ship cell or hull on any other page's grids. */
async function shipsStaySecret(): Promise<void> {
  for (const p of players) {
    await expect(p.page.locator('[data-testid="target-board"] [data-ship]')).toHaveCount(0);
    await expect(p.page.locator('[data-testid="target"] [data-testid="board-ship"]')).toHaveCount(0);
  }
}

/** The player whose turn it is right now. */
async function shooter(): Promise<Player> {
  let found: Player | null = null;
  await expect
    .poll(
      async () => {
        for (const p of players) {
          if ((await screen(p).getAttribute('data-my-turn')) === 'true') {
            found = p;
            return p.name;
          }
        }
        return null;
      },
      { message: 'somebody is up' },
    )
    .not.toBeNull();
  if (!found) throw new Error('no shooter');
  return found;
}

/** Under move or fire a turn opens on the choice: the die lands, then Fire opens the aim. */
async function chooseFire(s: Player): Promise<void> {
  if ((await screen(s).getAttribute('data-turn-mode')) === 'choose') {
    await expect(s.page.getByTestId('turn-choice')).toBeVisible();
    await s.page.getByTestId('choose-fire').click();
  }
  await expect(screen(s)).toHaveAttribute('data-turn-mode', 'fire');
}

/** `s` fires at `cell` on `t`'s grid with the two taps and returns what the grid shows for it. */
async function fireAt(s: Player, t: Player, cell: Cell): Promise<string> {
  const before = Number(await screen(s).getAttribute('data-turn-number'));
  await chooseFire(s);
  await tabOf(s, t.name).click();
  const target = targetCell(s, cell);
  await target.click();
  await expect(target).toHaveAttribute('data-state', 'aimed');
  await expect(s.page.getByTestId('fire')).toBeEnabled();
  await s.page.getByTestId('fire').click();
  await expect(screen(s)).toHaveAttribute('data-turn-number', String(before + 1));
  if ((await screen(s).getAttribute('data-phase')) !== 'gameOver') await tabOf(s, t.name).click();
  const mark = (await targetCell(s, cell).getAttribute('data-mark')) ?? '';
  expect(['miss', 'hit', 'sunk']).toContain(mark);
  if (s === host) hostScore += mark === 'hit' ? 10 : mark === 'sunk' ? 40 : 0;
  return mark;
}

/** Whoever is up fires at the next afloat cell of the fleet the test wants sunk; returns the shooter and the result. */
async function nextShot(pick: (s: Player) => Player): Promise<{ s: Player; t: Player; mark: string }> {
  const s = await shooter();
  const t = pick(s);
  const [cell] = await fleetCells(t);
  if (!cell) throw new Error(`${t.name} has no ship cell left to hit`);
  const mark = await fireAt(s, t, cell);
  return { s, t, mark };
}

test.beforeAll(async ({ browser }) => {
  host = await newPlayer(browser, 'Hana');
  pia = await newPlayer(browser, 'Pia', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  quinn = await newPlayer(browser, 'Quinn', { viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
});

test.afterAll(async () => {
  for (const p of players) await p.context.close();
});

test('the host creates a Battleships party, two phones join by code and the host tunes the settings', async () => {
  roomCode = await createParty(host.page, host.name, 'battleships');
  await expect(host.page.getByTestId('game-picker-meta')).toContainText('Battleships');
  await expect(host.page.getByTestId('game-picker').locator('[data-testid="game-tile"][data-game="battleships"]')).toHaveAttribute('aria-checked', 'true');
  for (const p of phones()) await joinByCode(p.page, p.name, roomCode);
  await expect(host.page.getByTestId('player-item')).toHaveCount(3);

  // The choices are the host's; everyone reads the chosen one.
  await host.page.getByTestId('settings-mode-teams').click();
  await expect(pia.page.getByTestId('settings-value-mode')).toHaveText('Two teams');
  await host.page.getByTestId('settings-mode-solo').click();
  await expect(pia.page.getByTestId('settings-value-mode')).toHaveText('Every player for themselves');
  await expect(pia.page.getByTestId('settings-mode')).toHaveCount(0);
  await host.page.getByTestId('settings-placeSeconds').fill('120');
  await host.page.getByTestId('settings-turnSeconds').fill('60');
  // The board is always the classic 10x10: no size to pick. The fleet starts classic; this game plays the small one.
  await expect(host.page.locator('[data-testid^="settings-boardSize"]')).toHaveCount(0);
  await expect(pia.page.getByTestId('settings-value-fleet')).toHaveText('Classic');
  await host.page.getByTestId('settings-fleet-small').click();
  await expect(pia.page.getByTestId('settings-value-placeSeconds')).toHaveText('120s');
  await expect(pia.page.getByTestId('settings-value-turnSeconds')).toHaveText('60s');
  await expect(pia.page.getByTestId('settings-value-fleet')).toHaveText('Small');
  await expect(pia.page.getByTestId('settings-moveOrFire')).toBeChecked();
  await expect(pia.page.getByTestId('settings-moveOrFire')).toBeDisabled();
  await expect(host.page.getByTestId('settings-moveOrFire')).toBeEnabled();
  await noHorizontalOverflow(pia);

  await expect(host.page.getByTestId('start-game')).toBeDisabled();
  await readyAll([pia.page, quinn.page]);
  await host.page.getByTestId('start-game').click();
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'placing');
    await expect(p.page.getByTestId('placement')).toHaveAttribute('data-state', 'placing');
    await expect(p.page.getByTestId('timer')).toBeVisible();
  }
  await expect(host.page.getByTestId('chat-log')).toContainText('Place your ships! You have 120 seconds.');
});

test('the host places ships by hand: tray, a tap per ship, rotate, a rejected spot in red; the phones auto-place', async () => {
  const tray = host.page.getByTestId('tray-ship');
  await expect(tray).toHaveCount(4);
  await expect(host.page.getByTestId('place-ready')).toBeDisabled();
  await expect(host.page.getByTestId('cell')).toHaveCount(SIZE * SIZE);
  await expect(host.page.getByTestId('board-row')).toHaveCount(SIZE);

  // The 4-ship across the top row.
  await host.page.locator('[data-testid="tray-ship"][data-ship-id="s0"]').click();
  await expect(host.page.getByTestId('place-hint')).toContainText('4-ship (across)');
  await ownCell(host, { x: 0, y: 0 }).click();
  await expect(host.page.locator('[data-testid="board-ship"][data-ship-id="s0"]')).toBeVisible();
  await expect(tray).toHaveCount(3);
  for (const x of [0, 1, 2, 3]) await expect(ownCell(host, { x, y: 0 })).toHaveAttribute('data-ship', 's0');
  await expect(ownCell(host, { x: 0, y: 0 })).toHaveAttribute('aria-label', 'A1, your 4-ship');
  // A 3-ship down the first column, another down the third.
  await host.page.locator('[data-testid="tray-ship"][data-ship-id="s1"]').click();
  await host.page.getByTestId('rotate').click();
  await expect(host.page.getByTestId('place-hint')).toContainText('3-ship (down)');
  await ownCell(host, { x: 0, y: 2 }).click();
  for (const y of [2, 3, 4]) await expect(ownCell(host, { x: 0, y })).toHaveAttribute('data-ship', 's1');
  await host.page.locator('[data-testid="tray-ship"][data-ship-id="s2"]').click();
  await ownCell(host, { x: 2, y: 2 }).click();
  await expect(ownCell(host, { x: 2, y: 4 })).toHaveAttribute('data-ship', 's2');
  // The 2-ship across from the last column does not fit: red, and still in the tray.
  await host.page.locator('[data-testid="tray-ship"][data-ship-id="s3"]').click();
  await host.page.getByTestId('rotate').click();
  await ownCell(host, { x: SIZE - 1, y: SIZE - 1 }).click();
  await expect(host.page.getByTestId('place-error')).toContainText('does not fit');
  await expect(ownCell(host, { x: SIZE - 1, y: SIZE - 1 })).toHaveAttribute('data-state', 'invalid');
  await expect(tray).toHaveCount(1);
  // Over another ship: red on the overlapping cells too.
  await ownCell(host, { x: 1, y: 0 }).click();
  await expect(host.page.locator('[data-testid="cell"][data-state="invalid"]')).toHaveCount(2);
  await ownCell(host, { x: SIZE - 2, y: SIZE - 1 }).click();
  await expect(tray).toHaveCount(0);
  await expect(host.page.getByTestId('tray-empty')).toBeVisible();
  await expect(host.page.getByTestId('place-error')).toHaveCount(0);
  await expect(host.page.getByTestId('placement')).toHaveAttribute('data-ships-placed', '4');
  await expect(host.page.getByTestId('place-ready')).toBeEnabled();
  await host.page.getByTestId('place-ready').click();
  await expect(host.page.getByTestId('placement')).toHaveAttribute('data-state', 'ready');
  await expect(host.page.getByTestId('chat-log')).toContainText(`${host.name}'s fleet is in position.`);
  for (const p of players) await expect(p.page.getByTestId('ready-count')).toHaveAttribute('data-ready', '1');

  // The phones: 36px cells, 44px controls (the tab strip among them, though the column overflows), auto-place and Ready.
  for (const p of phones()) {
    await expect(screen(p)).toHaveClass(/bs--phone/);
    await noHorizontalOverflow(p);
    const cell = await boxOf(ownCell(p, { x: SIZE - 1, y: SIZE - 1 }));
    expect(cell.width, 'a grid cell is at least 36px wide').toBeGreaterThanOrEqual(MIN_CELL);
    expect(cell.height, 'a grid cell is at least 36px tall').toBeGreaterThanOrEqual(MIN_CELL);
    for (const id of ['rotate', 'auto-place', 'place-ready']) await isTarget(p.page.getByTestId(id), id);
    await isTarget(p.page.getByTestId('tray-ship').first(), 'a tray ship');
    await tabsKeepHeight(p, 'while placing a 10x10 board');
    await p.page.getByTestId('auto-place').click();
    await expect(p.page.getByTestId('board-ship')).toHaveCount(4);
    await expect(p.page.getByTestId('tray-ship')).toHaveCount(0);
    await expect(p.page.getByTestId('place-ready')).toBeEnabled();
  }
  await pia.page.getByTestId('place-ready').click();
  for (const p of players) await expect(p.page.getByTestId('ready-count')).toHaveAttribute('data-ready', '2');
  await quinn.page.getByTestId('place-ready').click();
  for (const p of players) {
    await expect(screen(p)).toHaveAttribute('data-phase', 'playing');
    await expect(screen(p)).toHaveAttribute('data-turn-number', '1');
  }
  await expect(host.page.getByTestId('chat-log')).toContainText('All fleets are in position. Fire at will!');
});

test('the host fires first: the die everyone sees, Fire or Move, two taps and a hit', async () => {
  // Join order: the host is up; the phones wait. Nobody sees a ship on an enemy grid.
  await expect(screen(host)).toHaveAttribute('data-my-turn', 'true');
  await expect(host.page.getByTestId('status')).toHaveAttribute('data-kicker', 'Your turn');
  for (const p of phones()) {
    await expect(screen(p)).not.toHaveAttribute('data-my-turn', /.+/);
    await expect(p.page.getByTestId('status')).toHaveAttribute('data-kicker', host.name);
    await expect(p.page.getByTestId('fire')).toHaveCount(0);
    await expect(p.page.getByTestId('turn-choice')).toHaveCount(0);
  }
  await expect(host.page.getByTestId('tab')).toHaveCount(3);
  await expect(host.page.locator(`[data-testid="player-item"][data-name="${host.name}"]`)).toHaveClass(/player--shooter/);
  await shipsStaySecret();

  // The turn opens with one die for everyone; once it lands the host picks Fire or Move (up to the roll).
  const choice = host.page.getByTestId('turn-choice');
  await expect(choice).toBeVisible();
  await expect(host.page.getByTestId('turn-die')).not.toHaveAttribute('data-rolling', 'true');
  const roll = Number(await choice.getAttribute('data-roll'));
  expect(roll).toBeGreaterThanOrEqual(1);
  expect(roll).toBeLessThanOrEqual(6);
  await expect(host.page.getByTestId('choose-move')).toHaveText(`Move (up to ${roll})`);
  for (const p of players) await expect(p.page.getByTestId('dice')).toHaveAttribute('data-value', String(roll));
  for (const p of phones()) await expect(p.page.getByTestId('status-text')).toHaveText('is deciding…');
  // Before choosing, the grid on show is a picture.
  await expect(host.page.locator('[data-testid="target"][data-can-fire="true"]')).toHaveCount(0);
  // Fire, then Back, then Fire again: the choice comes back in between.
  await host.page.getByTestId('choose-fire').click();
  await expect(host.page.getByTestId('fire-back')).toBeVisible();
  await host.page.getByTestId('fire-back').click();
  await expect(choice).toBeVisible();
  // The host sees their own ships from the placement, with the hull drawn over the cells.
  await host.page.locator('[data-testid="tab"][data-side="mine"]').click();
  await expect(host.page.locator('[data-testid="own-fleet"] [data-testid="board-ship"]')).toHaveCount(4);

  // The first tap aims (Fire wakes up with the cell's name), the button fires.
  const [cell] = await fleetCells(pia);
  await chooseFire(host);
  await tabOf(host, pia.name).click();
  await expect(host.page.getByTestId('fire')).toBeDisabled();
  await expect(host.page.getByTestId('aim')).toContainText('Tap a cell to aim');
  const mark = await fireAt(host, pia, cell);
  expect(mark).toMatch(/hit|sunk/);
  await expect(host.page.getByTestId('chat-log')).toContainText(new RegExp(`${host.name} fires at ${pia.name} [A-J][1-9]0?: (hit!|sunk a 2-ship!)`));
  await expect(host.page.locator(`[data-testid="player-item"][data-name="${host.name}"]`)).toHaveAttribute('data-score', String(hostScore));
  // The hit shows on Pia's own board and on Quinn's grid of Pia (shots are shared by everyone).
  await expect(await ownCellShown(pia, cell)).toHaveAttribute('data-mark', mark);
  await tabOf(quinn, pia.name).click();
  await expect(targetCell(quinn, cell)).toHaveAttribute('data-mark', mark);
  await expect(quinn.page.locator('[data-testid="target"][data-can-fire="true"]')).toHaveCount(0);
  // A shot earns no toast: the grid, the chat and the log carry it.
  for (const p of players) await expect(p.page.getByTestId('toast').filter({ hasText: /moved a ship|rolled/ })).toHaveCount(0);
  await shipsStaySecret();
});

/** Ship id to its cells, read from `p`'s own board. */
async function shipLayout(p: Player): Promise<Record<string, string[]>> {
  return p.page.locator('[data-testid="own-board"] [data-testid="cell"][data-ship]').evaluateAll((els) => {
    const out: Record<string, string[]> = {};
    for (const el of els) (out[el.getAttribute('data-ship') ?? ''] ??= []).push(`${el.getAttribute('data-x')},${el.getAttribute('data-y')}`);
    return out;
  });
}

/** Every mark on `t`'s grid as `p` sees it. */
async function marksOf(p: Player, t: Player): Promise<string[]> {
  await tabOf(p, t.name).click();
  return p.page.locator('[data-testid="target-board"] [data-testid="cell"][data-mark]').evaluateAll((els) => els.map((el) => `${el.getAttribute('data-x')},${el.getAttribute('data-y')}:${el.getAttribute('data-mark')}`));
}

test('Pia moves a ship instead of firing, on her phone: tap it, step the ghost, confirm; nobody else learns which', async () => {
  const s = await shooter();
  expect(s).toBe(pia);
  await expect(pia.page.getByTestId('status')).toHaveAttribute('data-kicker', 'Your turn');
  await expect(pia.page.getByTestId('turn-die')).not.toHaveAttribute('data-rolling', 'true');
  const roll = Number(await pia.page.getByTestId('turn-choice').getAttribute('data-roll'));
  await expect(host.page.getByTestId('status')).toHaveAttribute('data-kicker', pia.name);
  await expect(host.page.getByTestId('status-text')).toHaveText('is deciding…');
  await isTarget(pia.page.getByTestId('choose-fire'), 'Fire');
  await isTarget(pia.page.getByTestId('choose-move'), 'Move');
  await tabsKeepHeight(pia, 'with the choice showing');
  await noHorizontalOverflow(pia);
  const before = await shipLayout(pia);
  const hostSees = await marksOf(host, pia);
  const quinnSees = await marksOf(quinn, pia);

  // Move: the own board comes forward with the controls under it.
  await pia.page.getByTestId('choose-move').click();
  await expect(screen(pia)).toHaveAttribute('data-turn-mode', 'move');
  await expect(pia.page.locator('[data-testid="tab"][data-side="mine"]')).toHaveAttribute('aria-selected', 'true');
  const panel = pia.page.getByTestId('move-panel');
  await expect(panel).toBeVisible();
  await expect(pia.page.getByTestId('moves-left')).toHaveText(`${roll} ${roll === 1 ? 'move' : 'moves'} left`);
  for (const id of ['move-up', 'move-down', 'move-left', 'move-right', 'move-rotate', 'move-reset', 'move-confirm']) await isTarget(pia.page.getByTestId(id), id);
  await tabsKeepHeight(pia, 'with the move controls showing');
  await noHorizontalOverflow(pia);
  await expect(pia.page.getByTestId('move-confirm')).toBeDisabled();
  await expect(pia.page.getByTestId('move-up')).toHaveAttribute('aria-disabled', 'true');

  // Try the ships one by one, each direction step by step, until the ghost may stop somewhere.
  let moved: { id: string; direction: string } | null = null;
  for (const id of Object.keys(before)) {
    await ownCell(pia, { x: Number(before[id][0].split(',')[0]), y: Number(before[id][0].split(',')[1]) }).click();
    if ((await panel.getAttribute('data-ship-id')) !== id) continue;
    await expect(pia.page.locator(`[data-testid="board-ship"][data-ship-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
    for (const direction of ['right', 'down', 'left', 'up']) {
      const arrow = pia.page.getByTestId(`move-${direction}`);
      for (let step = 1; step <= roll; step++) {
        if ((await arrow.getAttribute('aria-disabled')) === 'true') break;
        await arrow.click();
        await expect(pia.page.getByTestId('ghost-ship')).toBeVisible();
        await expect(pia.page.getByTestId('moves-left')).toHaveText(`${roll - step} ${roll - step === 1 ? 'move' : 'moves'} left`);
        if (await pia.page.getByTestId('move-confirm').isEnabled()) {
          moved = { id, direction };
          break;
        }
      }
      if (moved) break;
      if ((await pia.page.getByTestId('move-reset').getAttribute('aria-disabled')) !== 'true') await pia.page.getByTestId('move-reset').click();
      await expect(pia.page.getByTestId('ghost-ship')).toHaveCount(0);
    }
    if (moved) break;
  }
  if (!moved) throw new Error('no ship of Pia could move');
  // Off the line: the other axis says why it cannot step.
  const across = moved.direction === 'right' || moved.direction === 'left' ? 'move-up' : 'move-left';
  await expect(pia.page.getByTestId(across)).toHaveAttribute('aria-disabled', 'true');
  await pia.page.getByTestId(across).click({ force: true });
  await expect(pia.page.getByTestId('move-note')).toHaveText('A ship moves in a straight line. Reset to change direction.');
  const ghost = pia.page.getByTestId('ghost-ship');
  await expect(ghost).toHaveAttribute('data-ship-id', moved.id);
  const ghostX = Number(await ghost.getAttribute('data-x'));
  const ghostY = Number(await ghost.getAttribute('data-y'));
  await pia.page.getByTestId('move-confirm').click();
  movesMade++;

  // The turn passes; Pia's ship is where the ghost was; the room hears only that a ship moved.
  await expect(screen(pia)).not.toHaveAttribute('data-my-turn', 'true');
  await expect(ownCell(pia, { x: ghostX, y: ghostY })).toHaveAttribute('data-ship', moved.id);
  expect((await shipLayout(pia))[moved.id]).not.toEqual(before[moved.id]);
  await expect(host.page.getByTestId('chat-log')).toContainText(`${pia.name} moved a ship.`);
  for (const p of [host, quinn]) await expect(p.page.getByTestId('toast').filter({ hasText: `${pia.name} moved a ship.` })).toHaveCount(1);
  await expect(pia.page.getByTestId('toast').filter({ hasText: 'moved a ship' })).toHaveCount(0);
  expect(await marksOf(host, pia)).toEqual(hostSees);
  expect(await marksOf(quinn, pia)).toEqual(quinnSees);
  await expect(host.page.getByTestId('ghost-ship')).toHaveCount(0);
  await expect(quinn.page.getByTestId('ghost-ship')).toHaveCount(0);
  await shipsStaySecret();
});

test('Quinn and the host fire; Pia cannot move twice in a row, so she fires a miss; the shot log on a phone', async () => {
  // Quinn and then the host shoot at Pia.
  for (const expected of [quinn, host]) {
    const s = await shooter();
    expect(s).toBe(expected);
    const [cell] = await fleetCells(pia);
    await fireAt(s, pia, cell);
  }

  // Pia is up again: Move is not on offer and says why.
  const s = await shooter();
  expect(s).toBe(pia);
  await expect(pia.page.getByTestId('turn-choice')).toHaveAttribute('data-move-blocked', 'true');
  await expect(pia.page.getByTestId('choose-move')).toHaveAttribute('aria-disabled', 'true');
  await expect(pia.page.getByTestId('choose-move')).toHaveAttribute('title', 'You moved last turn. Fire this time.');
  await expect(pia.page.getByTestId('move-blocked')).toHaveText('You moved last turn. Fire this time.');
  // Still tappable (a tap must be able to say why), but it changes nothing.
  await pia.page.getByTestId('choose-move').click({ force: true });
  await expect(screen(pia)).toHaveAttribute('data-turn-mode', 'choose');

  // A miss at Quinn, on the open cell farthest from his ships.
  const quinnShips = await fleetCells(quinn, false);
  const distance = (c: Cell) => Math.min(...quinnShips.map((q) => Math.max(Math.abs(q.x - c.x), Math.abs(q.y - c.y))));
  let miss: Cell = { x: 0, y: 0 };
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (distance({ x, y }) > distance(miss)) miss = { x, y };
  expect(distance(miss)).toBeGreaterThan(0);
  await chooseFire(pia);
  await tabOf(pia, quinn.name).click();
  await isTarget(pia.page.getByTestId('fire'), 'Fire');
  await noHorizontalOverflow(pia);
  // The fire row below the board makes the column overflow: the tabs still stand at full height.
  await tabsKeepHeight(pia, 'with the fire row showing');
  // A first tap elsewhere aims: the coordinate reads large in the fire row and the cell is selected; the next tap on the miss re-aims.
  const other = { x: miss.x, y: (miss.y + 1) % SIZE };
  await targetCell(pia, other).click();
  await expect(pia.page.getByTestId('aim')).toHaveAttribute('data-cell', `${String.fromCharCode(65 + other.x)}${other.y + 1}`);
  await expect(targetCell(pia, other)).toHaveAttribute('aria-selected', 'true');
  expect(await fireAt(pia, quinn, miss)).toBe('miss');
  await expect(host.page.getByTestId('chat-log')).toContainText(new RegExp(`${pia.name} fires at ${quinn.name} [A-J][1-9]0?: miss\\.`));
  await expect(await ownCellShown(quinn, miss)).toHaveAttribute('data-mark', 'miss');
  await expect(await ownCellShown(quinn, miss)).toHaveAttribute('aria-label', /, miss$/);

  // The log on a phone: shots only (the move is not in it), newest first.
  await pia.page.getByTestId('log-toggle').click();
  const log = pia.page.getByTestId('log-sheet');
  await expect(log.getByTestId('shot-log-entry')).toHaveCount(4);
  await expect(log.getByTestId('shot-log-entry').first()).toHaveAttribute('data-result', 'miss');
  await pia.page.getByTestId('log-sheet-close').click();
  await expect(log).toHaveCount(0);
});

test('a phone on its side keeps the whole grid on screen, with the tabs and the controls beside it', async () => {
  await quinn.page.setViewportSize(LANDSCAPE);
  await expect(screen(quinn)).toHaveClass(/bs--phone/);
  await tabOf(quinn, pia.name).click();
  await onScreen(quinn, quinn.page.getByTestId('target-board'), "Pia's grid", LANDSCAPE);
  await onScreen(quinn, quinn.page.getByTestId('tabs'), 'the tab strip', LANDSCAPE);
  await onScreen(quinn, quinn.page.getByTestId('status'), 'the status line', LANDSCAPE);
  const cell = await boxOf(targetCell(quinn, { x: SIZE - 1, y: SIZE - 1 }));
  expect(cell.width, 'a landscape cell is a sensible size').toBeGreaterThanOrEqual(20);
  expect(cell.width, 'a landscape cell is not a phone-width monster').toBeLessThanOrEqual(36);
  await quinn.page.locator('[data-testid="tab"][data-side="mine"]').click();
  await onScreen(quinn, quinn.page.getByTestId('own-board'), 'the own board', LANDSCAPE);
  await expect.poll(() => quinn.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(LANDSCAPE.width);
  await quinn.page.setViewportSize(PORTRAIT);
  await expect(screen(quinn)).toHaveClass(/bs--phone/);
});

test("everyone hits until Pia's fleet is sunk: she is out and watches, the others play on", async () => {
  test.setTimeout(180_000);
  // Quinn is up: the host and Quinn shoot at Pia, Pia shoots at Quinn.
  const pick = (s: Player) => (s === pia ? quinn : pia);
  for (let i = 0; i < 40; i++) {
    await nextShot(pick);
    if ((await tabOf(host, pia.name).getAttribute('data-alive')) === 'false') break;
  }
  await expect(host.page.getByTestId('chat-log')).toContainText(`${pia.name}'s fleet is sunk. They are out!`);
  await expect(pia.page.getByTestId('eliminated-banner')).toBeVisible();
  await expect(pia.page.getByTestId('fire')).toHaveCount(0);
  await expect(pia.page.getByTestId('my-ships-left')).toHaveAttribute('data-left', '0');
  for (const p of [host, quinn]) await expect(tabOf(p, pia.name)).toHaveAttribute('data-alive', 'false');
  await expect(host.page.locator(`[data-testid="player-item"][data-name="${pia.name}"]`)).toHaveClass(/player--sunk/);
  await noHorizontalOverflow(pia);
  await shipsStaySecret();
  // Pia never gets another turn.
  const next = await shooter();
  expect(next).not.toBe(pia);
});

test("the host sinks Quinn's fleet too and wins: the podium ranks the host first with the hits, sinks and win bonus", async () => {
  test.setTimeout(180_000);
  const pick = (s: Player) => (s === host ? quinn : host);
  for (let i = 0; i < 40; i++) {
    const { s, t, mark } = await nextShot(pick);
    if (mark === 'sunk' && t === quinn && s === host && (await screen(host).getAttribute('data-phase')) === 'gameOver') break;
    if ((await screen(host).getAttribute('data-phase')) === 'gameOver') break;
  }
  await expect(screen(host)).toHaveAttribute('data-phase', 'gameOver');
  await expect(host.page.getByTestId('chat-log')).toContainText(`${host.name} wins with the last fleet afloat!`);
  for (const p of players) {
    const end = p.page.getByTestId('overlay-game-end');
    await expect(end).toBeVisible({ timeout: 15_000 });
    await expect(end.getByTestId('podium-entry')).toHaveCount(3);
    await expect(end.locator('[data-testid="podium-entry"][data-rank="1"]')).toContainText(host.name);
  }
  hostScore += 100;
  await expect(host.page.locator(`[data-testid="player-item"][data-name="${host.name}"]`)).toHaveAttribute('data-score', String(hostScore));
  await shipsStaySecret();
  await expect(host.page.getByTestId('back-to-lobby')).toBeVisible();
  await host.page.getByTestId('back-to-lobby').click();
  for (const p of players) await expect(p.page.getByTestId('room-code')).toHaveText(roomCode);
  await readyAll([pia.page, quinn.page]);
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
  expect(movesMade).toBe(1);
});

test('no page errors were raised in any browser', async () => {
  expect(players.flatMap((p) => p.errors)).toEqual([]);
});
