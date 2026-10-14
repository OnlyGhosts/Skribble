/**
 * Battleships' client module under test: the placement draft, the screen per phase and role
 * (and what each one must never show), the two-tap fire, move or fire (the die, the choice, the
 * move controls), the settings rows and the snapshot cues. Runs in node: browser globals are
 * stubbed, components render through react-dom/server.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DEFAULT_BATTLESHIPS_SETTINGS, type BattleshipsRoomState, type ShipMove, type BattleshipsView, type OwnBoardView, type ShipView, type TargetGridView } from '@shared/games/battleships/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { battleshipsClient } = await import('./module');
const { useBattleshipsStore } = await import('./store');
const { BattleshipsScreen, statusOf } = await import('./Screen');
const { BattleshipsSettingsFields } = await import('./SettingsFields');
const { draftFrom, layoutKey, layoutOf, layoutSoFar, placeShip, shipSpan, unplaced } = await import('./lib/placement');
const { fleetStatus, resolveTab, targetForTurn, turnKey } = await import('./hooks');
const { backToChoice, chooseFire, chooseMove, pickShipToMove, resetMove, stepShip, turnShip } = await import('./actions');
const { confirmProblem, moveUnavailable, movesLeft, stepGhost, turnGhost } = await import('./lib/moveDraft');
const { cellDescription } = await import('./components/Board');
const { turnKicker } = await import('./lib/text');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

const NOW = Date.now();
const FLEET = [4, 3, 3, 2];

const ship = (id: string, x: number, y: number, length: number, horizontal = true, hits = 0): ShipView => ({
  id,
  x,
  y,
  length,
  horizontal,
  damage: Array.from({ length }, (_, i) => i < hits),
  hits,
  sunk: hits >= length,
});
const LAYOUT: ShipView[] = [ship('s0', 0, 0, 4), ship('s1', 0, 2, 3), ship('s2', 4, 2, 3, false), ship('s3', 5, 5, 2)];

function ownBoard(overrides: Partial<OwnBoardView> = {}): OwnBoardView {
  return { sideId: 'host', ships: LAYOUT, shots: {}, placed: true, ready: false, plan: null, ...overrides };
}

function target(sideId: string, overrides: Partial<TargetGridView> = {}): TargetGridView {
  return { sideId, shots: {}, shipsLeft: 4, shipsTotal: 4, sunkLengths: [], ...overrides };
}

function view(overrides: Partial<BattleshipsView> = {}): BattleshipsView {
  return {
    phase: 'playing',
    mode: 'solo',
    moveOrFire: false,
    boardSize: 10,
    fleet: FLEET,
    sides: [
      { id: 'host', memberIds: ['host'], captainId: 'host', alive: true, ready: true, shipsLeft: 4, movedLastTurn: false },
      { id: 'bob', memberIds: ['bob'], captainId: 'bob', alive: true, ready: true, shipsLeft: 4, movedLastTurn: false },
      { id: 'carol', memberIds: ['carol'], captainId: 'carol', alive: true, ready: true, shipsLeft: 4, movedLastTurn: false },
    ],
    mySideId: 'host',
    myBoard: ownBoard(),
    targets: [target('bob'), target('carol')],
    turn: { sideId: 'host', shooterId: 'host', roll: null, canMove: false },
    endsAt: NOW + 20_000,
    paused: false,
    lastShot: null,
    lastAction: null,
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
    expect(tagsWith(html, 'cell')).toHaveLength(100);
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
          { id: 'A', memberIds: ['host', 'carol'], captainId: 'host', alive: true, ready: false, shipsLeft: 0, movedLastTurn: false },
          { id: 'B', memberIds: ['bob'], captainId: 'bob', alive: true, ready: true, shipsLeft: 4, movedLastTurn: false },
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
    snapshot(inGame(view({ moveOrFire: true, turn: { sideId: 'bob', shooterId: 'bob', roll: 2, canMove: true }, turnNumber: 2, lastShot: { shooterId: 'host', targetId: 'bob', x: 2, y: 3, result: 'miss', length: null, dice: null, auto: false } })));
    expect(store().aim).toBeNull();
    const theirs = render(platform().room as BattleshipsRoomState, 'host');
    expect(tagWith(theirs, 'target')).toContain('data-can-fire="false"');
    expect(theirs).not.toContain('data-testid="fire"');
    // Everyone sees the next shooter's roll; a shot earns no toast (the grid and the log carry it).
    expect(tagWith(theirs, 'dice')).toContain('data-value="2"');
    expect(platform().toasts).toEqual([]);
  });

  it('lays the board out as rows of cells that say what they hold, and ties each tab to its panel', () => {
    const state = inGame(view({ myBoard: ownBoard({ shots: { '0,0': 'hit', '5,0': 'miss' } }) }));
    enter(state, 'host');
    store().selectTab(null);
    const html = render(state, 'host');
    const board = boardOf(html, 'own-board');
    expect(tagsWith(board, 'board-row')).toHaveLength(10);
    expect(tagsWith(board, 'board-row')[0]).toContain('role="row"');
    expect(tagsWith(board, 'cell').filter((c) => c.includes('role="gridcell"'))).toHaveLength(100);
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
    expect(turnKicker('playing', 28)).toBe('Turn 28');
    expect(turnKicker('placing', 1)).toBe('Placing fleets');
  });

  it('marks a sunk fleet: the banner, the crossed tab, the badge and a warning toast', () => {
    enter(inGame(view()), 'bob');
    const sunk = view({ sides: view().sides.map((s) => (s.id === 'bob' ? { ...s, alive: false, shipsLeft: 0 } : s)), turnNumber: 9 });
    snapshot(inGame(asViewer(sunk, 'bob', ownBoard({ sideId: 'bob', ships: LAYOUT.map((s) => ship(s.id, s.x, s.y, s.length, s.horizontal, s.length)) }))));
    expect(platform().toasts.map((t) => t.text)).toContain('Your fleet is sunk. You can watch the rest of the battle.');
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

/** Move or fire on, the host up with `roll` on the die. */
function rolled(roll: number, overrides: Partial<BattleshipsView> = {}): BattleshipsView {
  return view({ moveOrFire: true, turn: { sideId: 'host', shooterId: 'host', roll, canMove: true }, ...overrides });
}

/** The die has landed and the shooter is deciding (the reveal's timers never run under react-dom/server). */
function landed(v: BattleshipsView): void {
  store().setRollStage(turnKey(v), 'deciding');
}

const shift = (direction: 'up' | 'down' | 'left' | 'right', steps: number): ShipMove => ({ kind: 'shift', direction, steps });

describe('move or fire', () => {
  it('opens the turn with the die for everyone, then Fire or Move up to the roll for the shooter only', () => {
    const v = rolled(4);
    const state = inGame(v);
    enter(state, 'host');
    expect(store().turn.mode).toBe('choose');
    expect(store().tab).toBe('bob');
    // While the die tumbles there is nothing to press and the roll is not given away.
    const tumbling = render(state, 'host');
    expect(tagWith(tumbling, 'turn-die')).toContain('data-rolling="true"');
    expect(tagWith(tumbling, 'choose-fire')).toContain('disabled');
    expect(tumbling).not.toContain('Move (up to');
    landed(v);
    const html = render(state, 'host');
    expect(tagWith(html, 'battleships-screen')).toContain('data-turn-mode="choose"');
    expect(tagWith(html, 'turn-die')).toContain('data-value="4"');
    expect(tagWith(html, 'turn-die')).not.toContain('data-rolling');
    expect(tagWith(html, 'choose-fire')).not.toContain('disabled');
    expect(tagWith(html, 'choose-move')).not.toContain('aria-disabled');
    expect(html).toContain('Move (up to 4)');
    // Nothing aims before the choice: the grid on show is a picture.
    expect(tagWith(html, 'target')).toContain('data-can-fire="false"');
    expect(statusOf(state, v, 'host', false, { mode: 'choose', stage: 'deciding' })).toEqual({ kicker: 'Your turn', text: 'You rolled a 4. Fire or move?' });
    // Everyone else: the same die in the status line, the roll, then the shooter deciding; no choice.
    const bobs = inGame(asViewer(v, 'bob'));
    const bobHtml = render(bobs, 'bob');
    expect(bobHtml).not.toContain('data-testid="turn-choice"');
    expect(tagWith(bobHtml, 'dice')).toContain('data-value="4"');
    const seen = (stage: 'rolling' | 'rolled' | 'deciding') => statusOf(bobs, bobs.game as BattleshipsView, 'bob', false, { mode: 'choose', stage });
    expect(seen('rolling')).toEqual({ kicker: 'host', text: 'is rolling the die…' });
    expect(seen('rolled')).toEqual({ kicker: 'host', text: 'rolled a 4.' });
    expect(seen('deciding')).toEqual({ kicker: 'host', text: 'is deciding…' });
  });

  it('Fire opens the two-tap aim on a live grid, with a Back to the choice', () => {
    const v = rolled(2);
    const state = inGame(v);
    enter(state, 'host');
    landed(v);
    chooseFire(targetForTurn(v, 'carol'));
    expect(store().turn.mode).toBe('fire');
    expect(store().tab).toBe('carol');
    store().setAim({ sideId: 'carol', x: 1, y: 1 });
    const html = render(state, 'host');
    expect(html).not.toContain('data-testid="turn-choice"');
    expect(tagWith(html, 'target')).toContain('data-can-fire="true"');
    expect(tagWith(html, 'fire-back')).toBeTruthy();
    backToChoice({ share: false });
    expect(store().turn.mode).toBe('choose');
    expect(store().aim).toBeNull();
    expect(tagWith(render(state, 'host'), 'turn-choice')).toBeTruthy();
    // Without move or fire there is no choice and no Back: the turn is a shot.
    const classic = inGame(view());
    enter(classic, 'host');
    const plain = render(classic, 'host');
    expect(plain).not.toContain('data-testid="turn-choice"');
    expect(plain).not.toContain('data-testid="fire-back"');
    expect(plain).not.toContain('data-testid="dice"');
    expect(tagWith(plain, 'target')).toContain('data-can-fire="true"');
  });

  it('Move brings the own board forward: tap a ship, step its ghost, turn, reset, and Confirm only where it may stop', () => {
    const shots = { '7,5': 'miss' } as const;
    const v = rolled(3, { myBoard: ownBoard({ shots }) });
    const state = inGame(v);
    enter(state, 'host');
    landed(v);
    chooseMove();
    expect(store().tab).toBeNull();
    const ctx = { ships: LAYOUT, size: 10, shots, roll: 3, share: false };
    let html = render(state, 'host');
    expect(tagWith(html, 'battleships-screen')).toContain('data-turn-mode="move"');
    expect(tagWith(html, 'move-panel')).toContain('data-moves-left="3"');
    expect(html.indexOf('data-testid="own-board"')).toBeLessThan(html.indexOf('data-testid="move-panel"'));
    expect(tagWith(html, 'move-up')).toContain('title="Tap one of your ships first."');
    expect(tagsWith(boardOf(html, 'own-board'), 'cell')[0]).not.toContain('disabled');
    // A tap on water says so; a tap on the 2-ship picks it.
    pickShipToMove(9, 9, ctx);
    expect(store().turn.note).toBe('Tap one of your ships.');
    pickShipToMove(6, 5, ctx);
    expect(store().turn.shipId).toBe('s3');
    // One step right lands on the missed square: the ghost is red and Confirm says why.
    stepShip('right', ctx);
    html = render(state, 'host');
    expect(tagWith(html, 'ghost-ship')).toContain('data-x="6" data-y="5"');
    expect(tagWith(html, 'ghost-ship')).toContain('data-blocked="true"');
    expect(tagsWith(html, 'board-ship').find((t) => t.includes('data-ship-id="s3"'))).toContain('data-selected="true"');
    expect(tagWith(html, 'move-confirm')).toContain('disabled');
    expect(tagWith(html, 'move-hint')).toBeTruthy();
    expect(html).toContain('Ships cannot stop on a square that was already shot.');
    expect(tagWith(html, 'moves-left')).toContain('data-left="2"');
    // Across the line only: up is refused with the reason in its title, and a tap on it says so.
    expect(tagWith(html, 'move-up')).toContain('aria-disabled="true"');
    expect(tagWith(html, 'move-up')).toContain('straight line');
    stepShip('up', ctx);
    expect(store().turn.note).toBe('A ship moves in a straight line. Reset to change direction.');
    // Two more steps jump the miss: a legal end with no moves left.
    stepShip('right', ctx);
    stepShip('right', ctx);
    expect(store().turn.move).toEqual(shift('right', 3));
    html = render(state, 'host');
    expect(tagWith(html, 'ghost-ship')).not.toContain('data-blocked');
    expect(tagWith(html, 'moves-left')).toContain('data-left="0"');
    expect(tagWith(html, 'move-right')).toContain('title="No moves left."');
    expect(html).toContain('Looks good. Confirm to move it.');
    expect(confirmProblem(LAYOUT, 's3', store().turn.move, 10, shots, 3)).toBeNull();
    // Turning is a whole move: not on top of a slide; after Reset it turns, and turns back.
    turnShip(ctx);
    expect(store().turn.note).toBe('Turning uses the whole move. Reset first.');
    resetMove(ctx);
    expect(store().turn.move).toBeNull();
    turnShip(ctx);
    expect(store().turn.move).toEqual({ kind: 'rotate' });
    html = render(state, 'host');
    expect(tagWith(html, 'ghost-ship')).toContain('data-horizontal="false"');
    expect(html).toContain('Undo turn');
    turnShip(ctx);
    expect(store().turn.move).toBeNull();
    // Back returns to the choice and drops the pick.
    backToChoice(ctx);
    expect(store().turn).toMatchObject({ mode: 'choose', shipId: null, move: null });
    expect(render(state, 'host')).not.toContain('data-testid="move-panel"');
  });

  it('says why Move is not on offer: moved last turn, or no ship with room', () => {
    const v = rolled(2, { turn: { sideId: 'host', shooterId: 'host', roll: 2, canMove: false }, sides: view().sides.map((s) => (s.id === 'host' ? { ...s, movedLastTurn: true } : s)) });
    const state = inGame(v);
    enter(state, 'host');
    landed(v);
    const html = render(state, 'host');
    expect(tagWith(html, 'choose-move')).toContain('aria-disabled="true"');
    expect(tagWith(html, 'choose-move')).toContain('title="You moved last turn. Fire this time."');
    expect(tagWith(html, 'move-blocked')).toBeTruthy();
    expect(html).toContain('You moved last turn. Fire this time.');
    expect(tagWith(html, 'choose-fire')).not.toContain('disabled');
    // A 2-ship boxed into the corner by shots has nowhere to stop.
    const boxed = [ship('s0', 0, 0, 2)];
    const around = { '2,0': 'miss', '3,0': 'miss', '0,1': 'miss', '1,1': 'miss' } as const;
    expect(moveUnavailable(true, false, boxed, 10, around, 1)).toBe('None of your ships has room to move.');
    expect(moveUnavailable(true, false, boxed, 10, around, 3)).toBeNull();
    expect(moveUnavailable(false, false, boxed, 10, {}, 3)).toBe('Moving is off in this game.');
  });

  it('steps a ghost square by square: back towards the start, never off the board, never past the roll', () => {
    const s1 = ship('s1', 0, 2, 3);
    expect(stepGhost(s1, null, 'left', 3, 10)).toEqual({ ok: false, reason: 'That is off the board.' });
    expect(stepGhost(s1, null, 'right', 3, 10)).toEqual({ ok: true, move: shift('right', 1) });
    expect(stepGhost(s1, shift('right', 1), 'left', 3, 10)).toEqual({ ok: true, move: null });
    expect(stepGhost(s1, shift('right', 2), 'left', 3, 10)).toEqual({ ok: true, move: shift('right', 1) });
    expect(stepGhost(s1, shift('right', 3), 'right', 3, 10)).toEqual({ ok: false, reason: 'No moves left.' });
    expect(stepGhost(s1, { kind: 'rotate' }, 'up', 3, 10).ok).toBe(false);
    expect(stepGhost(ship('s0', 7, 0, 3), null, 'right', 6, 10)).toEqual({ ok: false, reason: 'That is off the board.' });
    expect(movesLeft(null, 5)).toBe(5);
    expect(movesLeft(shift('down', 2), 5)).toBe(3);
    expect(movesLeft({ kind: 'rotate' }, 5)).toBe(0);
    // A 4-ship along the top turns about its second square: up would leave the board.
    expect(turnGhost(ship('s0', 0, 0, 4), null, 10)).toEqual({ ok: false, reason: 'No room to turn here.' });
    expect(turnGhost(ship('s0', 0, 3, 4), null, 10)).toEqual({ ok: true, move: { kind: 'rotate' } });
  });

  it("shows a teammate the shooter's plan live, and tells the room a ship moved, never which", () => {
    const teamSides = [
      { id: 'A', memberIds: ['host', 'carol'], captainId: 'host', alive: true, ready: true, shipsLeft: 4, movedLastTurn: false },
      { id: 'B', memberIds: ['bob'], captainId: 'bob', alive: true, ready: true, shipsLeft: 4, movedLastTurn: false },
    ];
    const base = rolled(3, { mode: 'teams', sides: teamSides, turn: { sideId: 'A', shooterId: 'host', roll: 3, canMove: true }, mySideId: 'A', targets: [target('B')] });
    const carolBoard = (plan: OwnBoardView['plan']) => ownBoard({ sideId: 'A', plan });
    enter(inGame({ ...base, myBoard: carolBoard(null) }), 'carol');
    store().selectTab('B');
    const planning = { ...base, myBoard: carolBoard({ shipId: 's3', move: shift('right', 2) }) };
    snapshot(inGame(planning));
    expect(store().tab).toBeNull();
    landed(planning);
    const html = render(inGame(planning), 'carol');
    expect(tagWith(html, 'ghost-ship')).toContain('data-x="7" data-y="5"');
    expect(html).not.toContain('data-testid="move-panel"');
    expect(html).not.toContain('data-testid="turn-choice"');
    expect(statusOf(inGame(planning), planning, 'carol', false, { mode: 'choose', stage: 'deciding' }).text).toBe('is moving one of your ships…');
    // The move lands: the next turn is Team B's, and the room hears only that a ship moved.
    const after = { ...planning, myBoard: carolBoard(null), turnNumber: 2, turn: { sideId: 'B', shooterId: 'bob', roll: 5, canMove: true }, lastAction: { kind: 'move' as const, playerId: 'host', sideId: 'A', dice: 3 }, sides: teamSides.map((s) => (s.id === 'A' ? { ...s, movedLastTurn: true } : s)) };
    snapshot(inGame(after));
    expect(platform().toasts.map((t) => t.text)).toEqual(['host moved a ship.']);
    // The opponent never had a plan to see, and the mover gets no toast about their own move.
    const bobView = { ...asViewer(planning, 'bob', ownBoard({ sideId: 'B' })), targets: [target('A')] };
    expect(render(inGame(bobView), 'bob')).not.toContain('data-testid="ghost-ship"');
    resetStore();
    enter(inGame({ ...planning, mySideId: 'A' }), 'host');
    snapshot(inGame({ ...after, myBoard: ownBoard({ sideId: 'A' }) }));
    expect(platform().toasts).toEqual([]);
  });

  it('draws a 14 × 14 team board with its extra ships, and damage that moved with its ship', () => {
    const fleet = [5, 4, 3, 3, 3, 3, 3, 2];
    const moved = { ...ship('s2', 10, 10, 3), damage: [true, false, false], hits: 1 };
    const big = view({
      mode: 'teams',
      boardSize: 14,
      fleet,
      myBoard: ownBoard({ ships: [ship('s0', 0, 0, 5), moved], shots: { '4,10': 'hit' } }),
      targets: [target('bob', { shipsLeft: 8, shipsTotal: 8 })],
    });
    const state = inGame(big);
    enter(state, 'host');
    store().selectTab(null);
    const html = render(state, 'host');
    const own = boardOf(html, 'own-board');
    expect(tagWith(html, 'own-board')).toContain('data-size="14"');
    expect(tagsWith(own, 'cell')).toHaveLength(196);
    expect(tagsWith(own, 'board-row')).toHaveLength(14);
    expect(own).toContain('<span>N</span>');
    // The old hit stays on its square; the damaged segment is marked where the ship is now.
    expect(tagsWith(own, 'cell').find((c) => c.includes('data-x="4" data-y="10"'))).toContain('data-mark="hit"');
    const segment = tagsWith(own, 'cell').find((c) => c.includes('data-x="10" data-y="10"')) ?? '';
    expect(segment).toContain('data-damaged="true"');
    expect(segment).toContain('aria-label="K11, your 3-ship, damaged"');
    expect(html).toContain('class="bs-ship__seg" data-damaged="true"');
    expect(tagsWith(html, 'my-fleet')).toHaveLength(1);
    store().selectTab('bob');
    const theirs = render(state, 'host');
    expect(tagsWith(boardOf(theirs, 'target-board'), 'cell')).toHaveLength(196);
    expect(theirs).toContain('8 of 8 ships afloat');
  });
});

describe('settings rows', () => {
  it('renders the choices, the sliders and the move or fire toggle for the host (no board size), read-only values otherwise', () => {
    const settings = { allowMidGameJoin: true, contentMode: 'family' as const, ...DEFAULT_BATTLESHIPS_SETTINGS };
    const host = renderToString(createElement(BattleshipsSettingsFields, { settings, canEdit: true, patch: () => undefined }));
    expect(tagWith(host, 'settings-mode')).toContain('data-value="solo"');
    expect(tagWith(host, 'settings-mode-teams')).toContain('aria-checked="false"');
    expect(host).not.toContain('settings-boardSize');
    expect(tagWith(host, 'settings-fleet')).toContain('data-value="classic"');
    expect(tagWith(host, 'settings-fleet-small')).toContain('aria-checked="false"');
    expect(tagWith(host, 'settings-placeSeconds')).toContain('max="120"');
    expect(tagWith(host, 'settings-turnSeconds')).toContain('min="10"');
    expect(tagWith(host, 'settings-moveOrFire')).toContain('checked');
    expect(host).toContain('Move or fire');
    expect(host).not.toContain('Dice moves');
    const guest = renderToString(createElement(BattleshipsSettingsFields, { settings, canEdit: false, patch: () => undefined }));
    expect(guest).not.toContain('data-testid="settings-mode"');
    expect(guest).not.toContain('data-testid="settings-placeSeconds"');
    expect(tagWith(guest, 'settings-value-mode')).toBeTruthy();
    expect(guest).toContain('Every player for themselves');
    expect(guest).toContain('Classic');
    expect(guest).not.toContain('8 × 8');
    expect(guest).toContain('60s');
    expect(tagWith(guest, 'settings-moveOrFire')).toContain('disabled');
    // No em dash anywhere a player reads.
    expect(host + guest).not.toContain('\u2014');
  });
});
