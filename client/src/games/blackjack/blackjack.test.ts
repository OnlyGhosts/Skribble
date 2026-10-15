/**
 * Blackjack's client module under test: the table model and the animation timeline planned from
 * snapshot diffs (deal order, hits, the reveal inside the server's allowance, the discards, splits,
 * snapping to the truth), the bet arithmetic, the copy, the screen per phase (the panel's lit and
 * dimmed controls, the hidden hole card, split hands with no cap (folding into chips past what fits),
 * the dealer and my hands in fixed places, the settled table during the next
 * betting), the settings rows (no rounds or table limits) and the player-list hooks. Runs in node:
 * browser globals are stubbed, components render through react-dom/server.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { REVEAL_CARD_MS, REVEAL_HOLE_MS, revealAllowanceMs } from '@shared/games/blackjack/cards';
import {
  DEFAULT_BLACKJACK_SETTINGS,
  type BlackjackRoomState,
  type BlackjackView,
  type Card,
  type HandView,
  type LastRoundView,
  type SettledHandView,
} from '@shared/games/blackjack/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { blackjackClient } = await import('./module');
const { useBlackjackStore } = await import('./store');
const { dealOrder, discardedCount, tableOf, totalText, shownTotal } = await import('./lib/table');
const T = await import('./lib/timeline');
const H = await import('./lib/hands');
const { betAmount, betWindow, defaultBet, doubleBet, halfBet, parseBet, suggestedBet } = await import('./lib/bet');
const { panelStatus, roundLabel, ribbonText, payoutText, joinNames, phaseKicker, HOTKEY_HINT } = await import('./lib/text');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

const NOW = Date.now();
const NO_ACTIONS = { canHit: false, canStand: false, canDouble: false, canSplit: false };
const NO_CONTROLS = { canSitOut: false, canDealNow: false, canSkip: false };
const c = (rank: Card['rank'], suit: Card['suit'] = 'S'): Card => ({ rank, suit });

function hand(cards: Card[], overrides: Partial<HandView> = {}): HandView {
  return { cards, total: 0, soft: false, bet: 50, status: 'waiting', doubled: false, fromSplit: false, splitAces: false, ...overrides };
}

function settled(cards: Card[], outcome: SettledHandView['outcome'], payout: number, overrides: Partial<HandView> = {}): SettledHandView {
  return { ...hand(cards, overrides), outcome, payout };
}

const EMPTY_DEALER = { cards: [], holeHidden: true, total: 0, soft: false, blackjack: false };

function view(overrides: Partial<BlackjackView> = {}): BlackjackView {
  return {
    phase: 'betting',
    round: 2,
    order: ['host', 'bob'],
    turn: null,
    waitingFor: ['host', 'bob'],
    dealer: EMPTY_DEALER,
    players: {
      host: { chips: 1000, bet: 0, hands: [], inRound: true, sittingOut: false, bustedOut: false },
      bob: { chips: 300, bet: 0, hands: [], inRound: true, sittingOut: false, bustedOut: false },
    },
    actions: NO_ACTIONS,
    controls: NO_CONTROLS,
    lastRound: null,
    endRequested: false,
    ...overrides,
  };
}

/** The deal in play: the host acts on a pair of eights against the dealer's ten, bob waits with 19. */
function acting(overrides: Partial<BlackjackView> = {}): BlackjackView {
  return view({
    phase: 'acting',
    turn: { playerId: 'host', handIndex: 0 },
    waitingFor: [],
    dealer: { cards: [c('10', 'H')], holeHidden: true, total: 10, soft: false, blackjack: false },
    players: {
      host: { chips: 950, bet: 50, hands: [hand([c('8'), c('8', 'D')], { total: 16, status: 'acting' })], inRound: true, sittingOut: false, bustedOut: false },
      bob: { chips: 280, bet: 20, hands: [hand([c('9'), c('10', 'C')], { total: 19, bet: 20 })], inRound: true, sittingOut: false, bustedOut: false },
    },
    actions: { canHit: true, canStand: true, canDouble: true, canSplit: true },
    ...overrides,
  });
}

/** Round 2 settled: the dealer drew to 22; the host's 19 won 100 back on 50, bob hit to 24 and lost. */
function lastRound(overrides: Partial<LastRoundView> = {}): LastRoundView {
  return {
    round: 2,
    order: ['host', 'bob'],
    dealer: { cards: [c('10', 'H'), c('6', 'C'), c('6', 'D')], holeHidden: false, total: 22, soft: false, blackjack: false },
    hands: {
      host: [settled([c('8'), c('8', 'D'), c('3', 'C')], 'win', 100, { status: 'won' })],
      bob: [settled([c('9'), c('10', 'C'), c('5', 'H')], 'loss', 0, { bet: 20, status: 'bust' })],
    },
    peeked: false,
    revealEndsAt: NOW + 1700,
    ...overrides,
  };
}

/** Round 3 betting with round 2's table still up. */
function nextBetting(overrides: Partial<BlackjackView> = {}): BlackjackView {
  return view({
    round: 3,
    players: {
      host: { chips: 1050, bet: 0, hands: [], inRound: true, sittingOut: false, bustedOut: false },
      bob: { chips: 280, bet: 0, hands: [], inRound: true, sittingOut: false, bustedOut: false },
    },
    lastRound: lastRound(),
    ...overrides,
  });
}

function bjRoom(game: BlackjackView, overrides: Partial<BlackjackRoomState> = {}): BlackjackRoomState {
  return {
    ...room({ gameId: 'blackjack', phase: 'playing', players: [player('host', { name: 'Hana' }), player('bob', { name: 'Pia', joinOrder: 1 }), player('carol', { name: 'Quinn', joinOrder: 2, participating: false })] }),
    settings: { allowMidGameJoin: true, contentMode: 'family', ...DEFAULT_BLACKJACK_SETTINGS },
    game,
    ...overrides,
  } as BlackjackRoomState;
}

function render(state: BlackjackRoomState, meId: string, isHost = meId === 'host'): string {
  usePlatformStore.getState().handleServerMessage(welcome(meId, state));
  usePlatformStore.setState({ connection: 'connected' });
  return renderToString(createElement(blackjackClient.Screen, { room: state, meId, isHost }));
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

beforeEach(() => {
  resetStore();
  useBlackjackStore.getState().reset();
  setLocation('/blackjack/ABCD');
  registerGames(registryOf(blackjackClient));
});

describe('the table model', () => {
  it('is the live round once dealt (the hole card a null), else the last settled round, else nothing', () => {
    expect(tableOf(view())).toBeNull();
    const live = tableOf(acting());
    expect(live?.settled).toBe(false);
    expect(live?.dealer).toEqual([c('10', 'H'), null]);
    expect(live?.hands.host[0].cards).toHaveLength(2);
    const last = tableOf(nextBetting());
    expect(last?.settled).toBe(true);
    expect(last?.round).toBe(2);
    expect(last?.hands.host[0]).toMatchObject({ outcome: 'win', payout: 100 });
    expect(last?.dealer).toHaveLength(3);
  });

  it('orders the cards like a dealer: first cards round the table, the up card, second cards, the hole, then hits, then the draws', () => {
    const table = tableOf(nextBetting());
    if (!table) throw new Error('no table');
    expect(dealOrder(table)).toEqual(['host/0/0/8S', 'bob/0/0/9S', 'd0', 'host/0/1/8D', 'bob/0/1/10C', 'd1', 'host/0/2/3C', 'bob/0/2/5H', 'd2']);
  });

  it('counts the settled round on the felt, not in the discards, until its cards have slid to the tray', () => {
    const settledTable = tableOf(nextBetting());
    const deal3 = tableOf(acting({ round: 3 }));
    // Three cards were swept before round 2; round 2's nine cards are still on the felt.
    expect(discardedCount(3, settledTable, settledTable)).toBe(3);
    // Round 3 is dealt (the store has added round 2's nine) while round 2 slides off: still three in the tray.
    expect(discardedCount(12, deal3, settledTable)).toBe(3);
    // Once they reach the tray, round 2's cards count.
    expect(discardedCount(12, deal3, deal3)).toBe(12);
    expect(discardedCount(0, settledTable, settledTable)).toBe(0);
  });

  it('keeps a count of the cards swept to the discards (the deck itself is endless and shows no count)', () => {
    const store = useBlackjackStore.getState();
    store.applyView(acting(), NOW, true, false);
    expect(useBlackjackStore.getState().swept).toBe(0);
    store.applyView(nextBetting(), NOW, false, false);
    // The same round settling is not a sweep.
    expect(useBlackjackStore.getState().swept).toBe(0);
    store.applyView(acting({ round: 3 }), NOW, false, false);
    expect(useBlackjackStore.getState().swept).toBe(9);
    const html = render(bjRoom(acting({ round: 3 })), 'host');
    expect(tagWith(html, 'shoe')).toContain('aria-label="The shoe"');
    expect(html).not.toContain('tbl-deck__count');
    expect(attr(tagWith(html, 'discard-tray'), 'data-discarded')).toBe('9');
  });

  it('shows soft totals both ways and counts a face-down card for nothing', () => {
    expect(totalText({ total: 17, soft: true })).toBe('7/17');
    expect(totalText({ total: 21, soft: true })).toBe('21');
    expect(totalText({ total: 12, soft: false })).toBe('12');
    expect(shownTotal([c('10'), null])).toEqual({ total: 10, soft: false });
    expect(shownTotal([null])).toBeNull();
  });
});

describe('the animation timeline', () => {
  const plan = (prevView: BlackjackView | null, nextView: BlackjackView, prev = T.EMPTY_TIMELINE, now = NOW) => T.planTimeline(prev, tableOf(prevView), tableOf(nextView), now, false, true);

  it('deals in table order, a card every 150ms, each slide 250ms, the hole card last', () => {
    const tl = plan(view(), acting());
    expect(tl.arrivals['host/0/0/8S']).toBe(NOW);
    expect(tl.arrivals['bob/0/0/9S']).toBe(NOW + 150);
    expect(tl.arrivals.d0).toBe(NOW + 300);
    expect(tl.arrivals['host/0/1/8D']).toBe(NOW + 450);
    expect(tl.arrivals['bob/0/1/10C']).toBe(NOW + 600);
    expect(tl.arrivals.d1).toBe(NOW + 750);
    expect(tl.endsAt).toBe(NOW + 750 + T.DEAL_MS);
    expect(T.holeFlipAt(tl)).toBeNull();
    // Mid-deal only the cards that have landed show.
    expect(T.cardShown(tl, 'd0', NOW + 200)).toBe(false);
    expect(T.cardShown(tl, 'd0', NOW + 300)).toBe(true);
    expect(T.cardMotion(tl, 'd0', NOW + 310)).toBe('deal');
    expect(T.cardMotion(tl, 'd0', NOW + 300 + T.DEAL_MS)).toBeNull();
    expect(T.animating(tl, NOW + 900)).toBe(true);
    expect(T.animating(tl, NOW + 1000)).toBe(false);
    expect(T.nextEvent(tl, NOW + 10)).toBe(NOW + 150);
  });

  it('updates a total pill when a card lands, not when it starts sliding in', async () => {
    const { handOnScreen } = await import('./components/Hand');
    const { dealerOnScreen } = await import('./components/Dealer');
    const tl = plan(view(), acting());
    const table = tableOf(acting());
    if (!table) throw new Error('no table');
    const host = table.hands.host[0];
    // The 8D starts at +450 and lands at +700.
    expect(handOnScreen('host', 0, host, tl, NOW + 500)).toMatchObject({ total: { total: 8 } });
    expect(handOnScreen('host', 0, host, tl, NOW + 500).cards).toHaveLength(2);
    expect(handOnScreen('host', 0, host, tl, NOW + 450 + T.DEAL_MS)).toMatchObject({ total: { total: 16 } });
    expect(dealerOnScreen(table, tl, NOW + 310).map((c) => c.landed)).toEqual([false]);
    expect(dealerOnScreen(table, tl, NOW + 300 + T.DEAL_MS).map((c) => c.landed)).toEqual([true]);
    expect(T.landed(tl, 'host/0/1/8D', NOW + 449 + T.DEAL_MS)).toBe(false);
    expect(T.nextEvent(tl, NOW + 451)).toBe(NOW + 300 + T.DEAL_MS);
  });

  it('slides in one card for a hit, after anything still landing', () => {
    const dealt = plan(view(), acting());
    const hitView = acting({ players: { ...acting().players, host: { ...acting().players.host, hands: [hand([c('8'), c('8', 'D'), c('2', 'C')], { status: 'acting' })] } } });
    const tl = plan(acting(), hitView, dealt, NOW + 2000);
    expect(tl.arrivals['host/0/2/2C']).toBe(NOW + 2000);
    expect(tl.arrivals.d0).toBe(NOW + 300);
    // A snapshot with nothing new keeps the timeline as it is.
    expect(plan(hitView, hitView, tl, NOW + 2100)).toBe(tl);
  });

  it('turns the hole card over, draws the dealer cards 500ms apart and shows the outcomes, all inside the server allowance', () => {
    const dealt = plan(view(), acting());
    const at = NOW + 5000;
    const tl = plan(acting(), nextBetting(), dealt, at);
    // The hits that came with the settle land first, in seat order, then the flip.
    expect(tl.arrivals['host/0/2/3C']).toBe(at);
    expect(tl.arrivals['bob/0/2/5H']).toBe(at + 150);
    expect(T.holeFlipAt(tl)).toBe(at + 400);
    expect(tl.arrivals.d2).toBe(at + 400 + T.FLIP_MS + 100);
    expect(T.holeFaceDown(tl, at + 100)).toBe(true);
    expect(T.holeFlipping(tl, at + 450)).toBe(true);
    expect(T.outcomesShown(tl, at + 1000)).toBe(false);
    expect(T.outcomesAt(tl)).not.toBeNull();
    expect(T.outcomesShown(tl, T.outcomesAt(tl) ?? 0)).toBe(true);
    expect((T.outcomesAt(tl) ?? 0) - at).toBeLessThanOrEqual(revealAllowanceMs(3));
    expect(REVEAL_HOLE_MS + REVEAL_CARD_MS).toBe(revealAllowanceMs(3));
  });

  it('clears the last round to the discards before the next deal, once its outcomes have been up a moment', () => {
    const dealt = plan(view(), acting());
    const revealed = plan(acting(), nextBetting(), dealt, NOW + 5000);
    const outcomesAt = T.outcomesAt(revealed) ?? 0;
    const deal3 = acting({ round: 3, players: { host: { chips: 1000, bet: 50, hands: [hand([c('2'), c('3')], { status: 'acting' })], inRound: true, sittingOut: false, bustedOut: false }, bob: { chips: 260, bet: 20, hands: [hand([c('4'), c('5')])], inRound: true, sittingOut: false, bustedOut: false } } });
    const tl = plan(nextBetting(), deal3, revealed, outcomesAt + 100);
    expect(tl.discard?.from).toBe(outcomesAt + T.OUTCOME_HOLD_MS);
    expect(tl.discard?.until).toBe(outcomesAt + T.OUTCOME_HOLD_MS + T.DISCARD_MS);
    expect(tl.arrivals['host/0/0/2S']).toBe(tl.discard?.until);
    const during = T.frameAt(tl, tableOf(deal3), outcomesAt + T.OUTCOME_HOLD_MS + 10);
    expect(during.leaving).toBe(true);
    expect(during.table?.round).toBe(2);
    expect(T.frameAt(tl, tableOf(deal3), (tl.discard?.until ?? 0) + 1).table?.round).toBe(3);
  });

  it('moves the split card instead of dealing it, and deals the two new cards once it is in place', () => {
    const before = acting();
    const after = acting({
      players: {
        ...before.players,
        host: { chips: 900, bet: 50, hands: [hand([c('8'), c('3', 'H')], { status: 'acting', fromSplit: true }), hand([c('8', 'D'), c('K', 'C')], { fromSplit: true })], inRound: true, sittingOut: false, bustedOut: false },
      },
    });
    const tl = plan(before, after, plan(view(), before), NOW + 3000);
    expect(tl.moved['host/1/0/8D']).toBe(true);
    expect(tl.arrivals['host/1/0/8D']).toBe(NOW + 3000);
    expect(tl.arrivals['host/0/1/3H']).toBe(NOW + 3000 + T.MOVE_MS);
    expect(tl.arrivals['host/1/1/KC']).toBe(NOW + 3000 + T.MOVE_MS + T.DEAL_GAP_MS);
  });

  it('snaps to the truth on a fresh entry, under reduced motion and when it would run far behind', () => {
    const fresh = T.planTimeline(T.EMPTY_TIMELINE, null, tableOf(acting()), NOW, true, true);
    expect(fresh.arrivals).toEqual({});
    expect(fresh.id).toBe(2);
    const still = T.planTimeline(T.EMPTY_TIMELINE, tableOf(view()), tableOf(acting()), NOW, false, false);
    expect(still.arrivals).toEqual({});
    const backlog = { ...plan(view(), acting()), endsAt: NOW + T.MAX_BACKLOG_MS + 1 };
    const hitView = acting({ players: { ...acting().players, host: { ...acting().players.host, hands: [hand([c('8'), c('8', 'D'), c('2', 'C')])] } } });
    expect(plan(acting(), hitView, backlog).arrivals).toEqual({});
  });

  it('is planned by the module from each snapshot, and a welcome shows the table at once', () => {
    const me = 'bob';
    const state = bjRoom(view());
    usePlatformStore.getState().handleServerMessage(welcome(me, state));
    blackjackClient.onRoom?.(state, null);
    const dealt = bjRoom(acting());
    blackjackClient.onRoom?.(dealt, state);
    const tl = useBlackjackStore.getState().timeline;
    expect(Object.keys(tl.arrivals)).toHaveLength(6);
    blackjackClient.onRoom?.(dealt, null);
    expect(useBlackjackStore.getState().timeline.arrivals).toEqual({});
    // A reconnect: a welcome with the old room still in the store snaps too.
    blackjackClient.onRoom?.(state, dealt);
    blackjackClient.onWelcome?.(undefined);
    blackjackClient.onRoom?.(dealt, state);
    expect(useBlackjackStore.getState().timeline.arrivals).toEqual({});
  });
});

describe('sounds under reduced motion', () => {
  it('snaps the table but keeps the deal, the hole card flip and the collect on the sound timeline', async () => {
    const { blackjackSounds } = await import('./sounds');
    const { playBlackjackSounds } = await import('./sfx');
    vi.useFakeTimers();
    try {
      const play = vi.spyOn(blackjackSounds, 'play');
      const store = useBlackjackStore.getState();
      const steps = [view(), acting(), nextBetting()];
      store.applyView(steps[0], Date.now(), false, false);
      for (let i = 1; i < steps.length; i++) {
        const { soundTimeline: before, table: prevTable } = useBlackjackStore.getState();
        useBlackjackStore.getState().applyView(steps[i], Date.now(), false, false);
        const { timeline, soundTimeline, table } = useBlackjackStore.getState();
        expect(timeline.arrivals).toEqual({});
        playBlackjackSounds({ view: steps[i], prevView: steps[i - 1], table, prevTable, before, timeline: soundTimeline, me: 'host' });
        vi.advanceTimersByTime(5000);
      }
      // The schedule reads the real clock while these plans were made on the faked one: let everything due run.
      vi.advanceTimersByTime(20_000);
      const names = play.mock.calls.map(([name]) => name);
      expect(names.filter((n) => n === 'deal').length).toBeGreaterThanOrEqual(6);
      expect(names).toContain('flip');
      expect(names).toContain('collect');
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});

describe('the bet amount', () => {
  it('takes anything from 1 chip to the whole stack, remembers the last bet and walks with 1/2, 2x and MAX', () => {
    const w = betWindow(300, 0);
    expect(w).toEqual({ min: 1, max: 300 });
    // A stake already down counts as available; no chips at all means no bet.
    expect(betWindow(250, 50)).toEqual({ min: 1, max: 300 });
    expect(betWindow(0, 0)).toBeNull();
    expect(betWindow(1, 0)).toEqual({ min: 1, max: 1 });
    if (!w) throw new Error('no window');
    expect(suggestedBet(1000)).toBe(10);
    expect(suggestedBet(100_000)).toBe(1000);
    expect(suggestedBet(50)).toBe(1);
    expect(defaultBet(null, w, suggestedBet(1000))).toBe(10);
    expect(defaultBet(null, w)).toBe(1);
    expect(defaultBet(800, w, 10)).toBe(300);
    expect(halfBet(15, w)).toBe(7);
    expect(halfBet(1, w)).toBe(1);
    expect(doubleBet(200, w)).toBe(300);
    expect(parseBet('')).toBeNull();
    expect(parseBet('12a')).toBeNull();
    expect(parseBet('0')).toBeNull();
    expect(betAmount('9999', w)).toBe(300);
    expect(betAmount('3', w)).toBe(3);
    expect(betAmount('1', w)).toBe(1);
  });
});

describe('copy', () => {
  it('says whose turn it is in the panel', () => {
    const base = { phase: 'acting' as const, seated: true, bustedOut: false, connected: true, inRound: true, hasChips: true, betPlaced: true, sittingOut: false, pending: [], myTurn: false, turnName: 'Pia', handIndex: 0, handCount: 1, dealerPlaying: false };
    expect(panelStatus(base).text).toBe("Pia's turn");
    expect(panelStatus({ ...base, myTurn: true }).text).toBe('Your turn');
    expect(panelStatus({ ...base, myTurn: true, handIndex: 1, handCount: 3 }).text).toBe('Your turn, hand 2 of 3');
    expect(panelStatus({ ...base, phase: 'betting', betPlaced: false }).text).toBe('Place your bet');
    expect(panelStatus({ ...base, phase: 'betting', betPlaced: false, sittingOut: true })).toMatchObject({ state: 'sat-out', text: 'You sit this hand out' });
    expect(panelStatus({ ...base, phase: 'betting', pending: ['Pia', 'Quinn'] }).text).toBe('Waiting for Pia and Quinn');
    // A big table counts the stragglers rather than naming them all.
    expect(panelStatus({ ...base, phase: 'betting', pending: ['A', 'B', 'C', 'D'] }).text).toBe('Waiting for 4 players');
    // Not dealt in: a seat with chips sat the hand out, a newcomer waits for the next round.
    expect(panelStatus({ ...base, inRound: false })).toMatchObject({ state: 'next-round', text: 'You sit this hand out' });
    expect(panelStatus({ ...base, inRound: false, hasChips: false }).text).toBe("You're in from the next round");
    expect(panelStatus({ ...base, phase: 'betting', dealerPlaying: true }).text).toBe("Dealer's turn");
    expect(panelStatus({ ...base, bustedOut: true }).state).toBe('out');
    expect(panelStatus({ ...base, seated: false }).state).toBe('spectating');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('labels the rounds, the ribbon and the payouts', () => {
    expect(roundLabel(4)).toBe('Round 4');
    expect(roundLabel(0)).toBe('Round 1');
    expect(ribbonText('3:2')).toBe('BLACKJACK PAYS 3 TO 2');
    expect(ribbonText('6:5')).toBe('BLACKJACK PAYS 6 TO 5');
    expect(payoutText(220)).toBe('+220');
    expect(payoutText(0)).toBe('');
    expect(phaseKicker(acting({ endRequested: true }), 'Pia', false)).toBe('Last hand');
  });

  it("says it is the dealer's turn in the top bar and holds every seat line while the reveal still plays", async () => {
    const { seatLine } = await import('./components/Seats');
    const next = nextBetting();
    expect(phaseKicker(next, 'Pia', false)).toBe('Place your bets');
    expect(phaseKicker(next, 'Pia', false, true)).toBe("Dealer's turn");
    expect(phaseKicker(view({ phase: 'held' }), 'Pia', false, true)).toBe('Waiting for players');
    const bobHands = tableOf(next)?.hands.bob ?? [];
    expect(seatLine(next, 'bob', bobHands, false, true)).toMatchObject({ state: 'waiting', text: 'Waiting' });
    expect(seatLine(next, 'bob', bobHands, false, false)).toMatchObject({ state: 'betting', text: 'Betting' });
    expect(seatLine(next, 'bob', bobHands, true, false)).toMatchObject({ state: 'settled', text: 'Lost' });
  });

  it('shows the chips won on a win, but no amount on a push (the stake only comes back)', async () => {
    const { seatLine } = await import('./components/Seats');
    const next = nextBetting();
    const bobHands = tableOf(next)?.hands.bob ?? [];
    expect(bobHands.length).toBeGreaterThan(0);
    const settle = (outcome: 'win' | 'push', payout: number) => bobHands.map((h) => ({ ...h, outcome, payout }));
    const bet = bobHands[0].bet;
    expect(seatLine(next, 'bob', settle('win', bet * 2), true, false)).toMatchObject({ state: 'settled', text: `Win +${bet * 2}` });
    expect(seatLine(next, 'bob', settle('push', bet), true, false)).toMatchObject({ state: 'settled', text: 'Push' });
  });

  it('says a seat with chips that did not bet is sitting the hand out', async () => {
    const { seatLine } = await import('./components/Seats');
    const satOut = acting({ order: ['host'], players: { ...acting().players, bob: { chips: 300, bet: 0, hands: [], inRound: false, sittingOut: false, bustedOut: false } } });
    expect(seatLine(satOut, 'bob', [], false)).toMatchObject({ state: 'sitting-out', text: 'Sitting out' });
  });

  it("says a seat away during the bets is away, not betting: the deal does not wait for it", async () => {
    const { seatLine, seatMark } = await import('./components/Seats');
    const away = view({ waitingFor: ['host'] });
    const line = seatLine(away, 'bob', [], false);
    expect(line).toMatchObject({ state: 'away', text: 'Away' });
    expect(seatMark(line, [], false)).toBe('idle');
    expect(seatLine(view(), 'bob', [], false)).toMatchObject({ state: 'betting', text: 'Betting' });
  });

  it('names who the bets wait for while it fits a small phone, and counts them once it would not', async () => {
    const { waitingText, betsLabel } = await import('./lib/text');
    expect(waitingText(['Pia'])).toBe('Waiting for Pia');
    expect(waitingText(['Bartholomew'])).toBe('Waiting for Bartholomew');
    expect(waitingText(['Pia', 'Quinn'])).toBe('Waiting for Pia and Quinn');
    expect(waitingText(['Pia', 'Quinn', 'Ada'])).toBe('Waiting for Pia, Quinn and Ada');
    expect(waitingText(['Bartholomew', 'Christabel'])).toBe('Waiting for 2 players');
    expect(waitingText(['A', 'B', 'C', 'D'])).toBe('Waiting for 4 players');
    expect(betsLabel(false, ['Bartholomew', 'Christabel'], true)).toBe('Waiting for 2 players');
    const base = { phase: 'betting' as const, seated: true, bustedOut: false, connected: true, inRound: true, hasChips: true, betPlaced: true, sittingOut: false, myTurn: false, turnName: 'Pia', handIndex: 0, handCount: 1, dealerPlaying: false };
    expect(panelStatus({ ...base, pending: ['Bartholomew', 'Christabel'] }).text).toBe('Waiting for 2 players');
  });

  it('says the next round is coming through the results pause', () => {
    const results = nextBetting({ phase: 'results', round: 2, order: [], waitingFor: [] });
    expect(phaseKicker(results, 'Pia', false)).toBe('Next round soon');
    expect(phaseKicker(results, 'Pia', false, true)).toBe("Dealer's turn");
    const base = { phase: 'results' as const, seated: true, bustedOut: false, connected: true, inRound: false, hasChips: true, betPlaced: false, sittingOut: false, pending: [], myTurn: false, turnName: '', handIndex: 0, handCount: 0, dealerPlaying: false };
    expect(panelStatus(base)).toMatchObject({ state: 'results', text: 'Next round soon' });
    expect(panelStatus({ ...base, dealerPlaying: true }).text).toBe("Dealer's turn");
    // No bet, sit-out or move is on offer while the settled table is on show.
    const html = render(bjRoom(results), 'host');
    expect(disabled(html, 'place-bet')).toBe(true);
    expect(tagsWith(html, 'sit-out')).toHaveLength(0);
    expect(attr(tagWith(html, 'blackjack-screen'), 'data-phase')).toBe('results');
  });

  it('never shows an em dash or mentions insurance anywhere in the module', () => {
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
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text.includes('\u2014'), file).toBe(false);
      expect(/insurance/i.test(text), file).toBe(false);
    }
    expect(HOTKEY_HINT.includes('\u2014')).toBe(false);
  });
});

describe('the screen', () => {
  it('betting: the four moves are dimmed, Bet is lit with the remembered amount, the table shows two empty slots per side', () => {
    useBlackjackStore.setState({ lastBet: 40 });
    const html = render(bjRoom(view()), 'bob');
    expect(attr(tagWith(html, 'blackjack-screen'), 'data-phase')).toBe('betting');
    for (const id of ['action-hit', 'action-stand', 'action-split', 'action-double']) expect(disabled(html, id)).toBe(true);
    expect(disabled(html, 'place-bet')).toBe(false);
    expect(attr(tagWith(html, 'bet-input'), 'value')).toBe('40');
    expect(attr(tagWith(html, 'bet-input'), 'inputMode')).toBe('numeric');
    expect(attr(tagWith(html, 'bj-panel'), 'data-max')).toBe('300');
    expect(tagsWith(html, 'dealer-slot')).toHaveLength(2);
    expect(attr(tagWith(html, 'turn-status'), 'data-state')).toBe('bet');
    expect(html).toContain('BLACKJACK PAYS 3 TO 2');
    expect(attr(tagWith(html, 'round-indicator'), 'data-round')).toBe('2');
    expect(html).toContain('Any bet from 1 to 300 chips');
  });

  it('betting after my stake: Bet is dimmed and says so, my bet shows on the table', () => {
    const v = view({ players: { ...view().players, bob: { chips: 280, bet: 20, hands: [], inRound: true, sittingOut: false, bustedOut: false } } });
    const html = render(bjRoom(v), 'bob');
    expect(disabled(html, 'place-bet')).toBe(true);
    expect(attr(tagWith(html, 'place-bet'), 'data-placed')).toBe('true');
    expect(attr(tagWith(html, 'my-bet'), 'data-bet')).toBe('20');
    expect(attr(tagWith(html, 'turn-status'), 'data-state')).toBe('waiting');
  });

  it("puts my next stake under my empty slots, never over the last round's hands still on the table", () => {
    const before = render(bjRoom(nextBetting()), 'host');
    const mine = (html: string) => html.slice(html.indexOf('data-testid="my-area"'), html.indexOf('data-testid="bj-panel"'));
    // Before my bet: my settled hand stays up.
    expect(tagsWith(mine(before), 'card').length).toBeGreaterThan(0);
    expect(tagsWith(before, 'my-bet')).toHaveLength(0);
    const bet = nextBetting({ waitingFor: ['bob'], players: { ...nextBetting().players, host: { chips: 1000, bet: 50, hands: [], inRound: true, sittingOut: false, bustedOut: false } } });
    const html = render(bjRoom(bet), 'host');
    // My bet down: my row moves on to two empty slots with the stake where a hand's stake goes.
    expect(tagsWith(mine(html), 'card')).toHaveLength(0);
    expect(tagsWith(mine(html), 'my-slot')).toHaveLength(2);
    expect(attr(tagWith(html, 'my-bet'), 'data-bet')).toBe('50');
    expect(mine(html)).toMatch(/class="bj-hand__foot"><span class="bj-mine__bet" data-testid="my-bet"/);
    // Bob's settled hand is still on his tile.
    expect(tagsWith(html, 'seat-hand').length).toBeGreaterThan(0);
    const css = readFileSync(fileURLToPath(new URL('./blackjack.css', import.meta.url)), 'utf8');
    expect(css).not.toMatch(/\.bj-mine__bet \{[^}]*position: absolute/);
  });

  it('acting, my turn: Hit and Stand lit, Split and Double as offered, Bet dimmed, the hole card face down with no rank', () => {
    const html = render(bjRoom(acting()), 'host');
    for (const id of ['action-hit', 'action-stand', 'action-split', 'action-double']) expect(disabled(html, id)).toBe(false);
    expect(disabled(html, 'place-bet')).toBe(true);
    expect(attr(tagWith(html, 'action-hit'), 'aria-keyshortcuts')).toBe('H');
    const dealer = tagWith(html, 'dealer-hand');
    expect(attr(dealer, 'data-hole-hidden')).toBe('true');
    const cards = tagsWith(html, 'dealer-card');
    expect(cards).toHaveLength(2);
    expect(attr(cards[1], 'data-face')).toBe('down');
    expect(attr(cards[1], 'data-rank')).toBeUndefined();
    expect(attr(tagWith(html, 'dealer-total'), 'data-testid')).toBe('dealer-total');
    expect(attr(tagWith(html, 'my-hand'), 'data-active')).toBe('true');
    expect(attr(tagWith(html, 'turn-status'), 'data-state')).toBe('my-turn');
    expect(tagWith(html, 'hotkey-hint')).toBeTruthy();
  });

  it("acting, someone else's turn: my moves are dimmed and their seat is lit", () => {
    const v = acting({ actions: NO_ACTIONS });
    const html = render(bjRoom(v), 'bob');
    for (const id of ['action-hit', 'action-stand', 'action-split', 'action-double', 'place-bet']) expect(disabled(html, id)).toBe(true);
    const seat = tagWith(html, 'seat');
    expect(attr(seat, 'data-name')).toBe('Hana');
    expect(attr(seat, 'data-turn')).toBe('true');
    expect(html).toContain('Hana&#x27;s turn');
  });

  it('re-split hands: four hands side by side, the one in play lit, each with its stake and a big total', () => {
    const hands = [
      hand([c('8'), c('3')], { status: 'stood', fromSplit: true }),
      hand([c('8', 'D'), c('10')], { status: 'stood', fromSplit: true }),
      hand([c('8', 'H'), c('2')], { status: 'acting', fromSplit: true }),
      hand([c('8', 'C'), c('9')], { fromSplit: true, bet: 50 }),
    ];
    const v = acting({ turn: { playerId: 'host', handIndex: 2 }, players: { ...acting().players, host: { chips: 800, bet: 50, hands, inRound: true, sittingOut: false, bustedOut: false } }, actions: { canHit: true, canStand: true, canDouble: true, canSplit: false } });
    const html = render(bjRoom(v), 'host');
    expect(attr(tagWith(html, 'my-hands'), 'data-count')).toBe('4');
    const mine = tagsWith(html, 'my-hand');
    expect(mine).toHaveLength(4);
    expect(mine.map((t) => attr(t, 'data-active'))).toEqual(['false', 'false', 'true', 'false']);
    expect(mine.every((t) => attr(t, 'data-bet') === '50')).toBe(true);
    expect(mine.every((t) => attr(t, 'class')?.includes('bj-hand--big'))).toBe(true);
    expect(attr(mine[2], 'class')).toContain('tbl-outline--active');
    expect(disabled(html, 'action-split')).toBe(true);
    expect(html).toContain('Your turn, hand 3 of 4');
    // The spotlight keeps its label short and puts the hand in play under it.
    const spot = html.slice(html.indexOf('data-testid="spotlight"'), html.indexOf('data-testid="seats"'));
    expect(spot).toContain('>Your turn<');
    expect(spot).toContain('Hand 3 of 4');
  });

  it('the next betting keeps the settled table up: the dealer turned over, each hand with its outcome and payout', () => {
    const html = render(bjRoom(nextBetting()), 'host');
    expect(attr(tagWith(html, 'bj-table'), 'data-settled')).toBe('true');
    expect(attr(tagWith(html, 'dealer-hand'), 'data-hole-hidden')).toBe('false');
    expect(tagsWith(html, 'dealer-card')).toHaveLength(3);
    const mine = tagWith(html, 'my-hand');
    expect(attr(mine, 'data-outcome')).toBe('win');
    expect(attr(mine, 'data-payout')).toBe('100');
    // Under my total the outcome and the payout are two pieces, so on a short phone the payout can drop out of the one line there is.
    const myArea = html.slice(html.indexOf('data-testid="my-area"'));
    expect(myArea).toMatch(/data-testid="hand-outcome"[^>]*>Win<\/span><span class="bj-hand__outcome bj-hand__outcome--win">\+100<\/span>/);
    const seat = tagWith(html, 'seat-hand');
    expect(attr(seat, 'data-outcome')).toBe('loss');
    expect(disabled(html, 'place-bet')).toBe(false);
    expect(attr(tagWith(html, 'round-indicator'), 'data-round')).toBe('3');
  });

  it('the rounds never run out and read "Round N"; a spectator watches with everything dimmed', () => {
    const html = render(bjRoom(acting()), 'carol');
    expect(html).toContain('Round 2<');
    expect(attr(tagWith(html, 'turn-status'), 'data-state')).toBe('spectating');
    expect(disabled(html, 'place-bet')).toBe(true);
    expect(disabled(html, 'bet-input')).toBe(true);
  });

  it('gives the host an End game control and, once asked, says the game ends after the hand', () => {
    expect(tagWith(render(bjRoom(acting()), 'host'), 'end-game')).toBeTruthy();
    expect(tagsWith(render(bjRoom(acting()), 'bob', false), 'end-game')).toHaveLength(0);
    expect(tagWith(render(bjRoom(acting({ endRequested: true })), 'host'), 'end-game-requested')).toBeTruthy();
  });
});

describe('the table controls (no clocks)', () => {
  it('offers Sit out beside the status while my bet is still to place, and says so once I sit out', () => {
    const html = render(bjRoom(view({ controls: { ...NO_CONTROLS, canSitOut: true } })), 'bob');
    const sit = tagWith(html, 'sit-out');
    expect(attr(sit, 'aria-label')).toBe('Sit this hand out');
    expect(html).toContain('>Sit out<');
    expect(tagsWith(html, 'deal-now')).toHaveLength(0);
    // Sitting out: Bet stays lit (a bet brings me back in), the status says I sit this one out.
    const out = view({ waitingFor: ['host'], players: { ...view().players, bob: { chips: 300, bet: 0, hands: [], inRound: true, sittingOut: true, bustedOut: false } } });
    const sat = render(bjRoom(out), 'bob');
    expect(tagsWith(sat, 'sit-out')).toHaveLength(0);
    expect(attr(tagWith(sat, 'turn-status'), 'data-state')).toBe('sat-out');
    expect(sat).toContain('>You sit this hand out<');
    expect(disabled(sat, 'place-bet')).toBe(false);
    // Everyone else waits on Hana only; the spotlight counts the bets among those taking part.
    const host = render(bjRoom(out), 'host');
    expect(tagWith(host, 'spot-bets-count')).toBeTruthy();
    expect(host).toContain('0 of 1 bets in');
    expect(attr(tagWith(host, 'spot-bets'), 'data-waiting')).toBe('1');
  });

  it("gives the host Deal now once a bet is down, and Skip on another player's turn, never on their own", () => {
    const bet = view({ waitingFor: ['bob'], controls: { ...NO_CONTROLS, canDealNow: true }, players: { ...view().players, host: { chips: 950, bet: 50, hands: [], inRound: true, sittingOut: false, bustedOut: false } } });
    const html = render(bjRoom(bet), 'host');
    expect(attr(tagWith(html, 'deal-now'), 'aria-label')).toBe('Deal now to everyone who has bet');
    expect(html).toContain('>Waiting for Pia<');
    // The view's controls are the viewer's own: a guest gets none.
    expect(tagsWith(render(bjRoom({ ...bet, controls: NO_CONTROLS }), 'bob'), 'deal-now')).toHaveLength(0);

    const theirs = acting({ turn: { playerId: 'bob', handIndex: 0 }, actions: NO_ACTIONS, controls: { ...NO_CONTROLS, canSkip: true } });
    const skip = tagWith(render(bjRoom(theirs), 'host'), 'skip-turn');
    expect(attr(skip, 'aria-label')).toBe('Stand Pia&#x27;s hand');
    expect(tagsWith(render(bjRoom(acting()), 'host'), 'skip-turn')).toHaveLength(0);
    expect(tagsWith(render(bjRoom(acting({ actions: NO_ACTIONS })), 'bob'), 'skip-turn')).toHaveLength(0);
  });

  it('keeps the status line the same height with or without a control, and never shows a clock', () => {
    for (const html of [render(bjRoom(view()), 'bob'), render(bjRoom(view({ controls: { ...NO_CONTROLS, canSitOut: true } })), 'bob'), render(bjRoom(acting()), 'host')]) {
      expect(html).toContain('tbl-panel__status--slot');
      expect(tagsWith(html, 'timer')).toHaveLength(0);
    }
    const css = readFileSync(fileURLToPath(new URL('../../platform/styles/table.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.tbl-panel__status\.tbl-panel__status--slot \{[^}]*min-height: 30px;/);
    // The pill is short; its tap target reaches 44px.
    expect(css).toMatch(/\.tbl-panel__act \{[^}]*height: 30px;/);
    expect(css).toMatch(/\.tbl-panel__act::after \{[^}]*inset: -7px -4px;/);
  });

  it('sends the new moves to the server', async () => {
    const { socket } = await import('../../platform/net/socket');
    const sent: unknown[] = [];
    const spy = vi.spyOn(socket, 'send').mockImplementation((msg: unknown) => {
      sent.push(msg);
      return true;
    });
    const { sitOut, dealNow, skipTurn } = await import('./actions');
    sitOut();
    dealNow();
    skipTurn({ playerId: 'bob', handIndex: 2 });
    expect(sent).toEqual([{ t: 'sitOutHand' }, { t: 'dealNow' }, { t: 'skip', playerId: 'bob', handIndex: 2 }]);
    spy.mockRestore();
  });

  it('offers a host who has not bet both Sit out and Deal now once a bet is down', () => {
    const bet = view({ waitingFor: ['host'], controls: { canSitOut: true, canDealNow: true, canSkip: false }, players: { ...view().players, bob: { chips: 250, bet: 50, hands: [], inRound: true, sittingOut: false, bustedOut: false } } });
    const html = render(bjRoom(bet), 'host');
    expect(tagsWith(html, 'sit-out')).toHaveLength(1);
    expect(tagsWith(html, 'deal-now')).toHaveLength(1);
    expect(html.indexOf('data-testid="sit-out"')).toBeLessThan(html.indexOf('data-testid="deal-now"'));
    const css = readFileSync(fileURLToPath(new URL('../../platform/styles/table.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.tbl-panel__act \+ \.tbl-panel__act \{[^}]*margin-left: 0;/);
  });

  it('aims Skip at the hand in play and dims it once tapped, so a second tap never stands the next hand', async () => {
    const { TableAction, turnKey, SKIP_REARM_MS } = await import('./components/ControlPanel');
    const { socket } = await import('../../platform/net/socket');
    const sent: unknown[] = [];
    const spy = vi.spyOn(socket, 'send').mockImplementation((msg: unknown) => {
      sent.push(msg);
      return true;
    });
    const theirs = acting({ turn: { playerId: 'bob', handIndex: 1 }, actions: NO_ACTIONS, controls: { ...NO_CONTROLS, canSkip: true } });
    expect(turnKey(theirs)).toBe('2:bob:1');
    expect(turnKey(view())).toBeNull();
    const skipped: string[] = [];
    const element = (skippedKey: string | null) => TableAction({ view: theirs, turnName: 'Pia', skipped: skippedKey, onSkip: (k) => skipped.push(k) });
    const live = element(null);
    expect(renderToString(live)).not.toContain('disabled');
    (live.props as { onClick(): void }).onClick();
    expect(sent).toEqual([{ t: 'skip', playerId: 'bob', handIndex: 1 }]);
    expect(skipped).toEqual(['2:bob:1']);
    // Tapped: dimmed, and a second tap sends nothing.
    const dimmed = element('2:bob:1');
    expect(renderToString(dimmed)).toContain('disabled');
    (dimmed.props as { onClick(): void }).onClick();
    expect(sent).toHaveLength(1);
    expect(SKIP_REARM_MS).toBeGreaterThanOrEqual(500);
    spy.mockRestore();
  });
});

describe('the spotlight', () => {
  const at = async (v: BlackjackView, meId: string | null, opts: { dealerPlaying?: boolean; shown?: boolean } = {}) => {
    const { spotlightSubject } = await import('./lib/spotlight');
    return spotlightSubject({ view: v, table: tableOf(v), dealerPlaying: opts.dealerPlaying ?? false, outcomesShown: opts.shown ?? true, meId });
  };

  it('is on the hand being played, with who plays next (the dealer after the last seat)', async () => {
    expect(await at(acting(), 'bob')).toEqual({ kind: 'turn', playerId: 'host', handIndex: 0, mine: false, next: 'bob' });
    expect(await at(acting(), 'host')).toMatchObject({ kind: 'turn', mine: true, next: 'bob' });
    const last = acting({ turn: { playerId: 'bob', handIndex: 0 } });
    expect(await at(last, 'host')).toEqual({ kind: 'turn', playerId: 'bob', handIndex: 0, mine: false, next: null });
  });

  it('is on the dealer while the reveal plays, then on my outcome until my next bet goes down', async () => {
    expect(await at(nextBetting(), 'host', { dealerPlaying: true, shown: false })).toEqual({ kind: 'dealer' });
    expect(await at(nextBetting(), 'host')).toEqual({ kind: 'result', playerId: 'host' });
    const placed = nextBetting({ waitingFor: ['bob'], players: { ...nextBetting().players, host: { chips: 1000, bet: 50, hands: [], inRound: true, sittingOut: false, bustedOut: false } } });
    expect(await at(placed, 'host')).toEqual({ kind: 'bets', placed: ['host'], waiting: ['bob'] });
    // A watcher has no outcome of their own: the bets.
    expect(await at(nextBetting(), 'carol')).toMatchObject({ kind: 'bets' });
  });

  it('shows who has bet and who we wait for, a hold, and the end', async () => {
    expect(await at(view(), 'bob')).toEqual({ kind: 'bets', placed: [], waiting: ['host', 'bob'] });
    // Everyone sat out: nobody to wait for, nothing dealt.
    expect(await at(view({ waitingFor: [] }), 'bob')).toEqual({ kind: 'bets', placed: [], waiting: [] });
    expect(await at(view({ phase: 'held' }), 'bob')).toEqual({ kind: 'idle', reason: 'held' });
    expect(await at(nextBetting({ phase: 'ending' }), 'host')).toEqual({ kind: 'result', playerId: 'host' });
    expect(await at(nextBetting({ phase: 'ending' }), 'carol')).toEqual({ kind: 'idle', reason: 'over' });
  });

  it("someone else's turn: their hand large in the spotlight with the lime outline, the label and the next player; mine at the bottom", () => {
    const html = render(bjRoom(acting({ actions: NO_ACTIONS })), 'bob');
    const spot = tagWith(html, 'spotlight');
    expect(attr(spot, 'data-kind')).toBe('turn');
    expect(attr(spot, 'data-player-id')).toBe('host');
    expect(spot).toContain('tbl-spot--tone-active');
    expect(html).toContain('tbl-spot__name tbl-spot__name--short">Hana</span><span class="tbl-spot__rest">&#x27;s turn<');
    expect(html).toContain('data-testid="spot-next">Next: <!-- -->You<');
    expect(tagsWith(html, 'spot-hand')).toHaveLength(1);
    expect(tagsWith(html, 'my-hands')).toHaveLength(1);
    // No turn clock: the player in play acts when ready.
    expect(tagsWith(html, 'timer')).toHaveLength(0);
    // The panel names them with their face.
    expect(html).toContain('tbl-panel__status--who');
  });

  it('my turn: the spotlight says so without my cards; my hand is lit where it always is, at the bottom', () => {
    const html = render(bjRoom(acting()), 'host');
    const spot = html.slice(html.indexOf('data-testid="spotlight"'), html.indexOf('data-testid="seats"'));
    expect(attr(tagWith(html, 'spotlight'), 'data-kind')).toBe('mine');
    expect(html).toContain('>Your turn<');
    expect(spot).not.toContain('data-testid="my-hand"');
    expect(spot).not.toContain('data-testid="card"');
    expect(tagsWith(html, 'my-hand')).toHaveLength(1);
    expect(attr(tagWith(html, 'my-hand'), 'data-active')).toBe('true');
    // Top to bottom: the dealer, the spotlight, the players, my hands last.
    const at = (id: string) => html.indexOf(`data-testid="${id}"`);
    expect(at('dealer-area')).toBeLessThan(at('spotlight'));
    expect(at('spotlight')).toBeLessThan(at('seats'));
    expect(at('seats')).toBeLessThan(at('my-area'));
  });

  it("the dealer's play: the dealer's cards stay at the top of the table, the spotlight just says so", () => {
    const me = 'host';
    usePlatformStore.getState().handleServerMessage(welcome(me, bjRoom(acting())));
    // The server is already on the next bets.
    const betting = nextBetting();
    blackjackClient.onRoom?.(bjRoom(acting()), null);
    blackjackClient.onRoom?.(bjRoom(betting), bjRoom(acting()));
    const html = render(bjRoom(betting), me);
    expect(attr(tagWith(html, 'spotlight'), 'data-kind')).toBe('dealer');
    expect(html).toContain('>Dealer&#x27;s turn<');
    expect(html).toContain('>Draws to 17<');
    // No countdown anywhere: the next bets wait for the players.
    expect(tagsWith(html, 'timer')).toHaveLength(0);
    expect(tagsWith(html, 'dealer-hand')).toHaveLength(1);
    expect(html.indexOf('data-testid="dealer-hand"')).toBeLessThan(html.indexOf('data-testid="spotlight"'));
    // My hands stay where they are too.
    expect(tagsWith(html, 'my-area')).toHaveLength(1);
  });

  it('keeps the dealer and my hands in the same place, in the same markup, through every phase', () => {
    const phases: [string, BlackjackView][] = [
      ['betting', view()],
      ['my turn', acting()],
      ["another player's turn", acting({ turn: { playerId: 'bob', handIndex: 0 }, actions: NO_ACTIONS })],
      ['the settled table', nextBetting()],
    ];
    for (const [label, v] of phases) {
      const html = render(bjRoom(v), 'host');
      expect(tagsWith(html, 'dealer-area'), label).toHaveLength(1);
      expect(tagsWith(html, 'my-area'), label).toHaveLength(1);
      expect(attr(tagWith(html, 'dealer-area'), 'class'), label).toBe('bj-dealer');
      expect(attr(tagWith(html, 'my-area'), 'class'), label).toBe('bj-mine tbl-stage__mine');
      // Never inside the spotlight, never the tight side-by-side row.
      const spot = html.slice(html.indexOf('data-testid="spotlight"'), html.indexOf('data-testid="seats"'));
      expect(spot, label).not.toContain('dealer-hand');
      expect(spot, label).not.toContain('my-hand');
      expect(attr(tagWith(html, 'bj-table'), 'class'), label).not.toContain('tbl-stage--no-mine');
    }
  });

  it('sizes the dealer and my hands from the screen alone: fixed rows, and no card size that goes by the players or the phase', () => {
    const css = readFileSync(fileURLToPath(new URL('./blackjack.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.bj-table\.tbl-stage \{[^}]*grid-template-rows: var\(--bj-top-h\) minmax\(0, auto\) minmax\(0, auto\) minmax\(0, 1fr\) var\(--bj-mine-h\);/);
    // A crowd or a tight stage may resize the spotlight, never the dealer's or my cards.
    for (const rule of css.match(/[^{}]*(tbl-crowd--|tbl-stage--tight)[^{}]*\{[^}]*\}/g) ?? []) {
      expect(rule).not.toMatch(/--bj-(dealer|mine)-w|--bj-top-h|--bj-mine-h|--bj-total/);
    }
    // The big totals: half again as big as a tile's pill and bolder, in their own column beside the cards.
    expect(css).toMatch(/\.bj-hand--big \.tbl-pill \{[^}]*font-size: var\(--bj-total-font\);[^}]*\}/);
    expect(css).toMatch(/\.bj-hand--big \{[^}]*grid-template-columns: var\(--bj-total-col\) auto;/);
  });

  it("another player's split hands share the spotlight, with a marker for the hand in play", () => {
    const split = acting({
      turn: { playerId: 'bob', handIndex: 1 },
      actions: NO_ACTIONS,
      players: { ...acting().players, bob: { chips: 260, bet: 20, hands: [hand([c('8'), c('3'), c('10')], { total: 21, status: 'stood', fromSplit: true }), hand([c('8'), c('2'), c('5')], { total: 15, status: 'acting', fromSplit: true })], inRound: true, sittingOut: false, bustedOut: false } },
    });
    const html = render(bjRoom(split), 'host');
    expect(attr(tagWith(html, 'spotlight'), 'class')).toContain('tbl-spot--stack');
    expect(tagsWith(html, 'spot-hand')).toHaveLength(2);
    expect(tagWith(html, 'spot-hands-row')).toContain('style="--hands:2;--fan:3');
    expect(attr(tagWith(html, 'spot-marker'), 'aria-label')).toBe('Hand 2 of 2');
    expect(html).toContain('<span class="bj-spot__marker-word">Hand </span>2 of 2<');
  });

  it('after the settle: my outcome in the spotlight in its colour', () => {
    const html = render(bjRoom(nextBetting()), 'host');
    const spot = tagWith(html, 'spotlight');
    expect(attr(spot, 'data-kind')).toBe('result');
    expect(attr(spot, 'data-outcome')).toBe('win');
    expect(html).toContain('>You win +100<');
    expect(tagsWith(html, 'my-hands')).toHaveLength(1);
  });
});

describe('many hands', () => {

  it('keeps every hand full size while they fit side by side, and how many fit goes by the width', () => {
    // My row at 320, 390 and 1440 wide (less my face): two, two and six full hands.
    expect(H.fullHandsFit(262, H.MIN_FULL_HAND_PX.mine)).toBe(2);
    expect(H.fullHandsFit(320, H.MIN_FULL_HAND_PX.mine)).toBe(2);
    expect(H.fullHandsFit(380, H.MIN_FULL_HAND_PX.mine)).toBe(3);
    expect(H.fullHandsFit(740, H.MIN_FULL_HAND_PX.mine)).toBe(5);
    // Never less than one, however narrow.
    expect(H.fullHandsFit(40, H.MIN_FULL_HAND_PX.mine)).toBe(1);
    expect(H.handSlots(2, 1, 2)).toEqual(['full', 'full']);
    expect(H.handSlots(1, -1, 1)).toEqual(['full']);
  });

  it('folds the hands not in play into chips once there are more than fit; the hand in play stays full size', () => {
    expect(H.handSlots(3, 1, 2)).toEqual(['chip', 'full', 'chip']);
    expect(H.handSlots(12, 0, 2)).toEqual(['full', ...Array(11).fill('chip')]);
    expect(H.handSlots(12, 11, 5).filter((s) => s === 'full')).toHaveLength(1);
    // No hand in play (another player's turn, the settled table): all chips.
    expect(H.handSlots(8, -1, 5)).toEqual(Array(8).fill('chip'));
    // Exactly as many as fit: no chips.
    expect(H.handSlots(5, 2, 5)).toEqual(Array(5).fill('full'));
  });

  it('packs the chips in balanced rows that fit the space, never more rows than allowed', () => {
    expect(H.chipGrid(0, 200, 3)).toEqual({ cols: 0, rows: 0, shown: 0 });
    // 9 chips beside a full hand (about 150px, three rows of room): rows of three.
    expect(H.chipGrid(9, 150, 3)).toEqual({ cols: 3, rows: 3, shown: 9 });
    // Room for all in one row.
    expect(H.chipGrid(4, 300, 3)).toEqual({ cols: 4, rows: 1, shown: 4 });
    // Seven chips over two rows: four and three, not six and one.
    expect(H.chipGrid(7, 200, 2)).toEqual({ cols: 4, rows: 2, shown: 7 });
    // The spotlight's chips (a tile's totals, no stake) may be narrower.
    expect(H.chipGrid(6, 200, 2, H.MIN_CHIP_PX.spot)).toEqual({ cols: 6, rows: 1, shown: 6 });
  });

  it('never narrows a chip below a readable width: once the grid is full, its last slot is a "+N"', () => {
    // 15 chips beside the hand in play on a 320 phone (146 by 53px): two rows of three, five chips and a "+10".
    expect(H.chipGrid(15, 146, H.fitCount(53, H.MIN_CHIP_PX.height))).toEqual({ cols: 3, rows: 2, shown: 5 });
    for (const [chips, width, rows, min] of [[15, 146, 2, H.MIN_CHIP_PX.width], [11, 100, 2, H.MIN_CHIP_PX.width], [6, 40, 2, H.MIN_CHIP_PX.spot], [40, 527, 2, H.MIN_CHIP_PX.width]] as const) {
      const grid = H.chipGrid(chips, width, rows, min);
      expect((width - (grid.cols - 1) * H.CHIP_GAP_PX) / grid.cols, `${chips} in ${width}px`).toBeGreaterThanOrEqual(min);
      expect(grid.rows).toBeLessThanOrEqual(rows);
      // Every hand is a chip or in the "+N".
      expect(grid.shown < chips ? grid.shown + 1 : grid.shown).toBeLessThanOrEqual(grid.cols * grid.rows);
    }
    // My chips' totals are the big totals' size; a chip is wide enough for two digits in it.
    expect(H.MIN_CHIP_PX.width).toBeGreaterThanOrEqual(34);
    const css = readFileSync(fileURLToPath(new URL('./blackjack.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.bj-hands--mine \.bj-chip__total\.tbl-pill \{[^}]*font-size: 1rem;/);
  });

  it('keeps the chips nearest the hand in play when not all fit, a hand still to play first', () => {
    const chips = [0, 1, 2, 3, 5, 6, 7, 8, 9];
    const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);
    expect(sorted(H.chipsShown(chips, 4, 4))).toEqual([2, 3, 5, 6]);
    // A tie goes to the hand still to play.
    expect(sorted(H.chipsShown(chips, 3, 4))).toEqual([3, 5, 6]);
    // No hand in play (the settled table): the first ones.
    expect([...H.chipsShown([0, 1, 2, 3, 4], 2, -1)]).toEqual([0, 1]);
    expect(H.chipsShown([0, 1, 2], 5, 1).size).toBe(3);
  });

  it('folds the hands past the grid into a "+N" that opens every hand in the seat sheet', () => {
    const hands = Array.from({ length: 6 }, (_, i) => hand([c('8'), c('9', 'H')], { status: i === 0 ? 'acting' : 'waiting', fromSplit: true, bet: 10 }));
    const v = acting({ players: { ...acting().players, host: { chips: 800, bet: 10, hands, inRound: true, sittingOut: false, bustedOut: false } } });
    useBlackjackStore.getState().openSeat('host');
    const html = render(bjRoom(v), 'host');
    // My own hands open in the sheet, under "Your hands".
    expect(html).toContain('Your hands');
    expect(tagsWith(html, 'detail-hand')).toHaveLength(6);
  });

  it('renders every hand full on the server render (nothing measured yet), with the hand in play lit', () => {
    const hands = Array.from({ length: 12 }, (_, i) => hand([c('8'), c(i % 2 ? '3' : '9', 'H')], { status: i === 4 ? 'acting' : i < 4 ? 'stood' : 'waiting', fromSplit: true, bet: 10 }));
    const v = acting({ turn: { playerId: 'host', handIndex: 4 }, players: { ...acting().players, host: { chips: 800, bet: 10, hands, inRound: true, sittingOut: false, bustedOut: false } } });
    const html = render(bjRoom(v), 'host');
    expect(attr(tagWith(html, 'my-hands-row'), 'data-chips')).toBe('0');
    expect(tagsWith(html, 'my-hand').map((t) => attr(t, 'data-active')).indexOf('true')).toBe(4);
  });
});

describe('the players grid', () => {
  /** A table of `n` seats, seat p<k> on turn; rendered for p0. */
  function bigTable(n: number, turn: number) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const players = Object.fromEntries(ids.map((id) => [id, { chips: 1000, bet: 10, hands: [hand([c('9'), c('7')], { total: 16, bet: 10 })], inRound: true, sittingOut: false, bustedOut: false }]));
    const big = acting({ order: ids, turn: { playerId: `p${turn}`, handIndex: 0 }, players, actions: NO_ACTIONS });
    return { ...bjRoom(big), players: ids.map((id, i) => player(id, { name: `Seat ${i}`, joinOrder: i })) };
  }

  it('steps the tiles down as the table grows, every other seat in seat order, the seat on turn ringed', () => {
    const cases: [number, string, boolean][] = [
      [2, 'full', true],
      [6, 'compact', false],
      [12, 'small', false],
      [24, 'small', false],
      [25, 'dense', false],
      [50, 'dense', false],
    ];
    for (const [n, tier, cards] of cases) {
      const html = render(bigTable(n, n - 1), 'p0');
      const grid = tagWith(html, 'seats');
      expect(attr(grid, 'data-tier'), `${n} seats`).toBe(tier);
      const tiles = tagsWith(html, 'seat');
      expect(tiles, `${n} seats`).toHaveLength(n - 1);
      expect(tiles.map((t) => attr(t, 'data-player-id'))).toEqual(Array.from({ length: n - 1 }, (_, i) => `p${i + 1}`));
      const turn = tiles.filter((t) => attr(t, 'data-turn') === 'true');
      expect(turn.map((t) => attr(t, 'data-player-id')), `${n} seats`).toEqual([`p${n - 1}`]);
      expect(attr(turn[0], 'aria-current')).toBe('true');
      expect(turn[0]).toContain('tbl-tile--turn');
      expect(tagsWith(html, 'seat-hand').length > 0, `${n} seats: cards on the tiles`).toBe(cards);
      // Every tile shows the total; the seat on turn is the spotlight's too.
      expect(tagsWith(html, 'seat-total')).toHaveLength(n - 1);
      expect(attr(tagWith(html, 'spotlight'), 'data-player-id')).toBe(`p${n - 1}`);
    }
  });

  it('a small tile shows one total for split hands (the hand in play), never "21/15" cut off', async () => {
    const { tileTotal } = await import('./components/Seats');
    const split = acting({ turn: { playerId: 'bob', handIndex: 1 }, players: { ...acting().players, bob: { chips: 980, bet: 10, hands: [hand([c('10'), c('9'), c('2')], { total: 21, status: 'stood', fromSplit: true }), hand([c('10'), c('5')], { total: 15, status: 'acting', fromSplit: true })], inRound: true, sittingOut: false, bustedOut: false } } });
    const hands = tableOf(split)?.hands.bob ?? [];
    const tl = T.snapTimeline(tableOf(split), NOW);
    expect(tileTotal('bob', hands, tl, NOW, true, 1)?.text).toBe('21/15');
    expect(tileTotal('bob', hands, tl, NOW, true, 1, true)?.text).toBe('15');
    // Off turn: the best hand still standing.
    expect(tileTotal('bob', hands, tl, NOW, false, 0, true)?.text).toBe('21');
  });

  it('marks each seat: on turn, still to act, done, bust, a natural, and the outcome once settled', async () => {
    const { seatLine, seatMark } = await import('./components/Seats');
    const v = acting({ order: ['host', 'bob'], turn: { playerId: 'bob', handIndex: 0 } });
    const hostHands = tableOf(v)?.hands.host ?? [];
    expect(seatMark(seatLine(v, 'bob', tableOf(v)?.hands.bob ?? [], false), [], false)).toBe('turn');
    expect(seatMark(seatLine(v, 'host', hostHands, false), hostHands, false)).toBe('done');
    const bust = hostHands.map((h) => ({ ...h, status: 'bust' as const }));
    expect(seatMark({ state: 'done', text: 'Bust', tone: 'quiet' }, bust, false)).toBe('loss');
    const settled = tableOf(nextBetting())?.hands.bob ?? [];
    expect(seatMark(seatLine(nextBetting(), 'bob', settled, true), settled, true)).toBe('loss');
    expect(seatMark(seatLine(view(), 'bob', [], false), [], false)).toBe('waiting');
  });

  it('a settled seat takes its outcome colour; tapping a tile opens its hands in a sheet', () => {
    const html = render(bjRoom(nextBetting()), 'host');
    const bob = tagWith(html, 'seat');
    expect(attr(bob, 'data-result')).toBe('loss');
    expect(bob).toContain('tbl-tile--loss');
    useBlackjackStore.getState().openSeat('bob');
    const open = render(bjRoom(nextBetting()), 'host');
    expect(attr(tagWith(open, 'seat-sheet'), 'aria-label')).toBe('Pia');
    expect(tagsWith(open, 'detail-hand')).toHaveLength(1);
  });
});

describe('settings rows', () => {
  const settings = { allowMidGameJoin: true, contentMode: 'family' as const, ...DEFAULT_BLACKJACK_SETTINGS };
  const fields = (s: typeof settings, canEdit: boolean) => {
    if (!blackjackClient.SettingsFields) throw new Error('no settings fields');
    return renderToString(createElement(blackjackClient.SettingsFields, { settings: s, canEdit, patch: () => undefined }));
  };

  it('has no rounds, minimum or maximum bet, clock or decks rows: any bet up to the stack, until one stack is left, no time limits, an endless deck', () => {
    const host = fields(settings, true);
    for (const id of ['rounds', 'unlimitedRounds', 'minBet', 'maxBet', 'betSeconds', 'actSeconds', 'resultsSeconds', 'decks']) {
      expect(tagsWith(host, `settings-${id}`), id).toHaveLength(0);
      expect(tagsWith(host, `settings-value-${id}`), id).toHaveLength(0);
    }
    expect(tagWith(host, 'settings-startingChips')).toBeTruthy();
    expect(host).toContain('Split any pair, and split again on another pair.');
    expect(host).not.toMatch(/four hands|shoe|reshuffl/i);
  });

  it('shows the defaults read-only to the guests', () => {
    const guest = fields(settings, false);
    for (const id of ['betSeconds', 'actSeconds', 'resultsSeconds']) expect(tagsWith(guest, `settings-value-${id}`), id).toHaveLength(0);
    expect(tagsWith(guest, 'settings-value-decks')).toHaveLength(0);
    expect(tagsWith(guest, 'settings-blackjackPayout')).toHaveLength(0);
  });
});

describe('player-list hooks', () => {
  it('badges the acting player and the busted out, and tags the bets', () => {
    const state = bjRoom(acting());
    const hana = state.players[0];
    expect(renderToString(createElement('div', null, blackjackClient.playerBadge?.(state, hana)))).toContain('Playing their hand');
    expect(blackjackClient.playerClassName?.(state, hana)).toBe('player--acting');
    expect(renderToString(createElement('div', null, blackjackClient.playerMeta?.(state, hana)))).toContain('bet 50');
    const out = bjRoom(view({ players: { ...view().players, bob: { chips: 5, bet: 0, hands: [], inRound: false, sittingOut: false, bustedOut: true } } }));
    expect(blackjackClient.playerClassName?.(out, out.players[1])).toBe('player--out');
    expect(blackjackClient.chatPlaceholder?.(bjRoom(view()), 'bob')).toBe('Bet, then chat…');
  });
});
