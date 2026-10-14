/**
 * Battleships' client module under test: the placement draft, the screen per phase and role
 * (and what each one must never show), the two-tap fire, the move window, the settings rows and
 * the snapshot cues. Runs in node: browser globals are stubbed, components render through
 * react-dom/server.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DEFAULT_BATTLESHIPS_SETTINGS, type BattleshipsRoomState, type BattleshipsView, type OwnBoardView, type ShipView, type TargetGridView } from '@shared/games/battleships/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { battleshipsClient } = await import('./module');
const { useBattleshipsStore } = await import('./store');
const { BattleshipsScreen, statusOf } = await import('./Screen');
const { BattleshipsSettingsFields } = await import('./SettingsFields');
const { draftFrom, layoutKey, layoutOf, layoutSoFar, placeShip, shipSpan, unplaced } = await import('./lib/placement');
const { fleetStatus, resolveTab, targetForTurn } = await import('./hooks');
const { cellDescription } = await import('./components/Board');
const { turnKicker } = await import('./lib/text');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

const NOW = Date.now();
const FLEET = [4, 3, 3, 2];

const ship = (id: string, x: number, y: number, length: number, horizontal = true, hits = 0): ShipView => ({ id, x, y, length, horizontal, hits, sunk: hits >= length });
const LAYOUT: ShipView[] = [ship('s0', 0, 0, 4), ship('s1', 0, 2, 3), ship('s2', 4, 2, 3, false), ship('s3', 5, 5, 2)];

function ownBoard(overrides: Partial<OwnBoardView> = {}): OwnBoardView {
  return { sideId: 'host', ships: LAYOUT, shots: {}, placed: true, ready: false, movable: [], ...overrides };
}

function target(sideId: string, overrides: Partial<TargetGridView> = {}): TargetGridView {
  return { sideId, shots: {}, shipsLeft: 4, shipsTotal: 4, sunkLengths: [], ...overrides };
}

function view(overrides: Partial<BattleshipsView> = {}): BattleshipsView {
  return {
    phase: 'playing',
    mode: 'solo',
    boardSize: 8,
    fleet: FLEET,
    sides: [
      { id: 'host', memberIds: ['host'], captainId: 'host', alive: true, ready: true, shipsLeft: 4 },
      { id: 'bob', memberIds: ['bob'], captainId: 'bob', alive: true, ready: true, shipsLeft: 4 },
      { id: 'carol', memberIds: ['carol'], captainId: 'carol', alive: true, ready: true, shipsLeft: 4 },
    ],
    mySideId: 'host',
    myBoard: ownBoard(),
    targets: [target('bob'), target('carol')],
    turn: { sideId: 'host', shooterId: 'host' },
    endsAt: NOW + 20_000,
    paused: false,
    dice: null,
    lastShot: null,
    log: [],
    winnerSideId: null,
    turnNumber: 1,
    ...overrides,
  };
}

/** The same game as another viewer would get it: their own board, the other sides as targets. */
function asViewer(v: BattleshipsView, me: string, board: OwnBoardView | null = ownBoard({ sideId: me })): BattleshipsView {
  return { ...v, mySideId: board ? me : null, myBoard: board, targets: v.sides.filter((s) => s.id !== (board ? me : '')).map((s) => target(s.id)) };
}

function inGame(game: BattleshipsView, overrides: Partial<BattleshipsRoomState> = {}): BattleshipsRoomState {
  return {
    ...room({ gameId: 'battleships', phase: 'playing', players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 })] }),
    settings: { allowMidGameJoin: true, contentMode: 'family', ...DEFAULT_BATTLESHIPS_SETTINGS },
    game,
    ...overrides,
  } as BattleshipsRoomState;
}

const platform = () => usePlatformStore.getState();
const store = () => useBattleshipsStore.getState();

function enter(state: BattleshipsRoomState, playerId: string): void {
  const prev = platform().playerId === playerId ? platform().room : null;
  platform().handleServerMessage(welcome(playerId, state, `tok-${playerId}`));
  battleshipsClient.onRoom?.(state, prev);
}

function snapshot(state: BattleshipsRoomState): void {
  const prev = platform().room;
  platform().handleServerMessage({ t: 'room', room: state });
  battleshipsClient.onRoom?.(state, prev);
}

function render(state: BattleshipsRoomState, meId: string): string {
  return renderToString(createElement(BattleshipsScreen, { room: state, meId, isHost: meId === 'host' }));
}

function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid=${testId}`);
  return match[0];
}

function tagsWith(html: string, testId: string): string[] {
  return html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`, 'g')) ?? [];
}

/** The markup of the board carrying `testId` (up to its closing grid). */
function boardOf(html: string, testId: string): string {
  const start = html.indexOf(`data-testid="${testId}"`);
  if (start < 0) throw new Error(`no board ${testId}`);
  const end = html.indexOf('</div></div>', start);
  return html.slice(start, end);
}

beforeEach(() => {
  resetStore();
  useBattleshipsStore.getState().reset();
  setLocation('/battleships/ABCD');
  registerGames(registryOf(battleshipsClient));
});

describe('the placement draft', () => {
  it('drops ships that fit, names the cells of a drop that does not, and knows when the fleet is complete', () => {
    const first = placeShip({}, { id: 's0', length: 4, x: 0, y: 0, horizontal: true }, 8);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const overlap = placeShip(first.draft, { id: 's1', length: 3, x: 2, y: 0, horizontal: false }, 8);
    expect(overlap).toEqual({ ok: false, cells: ['2,0', '2,1', '2,2'] });
    const edge = placeShip(first.draft, { id: 's1', length: 3, x: 6, y: 7, horizontal: true }, 8);
    expect(edge).toEqual({ ok: false, cells: ['6,7', '7,7'] });
    expect(layoutOf(first.draft, FLEET)).toBeNull();
    expect(unplaced(first.draft, FLEET).map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    // A ship may move over its own old spot.
    const moved = placeShip(first.draft, { id: 's0', length: 4, x: 1, y: 0, horizontal: true }, 8);
    expect(moved.ok).toBe(true);
    const whole = draftFrom(LAYOUT);
    expect(layoutOf(whole, FLEET)).toEqual(LAYOUT.map(({ id, x, y, horizontal }) => ({ id, x, y, horizontal })));
    expect(layoutKey(LAYOUT)).toBe(layoutKey([...LAYOUT].reverse()));
  });

  it('describes the layout so far after every drop, in ship-id order, so teammates see each ship land', () => {
    expect(layoutSoFar({}, FLEET)).toEqual([]);
    const two = draftFrom([LAYOUT[2], LAYOUT[0]]);
    expect(layoutSoFar(two, FLEET)).toEqual([
      { id: 's0', x: 0, y: 0, horizontal: true },
      { id: 's2', x: 4, y: 2, horizontal: false },
    ]);
    expect(layoutOf(two, FLEET)).toBeNull();
    // The draft is sent as soon as one ship is down: the fingerprint of the partial layout is what gets adopted.
    expect(layoutKey(layoutSoFar(two, FLEET))).toBe(layoutKey([LAYOUT[0], LAYOUT[2]]));
  });

  it('names a ship by the cells it covers', () => {
    expect(shipSpan({ x: 1, y: 1, length: 3, horizontal: true })).toBe('B2–D2');
    expect(shipSpan({ x: 4, y: 2, length: 3, horizontal: false })).toBe('E3–E5');
    expect(shipSpan({ x: 7, y: 7, length: 1, horizontal: true })).toBe('H8–H8');
  });

  it('places by tapping a tray ship then a cell, picks a placed ship up from the board, and turns it in place', () => {
    const s = store();
    s.pickShip('s0');
    s.tapCell(0, 0, 8, FLEET);
    expect(store().draft.s0).toEqual({ id: 's0', length: 4, x: 0, y: 0, horizontal: true });
    expect(store().selectedShipId).toBeNull();
    // Nothing in hand: a tap on the ship picks it up; a rotate turns it where it lies.
    store().tapCell(2, 0, 8, FLEET);
    expect(store().selectedShipId).toBe('s0');
    store().rotate(8);
    expect(store().draft.s0?.horizontal).toBe(false);
    // Off the board at the right edge: the ship stays in the tray and the cells show red.
    store().pickShip(null);
    store().pickShip('s3');
    store().rotate(8);
    expect(store().horizontal).toBe(true);
    store().tapCell(7, 6, 8, FLEET);
    expect(store().invalid).toEqual(['7,6']);
    expect(store().draft.s3).toBeUndefined();
    store().rotate(8);
    store().tapCell(7, 6, 8, FLEET);
    expect(store().draft.s3).toMatchObject({ x: 7, y: 6, horizontal: false });
    expect(store().invalid).toEqual([]);
  });

  it('adopts the server layout once (an auto-place), and leaves an echo of its own layout alone', () => {
    store().adoptLayout(LAYOUT);
    expect(Object.keys(store().draft)).toHaveLength(4);
    store().pickShip('s3');
    store().adoptLayout(LAYOUT);
    expect(store().selectedShipId).toBe('s3');
    const other = [ship('s0', 4, 4, 4), ship('s1', 0, 2, 3), ship('s2', 4, 2, 3, false), ship('s3', 5, 5, 2)];
    store().adoptLayout(other);
    expect(store().draft.s0).toMatchObject({ x: 4, y: 4 });
    expect(store().selectedShipId).toBeNull();
  });
});

describe('the screen while placing', () => {
  const placing = (board: OwnBoardView) => inGame(view({ phase: 'placing', turn: null, myBoard: board, sides: view().sides.map((s) => ({ ...s, ready: false })) }));

  it('gives the captain a tray, rotate, auto-place and a Ready that waits for the whole fleet', () => {
    const state = placing(ownBoard({ ships: [], placed: false }));
    enter(state, 'host');
    const html = render(state, 'host');
    expect(tagWith(html, 'battleships-screen')).toContain('data-phase="placing"');
    expect(tagsWith(html, 'tray-ship').map((t) => t.match(/data-length="(\d)"/)?.[1])).toEqual(['4', '3', '3', '2']);
    expect(tagWith(html, 'rotate')).toBeTruthy();
    expect(tagWith(html, 'auto-place')).toBeTruthy();
    expect(tagWith(html, 'place-ready')).toContain('disabled');
    expect(tagsWith(html, 'cell')).toHaveLength(64);
    expect(html).not.toContain('data-testid="target"');
    // Every ship on the board: the tray empties and Ready opens (the socket is closed under test, so it still reads disabled).
    store().adoptLayout(LAYOUT);
    const full = render(state, 'host');
    expect(tagsWith(full, 'tray-ship')).toHaveLength(0);
    expect(tagWith(full, 'tray-empty')).toBeTruthy();
    expect(tagsWith(full, 'board-ship')).toHaveLength(4);
    expect(tagWith(full, 'placement')).toContain('data-ships-placed="4"');
    // A rejected drop shows in red and in words.
    store().pickShip('s0');
    store().tapCell(6, 0, 8, FLEET);
    const red = render(state, 'host');
    expect(tagsWith(red, 'cell').filter((c) => c.includes('data-state="invalid"'))).toHaveLength(2);
    expect(tagWith(red, 'place-error')).toBeTruthy();
    expect(red).toContain('G1, H1');
  });

  it('shows a teammate the captain\'s layout live without any controls, and the whole room who is ready', () => {
    const teams = inGame(
      view({
        phase: 'placing',
        mode: 'teams',
        turn: null,
        sides: [
          { id: 'A', memberIds: ['host', 'carol'], captainId: 'host', alive: true, ready: false, shipsLeft: 0 },
          { id: 'B', memberIds: ['bob'], captainId: 'bob', alive: true, ready: true, shipsLeft: 4 },
        ],
        mySideId: 'A',
        myBoard: ownBoard({ sideId: 'A', ships: LAYOUT.slice(0, 2) }),
        targets: [target('B')],
      }),
    );
    enter(teams, 'carol');
    const html = render(teams, 'carol');
    expect(tagWith(html, 'placement')).toContain('data-state="watching"');
    expect(html).not.toContain('data-testid="tray"');
    expect(html).not.toContain('data-testid="place-ready"');
    expect(tagsWith(html, 'board-ship')).toHaveLength(2);
    expect(html).toContain('host is placing your team');
    expect(tagWith(html, 'ready-count')).toContain('data-ready="1"');
    expect(tagsWith(html, 'team')).toHaveLength(2);
    expect(statusOf(teams, teams.game as BattleshipsView, 'carol', false).text).toBe("host is placing your team's ships.");
    expect(battleshipsClient.playerBadge?.(teams, player('host'))).not.toBeNull();
    expect(battleshipsClient.playerBadge?.(teams, player('carol'))).toBeNull();
  });
});

describe('the screen while playing', () => {
  it('shows my fleet with my ships, a tab per opponent, and never a ship on a target grid', () => {
    const state = inGame(view({ myBoard: ownBoard({ shots: { '0,0': 'hit', '5,0': 'miss' } }), targets: [target('bob', { shots: { '3,3': 'hit' } }), target('carol')] }));
    enter(state, 'host');
    const mine = render(state, 'host');
    expect(tagsWith(mine, 'tab').map((t) => t.match(/data-side="(\w+)"/)?.[1])).toEqual(['mine', 'bob', 'carol']);
    // My turn opens the first target; back on my own fleet the ships show with their damage.
    expect(tagWith(mine, 'target')).toContain('data-side="bob"');
    expect(tagWith(mine, 'target')).toContain('data-can-fire="true"');
    expect(boardOf(mine, 'target-board')).not.toContain('data-ship');
    store().selectTab(null);
    const own = render(state, 'host');
    expect(tagWith(own, 'own-fleet')).toBeTruthy();
    const ownCells = tagsWith(boardOf(own, 'own-board'), 'cell');
    expect(ownCells.filter((c) => c.includes('data-ship=')).length).toBe(12);
    expect(ownCells.find((c) => c.includes('data-x="0" data-y="0"'))).toContain('data-mark="hit"');
    expect(tagsWith(own, 'board-ship')).toHaveLength(4);
  });

  it('fires in two taps: the first aims (Fire wakes up), the aim is forgotten when the turn moves on', () => {
    const state = inGame(view());
    enter(state, 'host');
    expect(store().tab).toBe('bob');
    expect(tagWith(render(state, 'host'), 'fire')).toContain('disabled');
    store().setAim({ sideId: 'bob', x: 2, y: 3 });
    const aimed = render(state, 'host');
    expect(tagWith(aimed, 'aim')).toContain('data-cell="C4"');
    expect(tagsWith(aimed, 'cell').find((c) => c.includes('data-state="aimed"'))).toContain('data-x="2" data-y="3"');
    snapshot(inGame(view({ turn: { sideId: 'bob', shooterId: 'bob' }, turnNumber: 2, dice: 2, lastShot: { shooterId: 'host', targetId: 'bob', x: 2, y: 3, result: 'miss', length: null, dice: 2, auto: false } })));
    expect(store().aim).toBeNull();
    const theirs = render(platform().room as BattleshipsRoomState, 'host');
    expect(tagWith(theirs, 'target')).toContain('data-can-fire="false"');
    expect(theirs).not.toContain('data-testid="fire"');
    expect(tagWith(theirs, 'dice')).toContain('data-value="2"');
    // A roll of 1-4 shows in the dice pill and the log only: no toast over the clock as the next turn starts.
    expect(platform().toasts).toEqual([]);
  });

  it('lays the board out as rows of cells that say what they hold, and ties each tab to its panel', () => {
    const state = inGame(view({ myBoard: ownBoard({ shots: { '0,0': 'hit', '5,0': 'miss' } }) }));
    enter(state, 'host');
    store().selectTab(null);
    const html = render(state, 'host');
    const board = boardOf(html, 'own-board');
    expect(tagsWith(board, 'board-row')).toHaveLength(8);
    expect(tagsWith(board, 'board-row')[0]).toContain('role="row"');
    expect(tagsWith(board, 'cell').filter((c) => c.includes('role="gridcell"'))).toHaveLength(64);
    expect(tagsWith(board, 'cell').find((c) => c.includes('data-x="0" data-y="0"'))).toContain('aria-label="A1, your 4-ship, hit"');
    expect(tagsWith(board, 'cell').find((c) => c.includes('data-x="5" data-y="0"'))).toContain('aria-label="F1, miss"');
    expect(tagsWith(board, 'cell').find((c) => c.includes('data-x="4" data-y="3"'))).toContain('aria-label="E4, your 3-ship"');
    expect(cellDescription(2, 3, undefined, undefined)).toBe('C4');
    // The row number is a hidden span inside the first cell, not text a screen reader reads out.
    expect(board).toContain('<span class="bs-cell__row" aria-hidden="true">1</span>');
    expect(board).not.toContain('data-row-label');
    expect(tagWith(html, 'tabpanel')).toContain('role="tabpanel" id="bs-panel-mine" aria-labelledby="bs-tab-mine"');
    expect(tagsWith(html, 'tab')[0]).toContain('id="bs-tab-mine" aria-controls="bs-panel-mine" aria-selected="true"');
    expect(tagsWith(html, 'tab')[1]).toContain('id="bs-tab-bob" aria-controls="bs-panel-bob" aria-selected="false"');
    expect(tagWith(html, 'tab-strip')).toContain('role="tablist"');
    expect(turnKicker('playing', 28, false, true)).toBe('Shot 28');
    expect(turnKicker('playing', 28, true, true)).toBe('#28');
    expect(turnKicker('placing', 1, true, true)).toBe('Placing');
    expect(turnKicker('placing', 1, false, false)).toBe('Placing fleets');
  });

  it('opens the move window for the shooter only, and tells everyone else a ship may be moving', () => {
    const moving = view({ phase: 'moving', dice: 6, endsAt: NOW + 12_000, myBoard: ownBoard({ movable: [{ id: 's0', forward: true, back: false }, { id: 's3', forward: true, back: true }] }), lastShot: { shooterId: 'host', targetId: 'bob', x: 1, y: 1, result: 'hit', length: null, dice: 6, auto: false }, turnNumber: 2 });
    enter(inGame(view()), 'host');
    snapshot(inGame(moving));
    expect(store().tab).toBeNull();
    // The shooter's own panel says it; everyone else gets the toast.
    expect(platform().toasts).toEqual([]);
    const html = render(inGame(moving), 'host');
    expect(tagWith(html, 'move-panel')).toBeTruthy();
    expect(tagsWith(html, 'move-row').map((r) => r.match(/data-ship-id="(\w+)"/)?.[1])).toEqual(['s0', 's3']);
    expect(tagsWith(html, 'move-back')[0]).toContain('disabled');
    expect(tagWith(html, 'skip-move')).toBeTruthy();
    expect(html).not.toContain('data-testid="move-notice"');
    // Each row names its ship by the cells it covers, and the panel sits under the own board, never above the tabs.
    expect(html).toContain('A1–D1');
    expect(html).toContain('F6–G6');
    expect(tagsWith(html, 'move-back')[0]).toContain('aria-label="Move A1–D1 left"');
    expect(html.indexOf('data-testid="own-board"')).toBeLessThan(html.indexOf('data-testid="move-panel"'));
    expect(html.indexOf('data-testid="tabs"')).toBeLessThan(html.indexOf('data-testid="own-board"'));
    // Pointing at a row lights that hull on the board.
    store().setHighlight('s3');
    const lit = render(inGame(moving), 'host');
    expect(tagsWith(lit, 'board-ship').find((t) => t.includes('data-ship-id="s3"'))).toContain('data-selected="true"');
    expect(tagsWith(lit, 'board-ship').find((t) => t.includes('data-ship-id="s0"'))).not.toContain('data-selected');
    store().setHighlight(null);
    enter(inGame(asViewer(view(), 'bob')), 'bob');
    snapshot(inGame(asViewer(moving, 'bob')));
    expect(platform().toasts.map((t) => t.text)).toEqual(['host rolled a 6 — a ship may slip away!']);
    const bobs = render(inGame(asViewer(moving, 'bob')), 'bob');
    expect(tagWith(bobs, 'move-notice')).toBeTruthy();
    // The dots stay on the sentence's line: one span holds both, the clock follows.
    expect(bobs).toMatch(/<span>host rolled a 6 and may be moving a ship<span class="ellipsis" aria-hidden="true"><\/span><\/span>/);
    expect(bobs).not.toContain('data-testid="move-panel"');
    expect(bobs).not.toContain('data-testid="move-row"');
  });

  it('opens the window even when nothing can move: the shooter sees why, the room only the usual line', () => {
    const boxed = view({ phase: 'moving', dice: 5, endsAt: NOW + 12_000, myBoard: ownBoard({ movable: [] }), lastShot: { shooterId: 'host', targetId: 'bob', x: 1, y: 1, result: 'miss', length: null, dice: 5, auto: false }, turnNumber: 2 });
    enter(inGame(view()), 'host');
    snapshot(inGame(boxed));
    expect(platform().toasts).toEqual([]);
    const html = render(inGame(boxed), 'host');
    expect(tagWith(html, 'move-panel')).toContain('data-movable="0"');
    expect(tagsWith(html, 'move-row')).toHaveLength(0);
    expect(html).toContain('No ship can move');
    expect(html).toContain('Carry on');
    expect(statusOf(inGame(boxed), boxed, 'host', false).kicker).toBe('You rolled a 5');
    const bobs = render(inGame(asViewer(boxed, 'bob')), 'bob');
    expect(tagWith(bobs, 'move-notice')).toBeTruthy();
    expect(bobs).not.toContain('No ship can move');
  });

  it('marks a sunk fleet: the banner, the crossed tab, the badge and a warning toast', () => {
    enter(inGame(view()), 'bob');
    const sunk = view({ sides: view().sides.map((s) => (s.id === 'bob' ? { ...s, alive: false, shipsLeft: 0 } : s)), turnNumber: 9 });
    snapshot(inGame(asViewer(sunk, 'bob', ownBoard({ sideId: 'bob', ships: LAYOUT.map((s) => ship(s.id, s.x, s.y, s.length, s.horizontal, s.length)) }))));
    expect(platform().toasts.map((t) => t.text)).toContain('Your fleet is sunk — you can watch the rest of the battle.');
    const html = render(platform().room as BattleshipsRoomState, 'bob');
    expect(tagWith(html, 'eliminated-banner')).toBeTruthy();
    expect(battleshipsClient.playerClassName?.(platform().room as BattleshipsRoomState, player('bob'))).toBe('player--sunk');
    const hosts = render(inGame(sunk), 'host');
    expect(tagsWith(hosts, 'tab').find((t) => t.includes('data-side="bob"'))).toContain('data-alive="false"');
  });

  it('gives a spectator every grid and no own fleet, and the log its shots', () => {
    const shots = view({
      log: [
        { shooterId: 'host', targetId: 'bob', x: 0, y: 0, result: 'hit', length: null, dice: 1, auto: false },
        { shooterId: 'bob', targetId: 'host', x: 1, y: 1, result: 'sunk', length: 2, dice: null, auto: true },
      ],
      turnNumber: 3,
    });
    const state = inGame(asViewer(shots, 'dave', null), { players: [player('host'), player('bob', { joinOrder: 1 }), player('carol', { joinOrder: 2 }), player('dave', { joinOrder: 3, participating: false })] });
    enter(state, 'dave');
    const html = render(state, 'dave');
    expect(tagsWith(html, 'tab').map((t) => t.match(/data-side="(\w+)"/)?.[1])).toEqual(['host', 'bob', 'carol']);
    expect(html).not.toContain('data-testid="own-fleet"');
    expect(html).not.toContain('data-ship=');
    expect(tagWith(html, 'target')).toContain('data-side="host"');
    expect(tagsWith(html, 'shot-log-entry').map((e) => e.match(/data-result="(\w+)"/)?.[1])).toEqual(['sunk', 'hit']);
    expect(html).toContain('B2: sunk a 2-ship!');
    expect(battleshipsClient.chatPlaceholder?.(state, 'dave')).toContain('Watching');
    expect(battleshipsClient.chatPlaceholder?.(inGame(view()), 'host')).toContain('Call your shot');
  });

  it('knows which grid to open: the chosen target while afloat, else the first one, else my own fleet', () => {
    const v = view();
    expect(resolveTab(v, null)).toBeNull();
    expect(resolveTab(v, 'carol')).toBe('carol');
    expect(resolveTab(v, 'nobody')).toBeNull();
    expect(resolveTab({ ...v, myBoard: null, mySideId: null }, null)).toBe('bob');
    const bobOut = { ...v, sides: v.sides.map((s) => (s.id === 'bob' ? { ...s, alive: false } : s)) };
    expect(targetForTurn(bobOut, 'bob')).toBe('carol');
    expect(targetForTurn(v, 'carol')).toBe('carol');
    expect(fleetStatus([4, 3, 3, 2], [3])).toEqual([
      { length: 4, sunk: false },
      { length: 3, sunk: true },
      { length: 3, sunk: false },
      { length: 2, sunk: false },
    ]);
  });

  it('freezes the clock and says so while the platform holds the game', () => {
    const held: BattleshipsRoomState = { ...inGame(view()), waiting: { reason: 'players', missing: ['bob'], needed: 2, connected: 2 } };
    store().selectTab('bob');
    const html = render(held, 'host');
    expect(tagWith(html, 'timer')).toContain('data-paused="players"');
    expect(tagWith(html, 'status')).toContain('data-kicker="Paused"');
    expect(tagWith(html, 'target')).toContain('data-can-fire="false"');
  });
});

describe('settings rows', () => {
  it('renders the choices, the sliders and the dice toggle for the host, read-only values otherwise', () => {
    const settings = { allowMidGameJoin: true, contentMode: 'family' as const, ...DEFAULT_BATTLESHIPS_SETTINGS };
    const host = renderToString(createElement(BattleshipsSettingsFields, { settings, canEdit: true, patch: () => undefined }));
    expect(tagWith(host, 'settings-mode')).toContain('data-value="solo"');
    expect(tagWith(host, 'settings-mode-teams')).toContain('aria-checked="false"');
    expect(tagWith(host, 'settings-boardSize-10')).toBeTruthy();
    expect(tagWith(host, 'settings-fleet-classic')).toBeTruthy();
    expect(tagWith(host, 'settings-placeSeconds')).toContain('max="120"');
    expect(tagWith(host, 'settings-turnSeconds')).toContain('min="10"');
    expect(tagWith(host, 'settings-diceMoves')).toContain('checked');
    const guest = renderToString(createElement(BattleshipsSettingsFields, { settings, canEdit: false, patch: () => undefined }));
    expect(guest).not.toContain('data-testid="settings-mode"');
    expect(guest).not.toContain('data-testid="settings-placeSeconds"');
    expect(tagWith(guest, 'settings-value-mode')).toBeTruthy();
    expect(guest).toContain('Every player for themselves');
    expect(guest).toContain('8 × 8');
    expect(guest).toContain('60s');
    expect(tagWith(guest, 'settings-diceMoves')).toContain('disabled');
  });
});
