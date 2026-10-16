/**
 * Poker's client module under test: the hand model and the animation timeline planned from
 * snapshot diffs (the deal round from the button, bets to their spots, the sweep, the board street
 * by street, folds to the muck, the showdown and the pot to the winners, snapping to the truth),
 * the raise arithmetic, the copy, the screen per phase (the panel's lit and dimmed controls, hole
 * cards on their owner's page only, the showdown on the table with no results screen), the calm
 * table (the line under the ribbon, the stage, the seats' stack and bet), the
 * settings rows, the player-list hooks and the snapshot-driven store. Runs in node: browser
 * globals are stubbed, components render through react-dom/server.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DEFAULT_POKER_SETTINGS, type Card, type PokerActions, type PokerPlayerView, type PokerResults, type PokerRoomState, type PokerView } from '@shared/games/poker/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { pokerClient } = await import('./module');
const { usePokerStore } = await import('./store');
const { seatRing } = await import('./hooks');
const { amountFrom, clampAmount, potSized, raiseRange, wagerKind } = await import('./lib/raise');
const { categoryLabel, focusLine, handHint, handLabel, handRankOf, lastActionLabel, moveText, panelStatus, phaseKicker, resultLine, resultText, ribbonText, shortHandName, HOTKEY_HINT } = await import('./lib/text');
const { focusOf, stageKind, stageOwner } = await import('./lib/focus');
const { committedBefore, dealingOrder, tableOf } = await import('./lib/table');
const T = await import('./lib/timeline');
const S = await import('./lib/screen');
const { blindsIncreaseLabel, handsLabel } = await import('./SettingsFields');
const { longestReadout } = await import('../../platform/components/SettingControls');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');
const PA = await import('./actions');
const { socket } = await import('../../platform/net/socket');

const NOW = Date.now();
const c = (rank: Card['rank'], suit: Card['suit'] = 'S'): Card => ({ rank, suit });
const NO_ACTIONS: PokerActions = { canFold: false, canCheck: false, canCall: false, callAmount: 0, canBet: false, minBet: 0, maxBet: 0, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0, canAllIn: false };

function seat(overrides: Partial<PokerPlayerView> = {}): PokerPlayerView {
  return { chips: 1000, bet: 0, committed: 0, status: 'waiting', isDealer: false, isTurn: false, lastAction: null, busted: false, waitingForSeat: false, ...overrides };
}

/**
 * Pre-flop, three-handed: the host has the button and acts first, bob posted 5, carol 10. Every
 * viewer gets the same view except `myCards`, as the server sends it.
 */
function view(overrides: Partial<PokerView> = {}): PokerView {
  return {
    phase: 'acting',
    street: 'preflop',
    hand: 2,
    totalHands: 10,
    blinds: { small: 5, big: 10 },
    dealerId: 'host',
    community: [],
    pot: 15,
    pots: [],
    order: ['host', 'bob', 'carol'],
    turn: 'host',
    endsAt: NOW + 20_000,
    paused: false,
    players: {
      host: seat({ isDealer: true, isTurn: true, status: 'acting' }),
      bob: seat({ chips: 995, bet: 5, committed: 5, lastAction: { kind: 'smallBlind', amount: 5 } }),
      carol: seat({ chips: 990, bet: 10, committed: 10, lastAction: { kind: 'bigBlind', amount: 10 } }),
    },
    myCards: [],
    actions: NO_ACTIONS,
    results: null,
    lastMove: { kind: 'bigBlind', amount: 10, seq: 2, playerId: 'carol', street: 'preflop' },
    ...overrides,
  };
}

const HOST_ACTIONS: PokerActions = { canFold: true, canCheck: false, canCall: true, callAmount: 10, canBet: false, minBet: 10, maxBet: 1000, canRaise: true, minRaiseTo: 20, maxRaiseTo: 1000, canAllIn: true };
const KINGS = [c('K', 'H'), c('K', 'C')];

/** The view as the host gets it on their move: kings in the hole. */
function hostTurn(overrides: Partial<PokerView> = {}): PokerView {
  return view({ myCards: KINGS, actions: HOST_ACTIONS, ...overrides });
}

/** The host called, bob folded, carol checked: the flop is out and carol, left of the button, acts first. */
function flop(overrides: Partial<PokerView> = {}): PokerView {
  return view({
    street: 'flop',
    community: [c('K', 'S'), c('7', 'D'), c('2', 'C')],
    pot: 25,
    turn: 'carol',
    players: {
      host: seat({ chips: 990, committed: 10, isDealer: true }),
      bob: seat({ chips: 995, committed: 5, status: 'folded', lastAction: { kind: 'fold', amount: 0 } }),
      carol: seat({ chips: 990, committed: 10, status: 'acting', isTurn: true }),
    },
    lastMove: { kind: 'check', amount: 0, seq: 5, playerId: 'carol', street: 'preflop' },
    myCards: KINGS,
    ...overrides,
  });
}

const SHOWDOWN: PokerResults = {
  pots: [{ amount: 25, winners: [{ playerId: 'host', amount: 25 }], handName: 'Three of a kind, kings' }],
  revealed: {
    host: { cards: KINGS, category: 'threeOfAKind', name: 'Three of a kind, kings', best: [c('K', 'H'), c('K', 'C'), c('K', 'S'), c('Q', 'D'), c('9', 'H')] },
    carol: { cards: [c('7', 'S'), c('7', 'C')], category: 'threeOfAKind', name: 'Three of a kind, sevens', best: [c('7', 'S'), c('7', 'C'), c('7', 'D'), c('K', 'S'), c('Q', 'D')] },
  },
  uncontested: false,
  net: { host: 15, bob: -5, carol: -10 },
};

/** Checked down to the river: the host's set of kings beats carol's sevens. */
function showdown(overrides: Partial<PokerView> = {}): PokerView {
  return view({
    phase: 'results',
    street: 'river',
    community: [c('K', 'S'), c('7', 'D'), c('2', 'C'), c('Q', 'D'), c('9', 'H')],
    pot: 0,
    turn: null,
    players: {
      host: seat({ chips: 1015, isDealer: true }),
      bob: seat({ chips: 995, status: 'folded' }),
      carol: seat({ chips: 990 }),
    },
    results: SHOWDOWN,
    myCards: KINGS,
    ...overrides,
  });
}

function pkRoom(game: PokerView, overrides: Partial<PokerRoomState> = {}): PokerRoomState {
  return {
    ...room({ gameId: 'poker', phase: 'playing', players: [player('host', { name: 'Hana' }), player('bob', { name: 'Pia', joinOrder: 1 }), player('carol', { name: 'Quinn', joinOrder: 2 }), player('dave', { name: 'Dev', joinOrder: 3, participating: false })] }),
    settings: { contentMode: 'family', ...DEFAULT_POKER_SETTINGS },
    game,
    ...overrides,
  } as PokerRoomState;
}

function render(state: PokerRoomState, meId: string, isHost = meId === 'host'): string {
  usePlatformStore.getState().handleServerMessage(welcome(meId, state));
  usePlatformStore.setState({ connection: 'connected' });
  return renderToString(createElement(pokerClient.Screen, { room: state, meId, isHost }));
}

function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid=${testId}`);
  return match[0];
}

function tagsWith(html: string, testId: string): string[] {
  return html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`, 'g')) ?? [];
}

const attr = (tag: string, name: string): string | undefined => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const disabled = (html: string, testId: string): boolean => / disabled=""/.test(tagWith(html, testId));
/** The first run of text inside the element (past any wrapping spans: a move's label sits in one). */
const textOf = (html: string, testId: string): string => html.match(new RegExp(`data-testid="${testId}"[^>]*>(?:<span[^>]*>)*([^<]*)<`))?.[1] ?? '';

function snapshot(state: PokerRoomState): void {
  const prev = usePlatformStore.getState().room as PokerRoomState | null;
  usePlatformStore.getState().handleServerMessage({ t: 'room', room: state });
  pokerClient.onRoom?.(state, prev);
}

beforeEach(() => {
  resetStore();
  usePokerStore.getState().reset();
  setLocation('/poker/ABCD');
  registerGames(registryOf(pokerClient));
});

describe('the hand model', () => {
  it('shows my cards face up, everyone else’s as backs, nothing for a seat not dealt in, and the shown hands after a showdown', () => {
    const mine = tableOf(hostTurn(), 'host');
    expect(mine?.seats.host.cards).toEqual(KINGS);
    expect(mine?.seats.bob.cards).toEqual([null, null]);
    expect(tableOf(view(), 'dave')?.seats.host.cards).toEqual([null, null]);
    expect(tableOf(view({ hand: 0, order: [] }), 'host')).toBeNull();
    const shown = tableOf(showdown({ myCards: [c('4', 'D'), c('3', 'C')] }), 'bob');
    expect(shown?.seats.carol.cards).toEqual(SHOWDOWN.revealed.carol.cards);
    expect(shown?.seats.bob.cards).toEqual([c('4', 'D'), c('3', 'C')]);
    expect(shown?.seats.host.cards).toEqual(KINGS);
  });

  it('deals from the left of the button and knows what each seat put in before the street, a settled hand included', () => {
    const table = tableOf(view(), 'host');
    if (!table) throw new Error('no table');
    expect(dealingOrder(table)).toEqual(['bob', 'carol', 'host']);
    expect(committedBefore(table, 'carol')).toBe(0);
    const settled = tableOf(showdown(), 'host');
    if (!settled) throw new Error('no table');
    // The host won 25 for a net of 15: 10 went in. Carol lost her 10.
    expect(committedBefore(settled, 'host')).toBe(10);
    expect(committedBefore(settled, 'carol')).toBe(10);
  });
});

describe('the animation timeline', () => {
  const plan = (prevView: PokerView | null, nextView: PokerView, prev = T.EMPTY_TIMELINE, now = NOW, me = 'host') => T.planTimeline(prev, tableOf(prevView, me), tableOf(nextView, me), me, now, false, true);

  it("plays a whole run-out inside the server's reveal allowance, with the same timings", async () => {
    const { POKER_ANIMATION: A, settleRevealMs } = await import('@shared/games/poker/reveal');
    expect([T.DEAL_MS, T.DEAL_GAP_MS, T.FLIP_MS, T.CHIP_MS, T.DISCARD_MS, T.SWEEP_GAP_MS, T.STREET_GAP_MS, T.SHOWDOWN_GAP_MS, T.PAY_MS]).toEqual([A.deal, A.dealGap, A.flip, A.chip, A.discard, A.sweepGap, A.streetGap, A.showdownGap, A.pay]);
    const preflop = hostTurn();
    const prev = plan(null, preflop);
    const at = prev.endsAt + 10;
    const runOut = plan(preflop, showdown(), prev, at);
    expect(runOut.endsAt - at).toBeLessThanOrEqual(settleRevealMs({ holeCards: 0, boardFrom: 0, boardTo: 5, contested: true }));
    const dealtAndSettled = plan(null, showdown(), T.EMPTY_TIMELINE, NOW);
    expect(dealtAndSettled.endsAt - NOW).toBeLessThanOrEqual(settleRevealMs({ holeCards: 6, boardFrom: 0, boardTo: 5, contested: true }));
  });

  it('deals a new hand round from the button, two passes 150ms apart, while the blinds slide to their spots', () => {
    const tl = plan(null, hostTurn());
    expect(tl.arrivals).toEqual({
      'h/bob/0': NOW,
      'h/carol/0': NOW + 150,
      'h/host/0': NOW + 300,
      'h/bob/1': NOW + 450,
      'h/carol/1': NOW + 600,
      'h/host/1': NOW + 750,
    });
    expect(tl.endsAt).toBe(NOW + 750 + T.DEAL_MS);
    expect(tl.flights.map((f) => [f.from, f.to, f.amount, f.at])).toEqual([
      ['seat:bob', 'bet:bob', 5, NOW],
      ['seat:carol', 'bet:carol', 10, NOW],
    ]);
    // The bet spot fills when the chips land; the pot with them.
    expect(T.valueAt(tl, T.betValue('carol'), 10, NOW + 100)).toBe(0);
    expect(T.valueAt(tl, T.betValue('carol'), 10, NOW + T.CHIP_MS)).toBe(10);
    expect(T.valueAt(tl, T.POT_VALUE, 15, NOW + 100)).toBe(0);
    expect(T.valueAt(tl, T.POT_VALUE, 15, NOW + T.CHIP_MS)).toBe(15);
    expect(T.cardShown(tl, 'h/host/1', NOW + 700)).toBe(false);
    expect(T.cardMotion(tl, 'h/host/1', NOW + 760)).toBe('deal');
  });

  it('slides a call to its spot, and keeps the timeline as it is when nothing moved on the table', () => {
    const dealt = plan(null, hostTurn());
    const called = view({ turn: 'bob', pot: 25, players: { ...view().players, host: seat({ isDealer: true, chips: 990, bet: 10, committed: 10, lastAction: { kind: 'call', amount: 10 } }) } });
    const at = NOW + 2000;
    const tl = plan(hostTurn(), called, dealt, at);
    expect(tl.flights.slice(-1)[0]).toMatchObject({ from: 'seat:host', to: 'bet:host', amount: 10, at });
    expect(T.valueAt(tl, T.betValue('host'), 10, at + 10)).toBe(0);
    expect(T.valueAt(tl, T.betValue('host'), 10, at + T.CHIP_MS)).toBe(10);
    expect(T.valueAt(tl, T.POT_VALUE, 25, at + 10)).toBe(15);
    expect(plan(called, { ...called, endsAt: NOW + 30_000 }, tl, at + 500)).toBe(tl);
  });

  it('closes a street: the last bet lands, every bet sweeps into the pot, a fold goes to the muck, then the flop slides out and turns over', () => {
    const before = view({ turn: 'carol', pot: 20, players: { ...view().players, host: seat({ isDealer: true, chips: 990, bet: 10, committed: 10 }), bob: seat({ chips: 995, bet: 5, committed: 5, status: 'folded' }) } });
    const at = NOW + 3000;
    const tl = plan(before, flop(), plan(null, hostTurn()), at, 'host');
    // Carol checked: no chips moved for her, so the sweep starts at once.
    const sweep = tl.flights.filter((f) => f.to === 'pot');
    expect(sweep.map((f) => [f.from, f.amount])).toEqual([
      ['bet:host', 10],
      ['bet:bob', 5],
      ['bet:carol', 10],
    ]);
    expect(sweep.every((f) => f.at === at)).toBe(true);
    expect(T.valueAt(tl, T.betValue('host'), 0, at - 1)).toBe(10);
    expect(T.valueAt(tl, T.betValue('host'), 0, at)).toBe(0);
    const boardAt = at + T.CHIP_MS + T.SWEEP_GAP_MS;
    expect([tl.arrivals['b/0'], tl.arrivals['b/1'], tl.arrivals['b/2']]).toEqual([boardAt, boardAt + 150, boardAt + 300]);
    const flipAt = boardAt + 300 + T.DEAL_MS;
    expect([tl.flips['b/0'], tl.flips['b/1'], tl.flips['b/2']]).toEqual([flipAt, flipAt, flipAt]);
    expect(tl.endsAt).toBe(flipAt + T.FLIP_MS);
    const table = tableOf(flop(), 'host');
    const early = S.boardOnScreen(table, tl, boardAt + 160);
    expect(early.map((p) => (p ? p.card : 'slot'))).toEqual([null, null, 'slot', 'slot', 'slot']);
    const turning = S.boardOnScreen(table, tl, flipAt + 10);
    expect(turning[0]).toMatchObject({ card: c('K', 'S'), flipping: true });
  });

  it('sends a folded hand to the muck: it leaves at once, then it is gone; my own folded cards stay', () => {
    const before = view({ turn: 'bob', players: { ...view().players, host: seat({ isDealer: true, chips: 990, bet: 10, committed: 10 }) } });
    const folded = view({ turn: 'carol', players: { ...before.players, bob: seat({ chips: 995, bet: 5, committed: 5, status: 'folded', lastAction: { kind: 'fold', amount: 0 } }) } });
    const at = NOW + 4000;
    const tl = plan(before, folded, plan(null, before), at);
    expect(tl.departures).toEqual({ 'h/bob/0': at, 'h/bob/1': at });
    const table = tableOf(folded, 'host');
    expect(S.holeOnScreen(table, tl, 'bob', 'host', at - 1).map((x) => x.leaving)).toEqual([false, false]);
    expect(S.holeOnScreen(table, tl, 'bob', 'host', at + 10).map((x) => x.leaving)).toEqual([true, true]);
    expect(S.holeOnScreen(table, tl, 'bob', 'host', at + T.DISCARD_MS)).toEqual([]);
    // Snapped (a reconnect), a folded hand is simply not there; my own stays in front of me.
    const snapped = T.snapTimeline(table, at);
    expect(S.holeOnScreen(table, snapped, 'bob', 'host', at)).toEqual([]);
    expect(S.holeOnScreen(tableOf(folded, 'bob'), snapped, 'bob', 'bob', at)).toHaveLength(2);
  });

  it('plays a showdown: the river, the hands turning over (not mine), the winner lit and the pot sliding over before the stack grows', () => {
    const river = view({
      street: 'river',
      community: showdown().community,
      pot: 25,
      turn: 'host',
      players: { host: seat({ chips: 990, committed: 10, isDealer: true, status: 'acting', isTurn: true }), bob: seat({ chips: 995, committed: 5, status: 'folded' }), carol: seat({ chips: 990, committed: 10 }) },
      myCards: KINGS,
    });
    const at = NOW + 9000;
    const tl = plan(river, showdown(), plan(null, river), at);
    expect(tl.flips['h/carol/0']).toBe(at + T.SHOWDOWN_GAP_MS);
    expect(tl.flips['h/host/0']).toBeUndefined();
    const outcomes = at + T.SHOWDOWN_GAP_MS + T.FLIP_MS + T.SHOWDOWN_GAP_MS;
    expect(tl.marks.outcomes).toBe(outcomes);
    expect(tl.marks.paid).toBe(outcomes + T.PAY_MS);
    expect(tl.flights.slice(-1)[0]).toMatchObject({ from: 'pot', to: 'seat:host', amount: 25, at: outcomes, ms: T.PAY_MS });
    expect(T.valueAt(tl, T.POT_VALUE, 0, outcomes - 1)).toBe(25);
    expect(T.valueAt(tl, T.POT_VALUE, 0, outcomes)).toBe(0);
    expect(T.valueAt(tl, T.chipsValue('host'), 1015, outcomes)).toBe(990);
    expect(T.valueAt(tl, T.chipsValue('host'), 1015, outcomes + T.PAY_MS)).toBe(1015);
    const table = tableOf(showdown(), 'host');
    expect(S.holeOnScreen(table, tl, 'carol', 'host', at + 10).map((x) => x.card)).toEqual([null, null]);
    expect(S.holeOnScreen(table, tl, 'carol', 'host', outcomes).map((x) => x.card)).toEqual(SHOWDOWN.revealed.carol.cards);
    expect(S.wonOnScreen(table, tl, 'host', outcomes - 1)).toBe(0);
    expect(S.wonOnScreen(table, tl, 'host', outcomes)).toBe(25);
    expect(S.winningCards(table, tl, outcomes)).toEqual(SHOWDOWN.revealed.host.best);
  });

  it('splits the slide of a split pot between its winners, and shows no cards for a pot nobody contested', () => {
    const split: PokerResults = { ...SHOWDOWN, pots: [{ amount: 24, winners: [{ playerId: 'host', amount: 12 }, { playerId: 'carol', amount: 12 }], handName: 'Pair of kings' }] };
    const river = view({ street: 'river', community: showdown().community, pot: 24, players: { host: seat({ committed: 12 }), bob: seat({ status: 'folded' }), carol: seat({ committed: 12 }) } });
    const tl = plan(river, showdown({ results: split }), plan(null, river), NOW + 10_000);
    expect(tl.flights.filter((f) => f.from === 'pot').map((f) => [f.to, f.amount])).toEqual([
      ['seat:host', 12],
      ['seat:carol', 12],
    ]);
    const uncontested: PokerResults = { pots: [{ amount: 15, winners: [{ playerId: 'carol', amount: 15 }], handName: null }], revealed: {}, uncontested: true, net: { host: 0, bob: -5, carol: 5 } };
    const folds = plan(view(), showdown({ street: 'preflop', community: [], results: uncontested }), plan(null, view()), NOW + 1000);
    expect(Object.keys(folds.flips)).toEqual([]);
    expect(resultText(uncontested, (id) => (id === 'carol' ? 'Quinn' : 'You'))).toBe('Quinn takes the pot');
  });

  it('clears the last hand to the muck before the next deal', () => {
    const settled = plan(null, showdown());
    const next = hostTurn({ hand: 3 });
    const at = NOW + 20_000;
    const tl = plan(showdown(), next, settled, at);
    expect(tl.discard).toMatchObject({ from: at, until: at + T.DISCARD_MS });
    expect(tl.arrivals['h/bob/0']).toBe(at + T.DISCARD_MS);
    expect(T.frameAt(tl, tableOf(next, 'host'), at + 10)).toMatchObject({ leaving: true });
    expect(T.frameAt(tl, tableOf(next, 'host'), at + T.DISCARD_MS).table?.hand).toBe(3);
  });

  it('snaps to the truth on a fresh entry, under reduced motion and when it would run far behind; every number ends on the truth', () => {
    const fresh = T.planTimeline(T.EMPTY_TIMELINE, null, tableOf(hostTurn(), 'host'), 'host', NOW, true, true);
    expect(fresh.arrivals).toEqual({});
    expect(fresh.id).toBe(2);
    expect(T.planTimeline(T.EMPTY_TIMELINE, tableOf(view(), 'host'), tableOf(flop(), 'host'), 'host', NOW, false, false).flights).toEqual([]);
    const backlog = { ...plan(null, view()), endsAt: NOW + T.MAX_BACKLOG_MS + 1 };
    expect(plan(view(), flop(), backlog).arrivals).toEqual({});
    // Two moves in one snapshot (the flop and a bet on it): the bet spot ends on the truth, not on the sweep's zero.
    const skipped = flop({ pot: 45, players: { ...flop().players, carol: seat({ chips: 970, bet: 20, committed: 30, lastAction: { kind: 'bet', amount: 20 } }) } });
    const tl = plan(view(), skipped, plan(null, view()), NOW + 2000);
    expect(T.valueAt(tl, T.betValue('carol'), 20, tl.endsAt)).toBe(20);
  });

  it('is planned by the module from each snapshot, and a welcome shows the table at once', () => {
    usePlatformStore.getState().handleServerMessage(welcome('host', pkRoom(view())));
    pokerClient.onRoom?.(pkRoom(view()), null);
    expect(usePokerStore.getState().timeline.arrivals).toEqual({});
    snapshot(pkRoom(view({ hand: 3, myCards: KINGS })));
    expect(Object.keys(usePokerStore.getState().timeline.arrivals)).toHaveLength(6);
    // A reconnect is a welcome with the old room still in the store: it shows the truth, not a replay of what was missed.
    pokerClient.onWelcome?.(undefined);
    pokerClient.onRoom?.(pkRoom(flop({ hand: 3 })), pkRoom(view({ hand: 3, myCards: KINGS })));
    expect(usePokerStore.getState().timeline).toMatchObject({ id: 3, arrivals: {}, flights: [] });
  });
});

describe('sounds', () => {
  it('starts the game with hand 1 dealt (no game before it): the deal plays its sounds and the first to act hears the your-turn cue', async () => {
    const { pokerSounds } = await import('./sounds');
    const { CUES } = await import('../../platform/lib/sound');
    vi.useFakeTimers();
    try {
      const play = vi.spyOn(pokerSounds, 'play');
      const cue = vi.spyOn(CUES, 'play');
      const lobby = pkRoom(null as unknown as PokerView, { phase: 'lobby' });
      usePlatformStore.getState().handleServerMessage(welcome('host', lobby));
      pokerClient.onWelcome?.(undefined);
      pokerClient.onRoom?.(lobby, null);
      snapshot(pkRoom(hostTurn({ hand: 1 })));
      expect(Object.keys(usePokerStore.getState().timeline.arrivals)).toHaveLength(6);
      vi.advanceTimersByTime(5000);
      expect(play.mock.calls.filter(([name]) => name === 'deal')).toHaveLength(6);
      expect(cue.mock.calls.map(([name]) => name)).toContain('yourTurn');
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('keeps the sounds under reduced motion: the table snaps, the sound timeline still has every card and chip', () => {
    const store = usePokerStore.getState();
    store.applyView(view(), 'host', NOW, false, false);
    store.applyView(flop(), 'host', NOW + 1000, false, false);
    const { timeline, soundTimeline } = usePokerStore.getState();
    expect(timeline.arrivals).toEqual({});
    expect(Object.keys(soundTimeline.arrivals).filter((k) => k.startsWith('b/'))).toHaveLength(3);
    usePokerStore.getState().applyView(showdown(), 'host', NOW + 2000, false, false);
    const after = usePokerStore.getState();
    expect(after.timeline.flights).toEqual([]);
    expect(after.soundTimeline.flights.some((f) => f.from === T.POT_ANCHOR)).toBe(true);
    expect(after.soundTimeline.marks.outcomes).toBeGreaterThan(NOW + 2000);
  });
});

describe('the raise amount', () => {
  it('works out the window, reads the field and sizes half pot and pot bets and raises', () => {
    expect(raiseRange(HOST_ACTIONS)).toEqual({ kind: 'raise', min: 20, max: 1000 });
    expect(raiseRange({ ...NO_ACTIONS, canBet: true, minBet: 10, maxBet: 990 })).toEqual({ kind: 'bet', min: 10, max: 990 });
    expect(raiseRange(NO_ACTIONS)).toBeNull();
    // Off my turn the row reads what the street offers: a bet on an unbet street after the flop, a raise preflop or facing a bet.
    expect(wagerKind(flop(), null)).toBe('bet');
    expect(wagerKind(view(), null)).toBe('raise');
    expect(wagerKind(flop({ players: { ...flop().players, carol: seat({ bet: 20 }) } }), null)).toBe('raise');
    expect(wagerKind(flop(), { kind: 'raise', min: 20, max: 100 })).toBe('raise');
    const raise = { kind: 'raise' as const, min: 20, max: 1000 };
    expect(amountFrom('', raise)).toBeNull();
    expect(amountFrom('12a', raise)).toBeNull();
    expect(amountFrom('3', raise)).toBe(20);
    expect(amountFrom('5000', raise)).toBe(1000);
    expect(clampAmount(Number.NaN, raise)).toBe(20);
    // Facing 10 with 15 in: a pot raise calls 10 (pot 25) and raises 25 more, to 35; half pot to 22.
    expect(potSized(view(), 0, raise, 1)).toBe(35);
    expect(potSized(view(), 0, raise, 0.5)).toBe(22);
    const bet = { kind: 'bet' as const, min: 10, max: 990 };
    expect(potSized({ pot: 120, players: {} }, 0, bet, 0.5)).toBe(60);
    expect(potSized({ pot: 5000, players: {} }, 0, bet, 1)).toBe(990);
  });
});

describe('copy', () => {
  it('names hands for the pill: pocket pairs and high cards before the flop, the best five after', () => {
    expect(handHint([], [])).toBeNull();
    expect(handHint(KINGS, [])).toBe('Pair of kings');
    expect(handHint([c('A', 'H'), c('7', 'C')], [])).toBe('Ace high');
    expect(handHint([c('K', 'H'), c('5', 'C')], [c('K', 'S'), c('5', 'D'), c('9', 'C')])).toBe('Two pair, kings and fives');
    expect(categoryLabel('fullHouse')).toBe('Full house');
    // A phone's pill: the pair and the high card in full, the rest by kind, never cut.
    const short = (mine: Card[], board: Card[]) => {
      const hand = handRankOf(mine, board);
      return hand ? shortHandName(hand) : null;
    };
    expect(short(KINGS, [])).toBe('Pair of kings');
    expect(short([c('A', 'H'), c('7', 'C')], [])).toBe('Ace high');
    expect(short([c('K', 'H'), c('5', 'C')], [c('K', 'S'), c('5', 'D'), c('9', 'C')])).toBe('Two pair');
    expect(short(KINGS, [c('K', 'S'), c('5', 'D'), c('9', 'C')])).toBe('Three of a kind');
    expect(short(KINGS, [c('K', 'S'), c('5', 'D'), c('5', 'C')])).toBe('Full house');
    expect(short([c('A', 'H'), c('K', 'H')], [c('Q', 'H'), c('J', 'H'), c('10', 'H')])).toBe('Royal flush');
    expect(short([c('9', 'H'), c('K', 'H')], [c('Q', 'H'), c('J', 'H'), c('10', 'H')])).toBe('Straight flush');
    for (const kind of ['Two pair', 'Three of a kind', 'Four of a kind', 'Straight flush', 'Full house']) expect(kind.length).toBeLessThanOrEqual(15);
  });

  it('words every move for the line under the ribbon, for another player and for me', () => {
    expect(moveText('Quinn', { kind: 'raise', amount: 1200 })).toBe('Quinn raises to 1,200');
    expect(moveText('', { kind: 'raise', amount: 40 }, true)).toBe('You raise to 40');
    expect(moveText('Pia', { kind: 'call', amount: 10 })).toBe('Pia calls 10');
    expect(moveText('Pia', { kind: 'check', amount: 0 })).toBe('Pia checks');
    expect(moveText('Pia', { kind: 'fold', amount: 0 })).toBe('Pia folds');
    expect(moveText('', { kind: 'fold', amount: 0 }, true)).toBe('You fold');
    expect(moveText('Pia', { kind: 'bet', amount: 20 })).toBe('Pia bets 20');
    expect(moveText('Pia', { kind: 'allIn', amount: 300 })).toBe('Pia is all in for 300');
    expect(moveText('', { kind: 'allIn', amount: 300 }, true)).toBe("You're all in for 300");
    expect(moveText('Pia', { kind: 'smallBlind', amount: 5 })).toBe('Pia posts the small blind');
    expect(moveText('', { kind: 'bigBlind', amount: 10 }, true)).toBe('You post the big blind');
  });

  it('says whose turn it is with the last move on this street, then who took the pot and with what', () => {
    const names: Record<string, string> = { host: 'Hana', bob: 'Pia', carol: 'Quinn' };
    const line = (v: PokerView, meId: string, shown = true) => focusLine(focusOf({ view: v, table: tableOf(v, meId), outcomesShown: shown, held: false, meId }), { view: v, meId, nameOf: (id) => names[id] ?? id, results: shown ? v.results : null });
    // Pre-flop: carol's big blind is the last move.
    expect(line(view(), 'bob')).toEqual({ state: 'turn', text: "Hana's turn", tone: 'other', sub: 'Quinn posts the big blind' });
    expect(line(view(), 'host')).toEqual({ state: 'mine', text: 'Your turn', tone: 'go', sub: 'Quinn posts the big blind' });
    // A new street: the move that closed the last one is not this street's, so no second part.
    expect(line(flop(), 'bob')).toEqual({ state: 'turn', text: "Quinn's turn", tone: 'other', sub: undefined });
    expect(line(flop({ lastMove: { kind: 'check', amount: 0, seq: 6, playerId: 'host', street: 'flop' } }), 'host').sub).toBe('You check');
    // The showdown, once it shows: who won, then the hand.
    expect(line(showdown(), 'bob')).toEqual({ state: 'result', text: 'Hana wins 25', tone: 'other', sub: 'Three of a kind, kings' });
    expect(line(showdown(), 'host')).toEqual({ state: 'result', text: 'You win 25', tone: 'go', sub: 'Three of a kind, kings' });
    expect(line(showdown(), 'bob', false)).toEqual({ state: 'idle', text: 'Showdown', tone: 'quiet' });
    expect(resultLine({ ...SHOWDOWN, uncontested: true }, (id) => names[id])).toEqual({ text: 'Hana takes the pot' });
    const split = { ...SHOWDOWN, pots: [{ ...SHOWDOWN.pots[0], winners: [{ playerId: 'host', amount: 12 }, { playerId: 'carol', amount: 13 }] }] };
    expect(resultLine(split, (id) => names[id])).toEqual({ text: 'Split pot', sub: 'Three of a kind, kings' });
    expect(ribbonText(view())).toBe('Blinds 5/10');
  });

  it('labels the hand, the moves, the phase, the result and whose turn it is', () => {
    expect(handLabel({ hand: 3, totalHands: 10 })).toBe('Hand 3 of 10');
    expect(handLabel({ hand: 3, totalHands: 0 })).toBe('Hand 3');
    expect(lastActionLabel({ kind: 'raise', amount: 1200 })).toBe('Raise to 1,200');
    expect(lastActionLabel({ kind: 'bigBlind', amount: 10 })).toBe('BB 10');
    // The blinds lead, so a narrow phone that cuts the line still shows them.
    expect(phaseKicker(view())).toBe('Blinds 5/10 · Pre-flop');
    expect(phaseKicker(showdown())).toBe('Blinds 5/10 · Showdown');
    // Short phones keep the side pots as one compact line rather than hiding them.
    const css = readFileSync(join(import.meta.dirname, 'poker.css'), 'utf8');
    expect(css).not.toMatch(/\.pk-pot__sides\s*\{\s*display:\s*none/);
    // A tile's payout float sits at the tile's right edge, off the cards, without the centring translate.
    const float = css.match(/\.pk \.tbl-tile \.tbl-payout \{([^}]*)\}/)?.[1] ?? '';
    expect(float).toMatch(/left:\s*auto/);
    expect(float).toMatch(/right:\s*6px/);
    expect(float).toMatch(/animation-name:\s*pk-seat-rise/);
    expect(css.match(/@keyframes pk-seat-rise \{[\s\S]*?\n\}/)?.[0]).not.toContain('-50%');
    // On a narrow tile it rises at the top instead, so it never covers the "1,100 chips" line at the bottom.
    const narrow = css.match(/@container tile \(max-width: 160px\) \{\s*\.pk \.tbl-tile \.tbl-payout \{([^}]*)\}/)?.[1] ?? '';
    expect(narrow).toMatch(/top:\s*3px/);
    expect(narrow).toMatch(/bottom:\s*auto/);
    expect(resultText(SHOWDOWN, (id) => (id === 'host' ? 'You' : 'Quinn'))).toBe('You win 25 with three of a kind, kings');
    expect(resultText(SHOWDOWN, () => 'Hana')).toBe('Hana wins 25 with three of a kind, kings');
    // An article where English wants one: "with a straight", never "with straight".
    const named = (handName: string) => resultText({ ...SHOWDOWN, pots: [{ ...SHOWDOWN.pots[0], handName }] }, () => 'Pia');
    expect(named('Straight, seven high')).toBe('Pia wins 25 with a straight, seven high');
    expect(named('Pair of kings')).toBe('Pia wins 25 with a pair of kings');
    expect(named('Full house, kings over fives')).toBe('Pia wins 25 with a full house, kings over fives');
    expect(named('Royal flush')).toBe('Pia wins 25 with a royal flush');
    expect(named('Two pair, kings and fives')).toBe('Pia wins 25 with two pair, kings and fives');
    expect(named('Ace high')).toBe('Pia wins 25 with ace high');
    const base = { phase: 'acting' as const, seated: true, waitingForSeat: false, busted: false, connected: true, held: false, inHand: true, myTurn: false, turnName: 'Pia', result: null, won: false };
    expect(panelStatus(base)).toEqual({ state: 'their-turn', text: "Pia's turn", tone: 'other' });
    expect(panelStatus({ ...base, myTurn: true })).toEqual({ state: 'my-turn', text: 'Your turn', tone: 'go' });
    expect(panelStatus({ ...base, phase: 'results', turnName: null })).toMatchObject({ state: 'showdown' });
    expect(panelStatus({ ...base, phase: 'results', result: 'You win 25', won: true })).toMatchObject({ state: 'result', tone: 'go' });
    expect(panelStatus({ ...base, seated: false }).state).toBe('spectating');
    expect(panelStatus({ ...base, busted: true }).state).toBe('out');
    expect(panelStatus({ ...base, inHand: false, turnName: null }).text).toBe("You're in from the next hand");
    expect(panelStatus({ ...base, inHand: false, waitingForSeat: true })).toEqual({ state: 'no-seat', text: 'Table full. You get the next free seat', tone: 'quiet' });
  });

  it('never shows an em dash anywhere in the module', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx?|css)$/.test(name) && !name.endsWith('.test.ts')) files.push(path);
      }
    };
    walk(import.meta.dirname);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(readFileSync(file, 'utf8').includes('\u2014'), file).toBe(false);
    expect(HOTKEY_HINT.includes('\u2014')).toBe(false);
  });
});

describe('the screen', () => {
  it('my turn: Fold, Call and Raise lit with the amount at the minimum raise, the calm table with the pot, the board slots, the ribbon, the seats and my cards', () => {
    const html = render(pkRoom(hostTurn()), 'host');
    expect(attr(tagWith(html, 'poker-screen'), 'data-phase')).toBe('acting');
    expect(attr(tagWith(html, 'hand-indicator'), 'data-hand')).toBe('2');
    expect(attr(tagWith(html, 'blinds'), 'data-big')).toBe('10');
    expect(tagsWith(html, 'community-slot')).toHaveLength(5);
    expect(attr(tagWith(html, 'pot'), 'data-chips')).toBe('15');
    for (const id of ['action-fold', 'action-call', 'action-raise', 'action-allin', 'raise-half', 'raise-pot', 'raise-max']) expect(disabled(html, id), id).toBe(false);
    expect(textOf(html, 'action-call')).toBe('Call 10');
    // The main move is the one big button; Fold, Raise and All in share the row over it.
    expect(tagWith(html, 'action-call')).toContain('tbl-panel__primary');
    expect(html).toMatch(/class="tbl-panel__moves tbl-panel__moves--3" style="--moves:3"/);
    // The field says the amount; the button says the move, and the whole of it to a screen reader.
    expect(textOf(html, 'action-raise')).toBe('Raise');
    expect(attr(tagWith(html, 'action-raise'), 'aria-label')).toBe('Raise to 20');
    expect(attr(tagWith(html, 'action-raise'), 'data-amount')).toBe('20');
    expect(attr(tagWith(html, 'raise-input'), 'value')).toBe('20');
    expect(attr(tagWith(html, 'raise-input'), 'inputMode')).toBe('numeric');
    expect(attr(tagWith(html, 'pk-panel'), 'data-min')).toBe('20');
    expect(attr(tagWith(html, 'turn-status'), 'data-state')).toBe('my-turn');
    expect(attr(tagWith(html, 'action-fold'), 'aria-keyshortcuts')).toBe('F');
    expect(tagWith(html, 'hotkey-hint')).toBeTruthy();
    const seats = tagsWith(html, 'seat');
    expect(seats.map((s) => attr(s, 'data-player-id'))).toEqual(['bob', 'carol']);
    expect(attr(seats[1], 'data-bet')).toBe('10');
    expect(attr(tagWith(html, 'my-area'), 'data-my-turn')).toBe('true');
    expect(attr(tagWith(html, 'my-area'), 'data-dealer')).toBe('true');
    expect(tagsWith(html, 'my-card').map((t) => `${attr(t, 'data-rank')}${attr(t, 'data-suit')}`)).toEqual(['KH', 'KC']);
    expect(textOf(html, 'hand-hint')).toBe('Pair of kings');
    expect(html).not.toContain('overlay-results');
    // The calm table: the ribbon with the blinds and the hand, whose turn with the clock under it, the deck in the corner.
    expect(attr(tagWith(html, 'pk-table'), 'class')).toContain('tbl-felt tbl-felt--calm pk-table');
    expect(html).toMatch(/class="tbl-ribbon__main">Blinds 5\/10<\/span><\/span><span class="tbl-ribbon__sub">Hand 2 of 10</);
    expect(attr(tagWith(html, 'table-turn'), 'data-state')).toBe('mine');
    expect(html).toMatch(/data-testid="table-turn"[^>]*><span class="tbl-turn__clock">[\s\S]*?data-testid="timer"[\s\S]*?<span class="tbl-turn__text">Your turn<\/span><span class="tbl-turn__sub" data-testid="turn-sub">Quinn posts the big blind</);
    expect(attr(tagWith(html, 'deck'), 'class')).toBe('tbl-deck tbl-deck--corner');
    expect(html).not.toContain('tbl-spot');
    // My stake on the stage as its own pill; theirs on their seats; every stack in words.
    expect(attr(tagWith(html, 'hand-stage'), 'data-player-id')).toBe('host');
    expect(attr(tagWith(html, 'my-bet'), 'data-bet')).toBe('0');
    expect(html).toMatch(/data-testid="seat-bet" data-bet="10"><span class="tbl-stake tbl-stake--bet" data-bet="10"><span class="tbl-stake__word">Bet<\/span> <span class="tbl-stake__value">10<\/span>/);
    expect(html).toMatch(/data-testid="seat-chips" data-chips="990"><span class="tbl-stackcount__value">990<\/span> <span class="tbl-stackcount__word">chips<\/span>/);
    expect(html).toMatch(/class="tbl-stake tbl-stake--pot pk-pot__pill" data-testid="pot" data-bet="15" data-chips="15" data-shown="15" data-table-anchor="pot"><span class="tbl-stake__word">Pot<\/span> <span class="tbl-stake__value">15</);
  });

  it("someone else's turn: every control dimmed, Check shown, their seat lit and named in the status line", () => {
    const html = render(pkRoom(flop({ myCards: [c('7', 'H'), c('2', 'D')] })), 'bob', false);
    for (const id of ['action-fold', 'action-check', 'action-raise', 'action-allin', 'raise-input', 'raise-half', 'raise-pot', 'raise-max']) expect(disabled(html, id), id).toBe(true);
    const carol = tagsWith(html, 'seat').find((t) => attr(t, 'data-player-id') === 'carol') ?? '';
    expect(attr(carol, 'data-turn')).toBe('true');
    expect(textOf(html, 'turn-status')).toBe('Quinn&#x27;s turn');
    expect(attr(tagWith(html, 'my-area'), 'data-status')).toBe('folded');
    // My folded cards stay on my stage, dimmed, with what I did.
    expect(tagWith(html, 'my-cards')).toContain('pk-hand--folded');
    expect(textOf(html, 'my-state')).toBe('Folded');
  });

  it('never puts my hole cards on anyone else’s page: the other seats and a spectator see backs only', () => {
    for (const viewer of ['bob', 'carol', 'dave']) {
      const html = render(pkRoom(view({ myCards: viewer === 'bob' ? [c('7', 'D'), c('2', 'C')] : [] })), viewer, false);
      for (const back of tagsWith(html, 'seat-card')) {
        expect(attr(back, 'data-face')).toBe('down');
        expect(back).not.toContain('data-rank');
      }
      if (viewer !== 'bob') expect(html).not.toContain('data-rank="7"');
    }
    // A spectator has no hand of their own: the stage shows the hand in play, backs only.
    const spectator = render(pkRoom(view()), 'dave', false);
    expect(attr(tagWith(spectator, 'turn-status'), 'data-state')).toBe('spectating');
    // No controls at all for a spectator: one line in place of the panel.
    expect(textOf(spectator, 'turn-status')).toBe('You&#x27;re watching. You can play the next game.');
    expect(attr(tagWith(spectator, 'pk-panel'), 'data-watching')).toBe('true');
    for (const id of ['raise-input', 'action-fold', 'action-call', 'action-check', 'action-raise', 'action-allin', 'raise-max']) expect(tagsWith(spectator, id), id).toHaveLength(0);
    expect(tagsWith(spectator, 'my-area')).toHaveLength(0);
    expect(tagsWith(spectator, 'seat')).toHaveLength(3);
    expect(attr(tagWith(spectator, 'hand-stage'), 'data-player-id')).toBe('host');
    expect(tagsWith(spectator, 'stage-card').map((t) => attr(t, 'data-face'))).toEqual(['down', 'down']);
  });

  it('the end of a hand stays on the table: the board, the shown hands in the seats, the winner outlined and the result in the status line', () => {
    const html = render(pkRoom(showdown()), 'host');
    expect(attr(tagWith(html, 'poker-screen'), 'data-phase')).toBe('results');
    expect(tagsWith(html, 'community-card')).toHaveLength(5);
    expect(tagsWith(html, 'community-card').filter((t) => t.includes('playing-card--highlight'))).toHaveLength(3);
    const carol = tagsWith(html, 'seat-card');
    expect(carol.map((t) => attr(t, 'data-rank'))).toEqual(['7', '7']);
    expect(attr(tagWith(html, 'my-area'), 'data-outcome')).toBe('win');
    expect(attr(tagWith(html, 'my-area'), 'data-payout')).toBe('25');
    expect(textOf(html, 'turn-status')).toBe('You win 25 with three of a kind, kings');
    // My winning hand outlined in lime with its name in a lime pill, the win in words beside it; no clock in the pause.
    expect(attr(tagWith(html, 'my-cards'), 'data-tone')).toBe('win');
    expect(tagWith(html, 'hand-hint')).toContain('tbl-pill--win');
    expect(html).toMatch(/class="tbl-flag tbl-flag--win"><span data-testid="hand-outcome">Win<\/span> \+25/);
    expect(html).toMatch(/data-testid="table-turn" data-state="result"><span class="tbl-turn__text">You win 25<\/span><span class="tbl-turn__sub" data-testid="turn-sub">Three of a kind, kings</);
    expect(tagsWith(html, 'my-area')).toHaveLength(1);
    expect(html).not.toContain('overlay-results');
    // Pia folded: her cards stay dimmed on her stage, and the winner's hand shows beside them.
    const pia = render(pkRoom(showdown()), 'bob', false);
    expect(textOf(pia, 'turn-status')).toBe('Hana wins 25 with three of a kind, kings');
    expect(attr(tagWith(pia, 'winner-hand'), 'data-player-id')).toBe('host');
    expect(tagsWith(pia, 'winner-card').map((t) => `${attr(t, 'data-rank')}${attr(t, 'data-suit')}`)).toEqual(['KH', 'KC']);
    expect(pia).toMatch(/data-testid="winner-cards"[\s\S]*?tbl-pill tbl-pill--win[^>]*>Trips</);
    const host = tagsWith(pia, 'seat').find((t) => attr(t, 'data-player-id') === 'host') ?? '';
    expect(attr(host, 'data-outcome')).toBe('win');
    // Carol lost at the showdown: her hand outlined in red, "Lost" beside it, the winner's hand there instead.
    const quinn = render(pkRoom(showdown({ myCards: [c('7', 'S'), c('7', 'C')] })), 'carol', false);
    expect(attr(tagWith(quinn, 'my-area'), 'data-outcome')).toBe('loss');
    expect(attr(tagWith(quinn, 'my-cards'), 'data-tone')).toBe('loss');
    expect(tagsWith(quinn, 'winner-hand')).toHaveLength(1);
  });

  it('a bet when nobody has bet: the label says Bet with the field, Check in place of Call', () => {
    const actions: PokerActions = { ...NO_ACTIONS, canFold: true, canCheck: true, canBet: true, minBet: 10, maxBet: 990, canAllIn: true };
    const html = render(pkRoom(flop({ turn: 'host', actions, players: { ...flop().players, host: seat({ chips: 990, committed: 10, isDealer: true, status: 'acting', isTurn: true }), carol: seat({ chips: 990, committed: 10 }) } })), 'host');
    expect(textOf(html, 'action-check')).toBe('Check');
    expect(disabled(html, 'action-check')).toBe(false);
    expect(textOf(html, 'action-raise')).toBe('Bet');
    expect(attr(tagWith(html, 'action-raise'), 'aria-label')).toBe('Bet 10');
    expect(attr(tagWith(html, 'pk-panel'), 'data-kind')).toBe('bet');
    expect(html).toContain('Bet amount');
  });

  it('gives the host the platform\'s End game in the top bar, nobody else, and says what it does mid-hand', () => {
    expect(tagWith(render(pkRoom(hostTurn()), 'host'), 'end-game')).toBeTruthy();
    expect(tagsWith(render(pkRoom(view()), 'bob', false), 'end-game')).toHaveLength(0);
    expect(pokerClient.endGameNote?.(pkRoom(hostTurn()))).toBe('The hand in play is off. Every bet goes back.');
    expect(pokerClient.endGameNote?.(pkRoom(view({ phase: 'results' })))).toBeNull();
  });
});

describe('the stage and the line under the ribbon', () => {
  it('puts my state beside my cards: what I did last, folded, all in, out', async () => {
    const { myState } = await import('./components/Stage');
    expect(myState(view(), 'host')).toBe('');
    expect(myState(view(), 'carol')).toBe('BB 10');
    expect(myState(flop(), 'bob')).toBe('Folded');
    expect(myState(view({ players: { ...view().players, bob: seat({ status: 'allIn' }) } }), 'bob')).toBe('All in');
    expect(myState(view({ players: { ...view().players, bob: seat({ busted: true, chips: 0 }) } }), 'bob')).toBe('Out of chips');
  });

  it('follows the player to act with who is next round the table, then the winner', () => {
    const at = (v: PokerView, meId: string | null, shown = true, held = false) => focusOf({ view: v, table: tableOf(v, meId), outcomesShown: shown, held, meId });
    // Pre-flop: the host acts, bob is next; on the host's own page it is their own turn.
    expect(at(view(), 'bob')).toEqual({ kind: 'turn', playerId: 'host', mine: false, next: 'bob' });
    expect(at(view(), 'host')).toMatchObject({ kind: 'turn', mine: true });
    // On the flop carol acts; bob folded, so the host is next (round the table past the fold).
    expect(at(flop(), 'bob')).toEqual({ kind: 'turn', playerId: 'carol', mine: false, next: 'host' });
    // The showdown: the host won the pot, once the outcome shows.
    expect(at(showdown(), 'bob', false)).toEqual({ kind: 'idle', reason: 'showdown' });
    expect(at(showdown(), 'bob')).toEqual({ kind: 'result', playerId: 'host', mine: false });
    expect(at(showdown(), 'host')).toEqual({ kind: 'result', playerId: 'host', mine: true });
    expect(at(showdown({ results: null, paused: true }), 'bob', true, true)).toEqual({ kind: 'idle', reason: 'held' });
    expect(at(view({ turn: null }), 'bob')).toEqual({ kind: 'idle', reason: 'dealing' });
    expect(at(view({ phase: 'gameOver', turn: null }), 'bob')).toEqual({ kind: 'idle', reason: 'over' });
  });

  it('puts my own cards on the stage whenever I hold some, otherwise the hand in play, then the winner', () => {
    const owner = (v: PokerView, meId: string | null, shown = true) => {
      const table = tableOf(v, meId);
      return stageOwner(focusOf({ view: v, table, outcomesShown: shown, held: false, meId }), table, meId);
    };
    expect(owner(hostTurn(), 'host')).toBe('host');
    // Someone else's turn: my cards stay (theirs are backs), folded or not.
    expect(owner(flop(), 'host')).toBe('host');
    expect(owner(flop(), 'bob')).toBe('bob');
    // Not dealt in (a spectator, a newcomer): the player to act, then the winner, nobody while dealing.
    expect(owner(flop(), 'dave')).toBe('carol');
    expect(owner(showdown(), 'dave')).toBe('host');
    expect(owner(showdown(), 'dave', false)).toBeNull();
    expect(owner(view({ turn: null }), null)).toBeNull();
    expect(stageKind({ kind: 'turn', playerId: 'host', mine: true, next: null })).toBe('mine');
    expect(stageKind({ kind: 'turn', playerId: 'bob', mine: false, next: null })).toBe('turn');
    expect(stageKind({ kind: 'idle', reason: 'dealing' })).toBe('idle');
  });

  it("someone else's turn: no band across the table; the line under the ribbon, their seat's ring and the panel say it", () => {
    const html = render(pkRoom(view({ turn: 'carol', players: { ...view().players, host: seat({ isDealer: true }), carol: seat({ chips: 990, bet: 10, committed: 10, status: 'acting', isTurn: true, lastAction: { kind: 'bigBlind', amount: 10 } }) } })), 'bob', false);
    expect(html).not.toContain('data-testid="spotlight"');
    expect(html).toMatch(/data-testid="table-turn" data-state="turn">[\s\S]*?<span class="tbl-turn__text">Quinn&#x27;s turn<\/span>/);
    const carol = tagsWith(html, 'seat').find((t) => attr(t, 'data-player-id') === 'carol') ?? '';
    expect(attr(carol, 'data-turn')).toBe('true');
    expect(attr(carol, 'data-chips')).toBe('990');
    expect(attr(carol, 'data-bet')).toBe('10');
    // My own hand stays on the stage, with my stake and the dealer button on the left.
    expect(tagsWith(html, 'my-area')).toHaveLength(1);
    expect(attr(tagWith(html, 'hand-stage'), 'data-player-id')).toBe('bob');
    expect(attr(tagWith(html, 'hand-stage'), 'data-kind')).toBe('turn');
    // The panel names them with their face, quietly under the controls.
    expect(html).toContain('tbl-panel__status--who');
    expect(html).toContain('tbl-panel__status--bottom');
  });

  it('gives a narrow tile without room for its cards the stack and the bet pill, and a short one the stack as its badge', () => {
    const css = readFileSync(join(import.meta.dirname, '../../platform/styles/table.css'), 'utf8');
    const short = css.match(/@container tile \(max-height: 91px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(short).toMatch(/grid-template-areas: 'face name total' 'face meta meta';/);
    expect(short).toMatch(/\.tbl-tile--full \.tbl-tile__cards \{\s*display: none;/);
    const narrow = css.match(/@container tile \(max-height: 91px\) and \(max-width: 159px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(narrow).toMatch(/grid-template-areas: 'face name total' 'meta meta meta';/);
    expect(css).toMatch(/@container tile \(max-width: 159px\) \{\s*\.tbl-tile--full \.tbl-tile__tag \{\s*display: none;/);
    // Poker's badge is its stack: hidden while the words fit, shown where the tile is too short for them.
    expect(css).toMatch(/\.tbl-tile--full\.tbl-tile--short-badge \.tbl-tile__total,\s*\.tbl-tile--compact\.tbl-tile--short-badge \.tbl-tile__total \{\s*display: none;/);
    expect(css).toMatch(/@container tile \(max-height: 46px\) \{\s*\.tbl-tile--full\.tbl-tile--short-badge \.tbl-tile__total,\s*\.tbl-tile--compact\.tbl-tile--short-badge \.tbl-tile__total \{\s*display: flex;/);
    const html = render(pkRoom(hostTurn()), 'host');
    for (const tile of tagsWith(html, 'seat')) expect(attr(tile, 'class')).toContain('tbl-tile--short-badge');
    const own = readFileSync(join(import.meta.dirname, 'poker.css'), 'utf8');
    expect(own).toMatch(/@container tile \(max-width: 159px\) \{\s*\.tbl-tile \.pk-dealer \{\s*width: 14px;/);
  });
});

describe('the table keeps its places', () => {
  it('sizes the board and the stage from the screen alone, in the calm table\'s fixed first and last rows', () => {
    const css = readFileSync(join(import.meta.dirname, 'poker.css'), 'utf8');
    expect(css).toMatch(/\.pk-table \{[^}]*--tbl-head-h: calc\(var\(--pk-pot-h\) \+ 8px \+ var\(--pk-board-w\) \* 1\.5 \+ 4px\);/);
    expect(css).toMatch(/\.pk-table \{[^}]*--tbl-stage-h: calc\(var\(--tbl-pill-h\) \* 0\.7 \+ var\(--pk-mine-w\) \* 1\.77 \+ 4px\);/);
    // A crowd never resizes the board or my cards.
    for (const rule of css.match(/[^{}]*tbl-crowd--[^{}]*\{[^}]*\}/g) ?? []) expect(rule).not.toMatch(/--pk-(board|mine)-w/);
    // The board, the pot over it and the deck in the corner: no spotlight, no tray.
    const html = render(pkRoom(view({ turn: 'carol' })), 'bob', false);
    expect(html).not.toContain('tbl-stage--tight');
    expect(attr(tagWith(html, 'discard-tray'), 'class')).toBe('tbl-discard-corner');
    expect(attr(tagWith(html, 'deck'), 'data-remaining')).toBe(String(52 - 3 * 2));
  });

  it('puts the pot beside the board on the shortest phones, the board clear of the deck, so the seats keep the height', () => {
    const css = readFileSync(join(import.meta.dirname, 'poker.css'), 'utf8');
    const short = css.slice(css.indexOf('@media (max-width: 760px) and (max-height: 680px)'));
    expect(short).toMatch(/\.pk-centre \{\s*flex-direction: row;[^}]*padding-right: calc\(var\(--tbl-deck-w\) \* 1\.45\);/);
    expect(short).toMatch(/--tbl-head-h: calc\(var\(--pk-board-w\) \* 1\.5 \+ 4px\);/);
    // The side pots stay on show.
    expect(css).not.toMatch(/\.pk-pot__sides\s*\{\s*display:\s*none/);
    // The banner goes there, so the blinds show by the pot instead (and only there).
    expect(css).toMatch(/\.pk-pot__blinds \{\s*display: none;/);
    expect(short).toMatch(/\.pk-pot__blinds \{\s*display: block;/);
    expect(render(pkRoom(view()), 'bob', false)).toContain('<span class="pk-pot__blinds">Blinds 5/10</span>');
    // The column beside my cards packs into rows there, so the face, the button and the bet stay inside the stage (a 320x568 table once scrolled by 8px).
    expect(short).toMatch(/\.pk \.tbl-stage__owner \{\s*flex-direction: row;\s*flex-wrap: wrap;/);
  });
});

describe('seats and hooks', () => {
  it('seats the table round from the seat after mine, newcomers last', () => {
    const state = pkRoom(view({ order: ['host', 'bob', 'carol'], players: { ...view().players, eve: seat({ status: 'out' }) } }));
    state.players.push(player('eve', { joinOrder: 4 }));
    expect(seatRing(state, state.game as PokerView, 'bob')).toEqual(['carol', 'eve', 'host']);
    expect(seatRing(state, state.game as PokerView, 'dave')).toEqual(['host', 'bob', 'carol', 'eve']);
  });

  it('fits a 23-seat table in the players grid: every other seat as a small tile, the turn ringed and named under the ribbon, a newcomer with no seat yet last', () => {
    const ids = ['host', ...Array.from({ length: 22 }, (_, i) => `p${i}`)];
    const players = Object.fromEntries(ids.map((id) => [id, seat({ isTurn: id === 'p14', status: id === 'p14' ? 'acting' : 'waiting' })]));
    const state = pkRoom(view({ order: ids, turn: 'p14', players: { ...players, late: seat({ chips: 0, status: 'out', waitingForSeat: true }) } }));
    state.players = [...ids, 'late'].map((id, i) => player(id, { joinOrder: i }));
    const html = render(state, 'host');
    const seats = tagsWith(html, 'seat');
    expect(seats).toHaveLength(23);
    expect(seats.filter((t) => attr(t, 'data-turn') === 'true').map((t) => attr(t, 'data-player-id'))).toEqual(['p14']);
    expect(attr(seats[22], 'data-player-id')).toBe('late');
    expect(attr(seats[22], 'data-state')).toBe('no-seat');
    expect(html).toContain('No seat yet');
    // Small tiles leave the cards out: the ring and the line under the ribbon, with the clock, say whose turn it is.
    expect(attr(tagWith(html, 'seats'), 'data-tier')).toBe('small');
    expect(tagsWith(html, 'seat-card')).toHaveLength(0);
    expect(html).toMatch(/data-testid="table-turn" data-state="turn"><span class="tbl-turn__clock">[\s\S]*?<span class="tbl-turn__text">p14&#x27;s turn</);
    const late = render(state, 'late', false);
    expect(textOf(late, 'turn-status')).toBe('Table full. You get the next free seat');
    expect(pokerClient.playerStatus?.(state, player('late'))).toMatchObject({ label: 'No seat yet', tone: 'muted' });
  });

  it('keeps the move that closed the last street on its seat until somebody moves again', () => {
    const html = render(pkRoom(flop({ myCards: KINGS })), 'host');
    const carol = html.match(/data-testid="seat" data-player-id="carol"[\s\S]*?data-testid="seat-line"[^>]*>([^<]*)</)?.[1];
    // It is carol's turn now: her line says so; bob's says he folded.
    expect(carol).toBe('Thinking');
    const later = render(pkRoom(flop({ turn: 'host', players: { ...flop().players, carol: seat({ chips: 990, committed: 10 }) } })), 'bob', false);
    expect(later.match(/data-testid="seat" data-player-id="carol"[\s\S]*?data-testid="seat-line"[^>]*>([^<]*)</)?.[1]).toBe('Check');
  });

  it('reads "Bet amount" and "Bet" while waiting on a flop nobody has bet on, as it will on my turn', () => {
    const html = render(pkRoom(flop({ myCards: KINGS })), 'host');
    expect(html).toContain('>Bet amount<');
    expect(html).not.toContain('>Raise to<');
    expect(attr(tagWith(html, 'action-raise'), 'data-kind')).toBe('bet');
  });
});

describe('settings rows', () => {
  it('gives the host presets and numeric fields for the chips and the blinds, and the sliders for the rest; no clocks', () => {
    const { settings } = pkRoom(view());
    if (!pokerClient.SettingsFields) throw new Error('no settings fields');
    const host = renderToString(createElement(pokerClient.SettingsFields, { settings, patch: () => undefined }));
    const chips = tagWith(host, 'settings-startingChips');
    expect(chips).toContain('type="number"');
    expect(chips).toContain('max="100000"');
    expect(tagWith(host, 'settings-smallBlind-5')).toContain('aria-pressed="true"');
    expect(tagWith(host, 'settings-hands')).toContain('max="100"');
    // A slider's value reads beside it, never on the title row.
    expect(host).toContain('No limit');
    expect(host).not.toContain('setting__value');
    expect(tagWith(host, 'settings-value-hands')).toContain('range-field__value');
    expect(host).not.toMatch(/actSeconds|resultsSeconds|Move time|Results time/);
    expect(host.match(/class="range"/g)).toHaveLength(2);
    expect(blindsIncreaseLabel(0)).toBe('Never');
    expect(blindsIncreaseLabel(1)).toBe('Every hand');
    expect(blindsIncreaseLabel(10)).toBe('Every 10');
    expect(handsLabel(0)).toBe('No limit');
    // A readout is as wide as the longest value its slider can show, whatever it shows now, so the track never changes length.
    expect(longestReadout(0, 50, 1, blindsIncreaseLabel)).toBe('Every hand'.length);
    expect(longestReadout(0, 100, 1, handsLabel)).toBe('No limit'.length);
    expect(tagWith(host, 'settings-value-blindsIncreaseEvery')).toContain('width:calc(10ch + 18px)');
    expect(tagWith(host, 'settings-value-hands')).toContain('width:calc(8ch + 18px)');
  });
});

describe('player-list hooks and the store', () => {
  it('badges the player to act, the dealer and a busted player, and prints the bet or the fold', () => {
    const state = pkRoom(view({ turn: 'bob', players: { ...view().players, host: seat({ isDealer: true, status: 'folded' }), bob: seat({ isTurn: true, status: 'acting', bet: 5 }), carol: seat({ chips: 0, status: 'out', busted: true }) } }));
    const badge = (id: string) => renderToString(createElement('div', null, pokerClient.playerBadge?.(state, player(id))));
    expect(badge('bob')).toContain('player__badge--acting');
    expect(badge('host')).toContain('player__badge--dealer');
    expect(badge('carol')).toContain('player__badge--out');
    const meta = (id: string) => renderToString(createElement('div', null, pokerClient.playerMeta?.(state, player(id))));
    expect(meta('bob')).toContain('bet 5');
    expect(meta('host')).toContain('folded');
    expect(pokerClient.playerClassName?.(state, player('carol'))).toBe('player--out');
  });

  it('forgets the typed amount when the turn moves on, and resets everything back in the lobby and on leave', () => {
    usePlatformStore.getState().handleServerMessage(welcome('host', pkRoom(hostTurn())));
    snapshot(pkRoom(hostTurn()));
    usePokerStore.getState().setRaiseText('80');
    snapshot(pkRoom(hostTurn({ pot: 16 })));
    expect(usePokerStore.getState().raiseText).toBe('80');
    snapshot(pkRoom(view({ turn: 'bob' })));
    expect(usePokerStore.getState().raiseText).toBeNull();
    usePokerStore.getState().openSheet('players');
    snapshot({ ...pkRoom(view()), phase: 'lobby', game: null });
    expect(usePokerStore.getState()).toMatchObject({ sheet: null, table: null });
    usePokerStore.getState().setRaiseText('50');
    pokerClient.onLeave?.();
    expect(usePokerStore.getState().raiseText).toBeNull();
  });
});

describe('a move waiting for its answer', () => {
  const myTurn = () => view({ actions: { ...NO_ACTIONS, canFold: true, canCall: true, callAmount: 10, canRaise: true, minRaiseTo: 20, maxRaiseTo: 1000, canAllIn: true } });

  it('aims each move at the hand and the latest move on the table, and holds every move until the table answers', () => {
    const sent: unknown[] = [];
    vi.spyOn(socket, 'send').mockImplementation((msg: unknown) => {
      sent.push(msg);
      return true;
    });
    render(pkRoom(myTurn()), 'host');
    PA.call(myTurn());
    expect(sent).toEqual([{ t: 'call', hand: 2, move: 2 }]);
    const held = render(pkRoom(myTurn()), 'host');
    for (const id of ['action-fold', 'action-raise', 'action-allin', 'action-call']) expect(disabled(held, id), id).toBe(true);
    expect(attr(tagWith(held, 'action-call'), 'data-sent')).toBe('true');
    // The answer: my call is the latest move now.
    const answered = view({ turn: 'bob', lastMove: { kind: 'call', amount: 10, seq: 3, playerId: 'host', street: 'preflop' } });
    pokerClient.onRoom?.(pkRoom(answered), pkRoom(myTurn()));
    expect(usePokerStore.getState().pending).toBeNull();
    vi.restoreAllMocks();
  });

  it('lets go after a refusal, a rejoin, or PENDING_MS', async () => {
    vi.useFakeTimers();
    const { PENDING_MS } = await import('./store');
    vi.spyOn(socket, 'send').mockReturnValue(true);
    PA.fold(myTurn());
    pokerClient.onError?.('NOT_ALLOWED', 'You cannot check: 10 to call.');
    expect(usePokerStore.getState().pending).toBeNull();
    PA.fold(myTurn());
    pokerClient.onWelcome?.(undefined);
    expect(usePokerStore.getState().pending).toBeNull();
    PA.fold(myTurn());
    vi.advanceTimersByTime(PENDING_MS);
    expect(usePokerStore.getState().pending).toBeNull();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
});
