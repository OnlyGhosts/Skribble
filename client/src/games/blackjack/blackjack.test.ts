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
import { BLACKJACK_DEAL, BLACKJACK_REVEAL, revealAllowanceMs } from '@shared/games/blackjack/deal';
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
const { panelStatus, roundLabel, RIBBON_TEXT, DEALER_RULE_TEXT, payoutText, joinNames, phaseKicker, HOTKEY_HINT } = await import('./lib/text');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');
const { tileFigures } = await import('../../platform/table/PlayersGrid');
const P = await import('./lib/pending');
const A = await import('./actions');
const { socket } = await import('../../platform/net/socket');
const { seatLine } = await import('./components/Seats');

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
    away: [],
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
    settings: { contentMode: 'family', ...DEFAULT_BLACKJACK_SETTINGS },
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
const textOf = (html: string, testId: string): string => html.match(new RegExp(`data-testid="${testId}"[^>]*>(?:<span[^>]*>)*([^<]*)<`))?.[1] ?? '';

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
    // The server keeps the table up exactly as long: the hits sliding in (the server counts one slide
    // for the move that settled), then the reveal. The bets open as the outcomes show.
    expect((T.outcomesAt(tl) ?? 0) - (T.holeFlipAt(tl) ?? 0)).toBe(revealAllowanceMs(3));
  });

  it('plays the reveal at the shared pace the server times the results by', () => {
    expect(T.FLIP_MS).toBe(BLACKJACK_REVEAL.flip);
    expect(T.DEALER_GAP_MS).toBe(BLACKJACK_REVEAL.draw);
    expect(T.OUTCOME_DELAY_MS).toBe(BLACKJACK_REVEAL.outcome);
    expect(T.PEEK_PAUSE_MS).toBe(BLACKJACK_REVEAL.peekPause);
    expect(T.DRAW_BEAT_MS).toBe(BLACKJACK_REVEAL.beat);
    expect(T.MOVE_MS).toBe(BLACKJACK_DEAL.move);
    // No draws, then one, two, three: the outcomes show exactly revealAllowanceMs after the flip starts.
    for (const draws of [0, 1, 2, 3]) {
      const dealt = plan(view(), acting());
      const at = NOW + 5000;
      const dealerCards = [c('6'), c('K'), ...[c('2'), c('3'), c('4')].slice(0, draws)];
      const settledView = nextBetting();
      const last = settledView.lastRound;
      if (!last) throw new Error('no last round');
      const withDraws = { ...settledView, lastRound: { ...last, dealer: { ...last.dealer, cards: dealerCards } } };
      const tl = plan(acting(), withDraws, dealt, at);
      expect((T.outcomesAt(tl) ?? 0) - (T.holeFlipAt(tl) ?? 0), `${draws} draws`).toBe(revealAllowanceMs(2 + draws));
    }
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
    // Offline: the line says what the notice above says, a restart included.
    expect(panelStatus({ ...base, connected: false })).toMatchObject({ state: 'offline', text: 'Reconnecting…' });
    expect(panelStatus({ ...base, connected: false, restarting: true })).toMatchObject({ state: 'offline', text: 'Server restarting…' });
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('labels the rounds, the ribbon and the payouts', () => {
    expect(roundLabel(4)).toBe('Round 4');
    expect(roundLabel(0)).toBe('Round 1');
    // Written in sentence case (the banner shows it in capitals), so a screen reader reads words.
    expect(RIBBON_TEXT).toBe('Blackjack pays 3 to 2');
    expect(DEALER_RULE_TEXT).toBe('Dealer stands on 17');
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
    // Once the outcomes are up, Bet is on offer through the pause: the tap waits and goes out as the bets open.
    // No sit-out or move is on offer while the settled table is on show.
    const html = render(bjRoom(results), 'host');
    expect(disabled(html, 'place-bet')).toBe(false);
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
    expect(html).toContain('Blackjack pays 3 to 2');
    expect(html).toContain('Dealer stands on 17');
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

  it("puts my next stake beside my empty slots, never over the last round's hands still on the table", () => {
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
    // The stake is its own labelled pill in the stage's left column, beside my name: never on a card.
    const stake = tagWith(html, 'my-bet');
    expect(attr(stake, 'data-bet')).toBe('50');
    expect(attr(stake, 'class')).toBe('tbl-stake tbl-stake--bet');
    const stage = html.slice(html.indexOf('data-testid="hand-stage"'));
    expect(stage.indexOf('data-testid="my-bet"')).toBeLessThan(stage.indexOf('data-testid="my-area"'));
    expect(html).toMatch(/data-testid="my-bet"[^>]*><span class="tbl-stake__word">Bet<\/span> <span class="tbl-stake__value">50<\/span>/);
    // Bob's settled hand is still on his tile.
    expect(tagsWith(html, 'seat-hand').length).toBeGreaterThan(0);
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
    // A pair of eights against a ten: Split takes the lime, the rest stay secondary; Bet is quiet.
    expect(attr(tagWith(html, 'action-split'), 'data-primary')).toBe('true');
    for (const id of ['action-hit', 'action-stand', 'action-double']) expect(attr(tagWith(html, id), 'data-primary'), id).toBe('false');
    expect(attr(tagWith(html, 'action-split'), 'class')).toContain('btn--primary');
    // Each move carries its small icon after the label.
    expect(html).toMatch(/data-testid="action-hit"[^>]*><span class="tbl-move__label">Hit<\/span><span class="tbl-move__icon" aria-hidden="true"><svg/);
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
    expect(mine.every((t) => attr(t, 'class')?.includes('tbl-hand--big'))).toBe(true);
    expect(attr(mine[2], 'class')).toContain('tbl-hand--active');
    expect(attr(mine[0], 'class')).toContain('tbl-hand--neutral');
    expect(disabled(html, 'action-split')).toBe(true);
    // The line under the banner and the panel both say which hand is in play.
    expect(attr(tagWith(html, 'table-turn'), 'data-state')).toBe('mine');
    expect(html).toMatch(/data-testid="table-turn"[^>]*><span class="tbl-turn__text">Your turn, hand 3 of 4<\/span>/);
    expect(html).toContain('Your turn, hand 3 of 4');
    // The stage's stake is the whole stake on the table, four hands of 50.
    expect(attr(tagWith(html, 'my-bet'), 'data-bet')).toBe('200');
  });

  it('the next betting keeps the settled table up: the dealer turned over, each hand with its outcome and payout', () => {
    const html = render(bjRoom(nextBetting()), 'host');
    expect(attr(tagWith(html, 'bj-table'), 'data-settled')).toBe('true');
    expect(attr(tagWith(html, 'dealer-hand'), 'data-hole-hidden')).toBe('false');
    expect(tagsWith(html, 'dealer-card')).toHaveLength(3);
    const mine = tagWith(html, 'my-hand');
    expect(attr(mine, 'data-outcome')).toBe('win');
    expect(attr(mine, 'data-payout')).toBe('100');
    // The outcome in words beside the pill, every card outlined and the pill in the win colour.
    const myArea = html.slice(html.indexOf('data-testid="my-area"'));
    expect(myArea).toMatch(/<span class="tbl-flag tbl-flag--win"><span data-testid="hand-outcome">Win<\/span> \+100<\/span>/);
    expect(attr(mine, 'class')).toContain('tbl-hand--win');
    expect(myArea).toMatch(/class="tbl-pill tbl-pill--win" data-testid="hand-total"/);
    const seat = tagWith(html, 'seat-hand');
    expect(attr(seat, 'data-outcome')).toBe('loss');
    expect(disabled(html, 'place-bet')).toBe(false);
    expect(attr(tagWith(html, 'round-indicator'), 'data-round')).toBe('3');
  });

  it('the rounds never run out and read "Round N"; a spectator watches with no controls at all', () => {
    const html = render(bjRoom(acting()), 'carol');
    expect(html).toContain('Round 2<');
    expect(attr(tagWith(html, 'turn-status'), 'data-state')).toBe('spectating');
    expect(textOf(html, 'turn-status')).toBe('You&#x27;re watching. You can play the next game.');
    expect(attr(tagWith(html, 'bj-panel'), 'data-watching')).toBe('true');
    for (const id of ['place-bet', 'bet-input', 'action-hit', 'action-stand', 'action-split', 'action-double', 'sit-out', 'deal-now', 'skip-turn']) expect(tagsWith(html, id), id).toHaveLength(0);
    // A seated player keeps the whole panel.
    expect(tagWith(render(bjRoom(acting()), 'bob'), 'bj-panel')).not.toContain('data-watching');
  });

  it('gives the host the platform\'s End game, says it ends after the hand in play, and once asked says so instead', () => {
    expect(tagWith(render(bjRoom(acting()), 'host'), 'end-game')).toBeTruthy();
    expect(tagsWith(render(bjRoom(acting()), 'bob', false), 'end-game')).toHaveLength(0);
    expect(blackjackClient.endGameNote?.(bjRoom(acting()))).toBe('It ends after the hand in play.');
    expect(blackjackClient.endGameNote?.(bjRoom(acting({ phase: 'betting' })))).toBe('Bets on the table go back.');
    expect(blackjackClient.endGameNote?.(bjRoom(acting({ phase: 'results' })))).toBeNull();
    const asked = render(bjRoom(acting({ endRequested: true }), { endRequested: true }), 'host');
    expect(tagWith(asked, 'end-game-requested')).toBeTruthy();
    expect(tagsWith(asked, 'end-game')).toHaveLength(0);
  });
});

describe('the move the panel lights on my turn', () => {
  const all = { canHit: true, canStand: true, canDouble: true, canSplit: true };
  const up = (rank: Card['rank']) => c(rank, 'H');
  it('plays the basic strategy move from my hand and the dealer\'s up card', async () => {
    const { suggestedMove } = await import('./lib/advice');
    expect(suggestedMove([c('8'), c('8', 'D')], up('10'), all)).toBe('split');
    expect(suggestedMove([c('A'), c('A', 'D')], up('6'), all)).toBe('split');
    expect(suggestedMove([c('6'), c('5')], up('10'), all)).toBe('double');
    expect(suggestedMove([c('6'), c('4')], up('6'), all)).toBe('double');
    expect(suggestedMove([c('6'), c('4')], up('A'), all)).toBe('hit');
    expect(suggestedMove([c('10'), c('7')], up('A'), all)).toBe('stand');
    expect(suggestedMove([c('10'), c('6')], up('5'), all)).toBe('stand');
    expect(suggestedMove([c('10'), c('6')], up('9'), all)).toBe('hit');
    expect(suggestedMove([c('10'), c('2')], up('4'), all)).toBe('stand');
    expect(suggestedMove([c('10'), c('2')], up('3'), all)).toBe('hit');
    expect(suggestedMove([c('A'), c('7')], up('9'), all)).toBe('hit');
    expect(suggestedMove([c('A'), c('7')], up('8'), all)).toBe('stand');
    expect(suggestedMove([c('A'), c('8')], up('10'), all)).toBe('stand');
    expect(suggestedMove([c('5'), c('3')], up('7'), all)).toBe('hit');
  });

  it('follows the basic strategy chart for every pair', async () => {
    const { suggestedMove } = await import('./lib/advice');
    const pair = (rank: Card['rank'], dealer: Card['rank']) => suggestedMove([c(rank), c(rank, 'D')], up(dealer), all);
    expect(pair('2', '7')).toBe('split');
    expect(pair('2', '8')).toBe('hit');
    expect(pair('3', '2')).toBe('split');
    expect(pair('4', '5')).toBe('split');
    expect(pair('4', '4')).toBe('hit');
    expect(pair('5', '9')).toBe('double');
    expect(pair('5', '10')).toBe('hit');
    expect(pair('6', '2')).toBe('split');
    expect(pair('6', '7')).toBe('hit');
    expect(pair('7', '7')).toBe('split');
    expect(pair('7', '8')).toBe('hit');
    expect(pair('9', '6')).toBe('split');
    expect(pair('9', '7')).toBe('stand');
    expect(pair('9', '9')).toBe('split');
    expect(pair('9', 'A')).toBe('stand');
    expect(pair('K', '6')).toBe('stand');
    expect(suggestedMove([c('K'), c('Q', 'D')], up('5'), all)).toBe('stand');
    expect(pair('8', 'A')).toBe('split');
    expect(pair('A', 'A')).toBe('split');
  });

  it('doubles a hard 9 to 11 and the soft hands where the chart does, and hits 11 against an ace', async () => {
    const { suggestedMove } = await import('./lib/advice');
    expect(suggestedMove([c('5'), c('4')], up('3'), all)).toBe('double');
    expect(suggestedMove([c('5'), c('4')], up('2'), all)).toBe('hit');
    expect(suggestedMove([c('5'), c('4')], up('7'), all)).toBe('hit');
    expect(suggestedMove([c('6'), c('5')], up('A'), all)).toBe('hit');
    // The casino card (six to eight decks): soft 13 and 14 double against a 5 or 6, soft 15 and 16 against a 4 to 6.
    expect(suggestedMove([c('A'), c('2')], up('5'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('2')], up('4'), all)).toBe('hit');
    expect(suggestedMove([c('A'), c('3')], up('6'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('4')], up('4'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('4')], up('3'), all)).toBe('hit');
    expect(suggestedMove([c('A'), c('5')], up('4'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('6')], up('3'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('6')], up('7'), all)).toBe('hit');
    expect(suggestedMove([c('A'), c('7')], up('3'), all)).toBe('double');
    expect(suggestedMove([c('A'), c('7')], up('2'), all)).toBe('stand');
    expect(suggestedMove([c('A'), c('8')], up('6'), all)).toBe('stand');
  });

  it('turns a double the hand cannot take into Hit, or into Stand on a soft 18', async () => {
    const { suggestedMove } = await import('./lib/advice');
    const noDouble = { ...all, canDouble: false, canSplit: false };
    expect(suggestedMove([c('A'), c('2'), c('4')], up('5'), noDouble)).toBe('hit');
    expect(suggestedMove([c('A'), c('3'), c('4')], up('4'), noDouble)).toBe('stand');
    expect(suggestedMove([c('2'), c('3'), c('6')], up('6'), noDouble)).toBe('hit');
    // Split aces take one card each: only Stand (or a re-split of another ace) is on offer.
    expect(suggestedMove([c('A'), c('5')], up('6'), { ...NO_ACTIONS, canStand: true })).toBe('stand');
  });

  it('falls back to Hit, then Stand, when the play is not on offer, and lights nothing off my turn', async () => {
    const { suggestedMove } = await import('./lib/advice');
    // Double only on the first two cards; a split pair with the chips gone.
    expect(suggestedMove([c('6'), c('5')], up('10'), { ...all, canDouble: false })).toBe('hit');
    expect(suggestedMove([c('8'), c('8', 'D')], up('10'), { ...all, canSplit: false })).toBe('hit');
    expect(suggestedMove([c('8'), c('8', 'D')], up('10'), { ...NO_ACTIONS, canStand: true })).toBe('stand');
    expect(suggestedMove([c('10'), c('9')], up('10'), NO_ACTIONS)).toBeNull();
    expect(suggestedMove([], null, { ...all })).toBe('hit');
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
    // Everyone else waits on Hana only; the line under the banner counts the bets among those taking part.
    const host = render(bjRoom(out), 'host');
    expect(host).toMatch(/data-testid="bets-count">0 of 1 bets in</);
    expect(attr(tagWith(host, 'table-turn'), 'data-state')).toBe('bets');
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
    sitOut(view(), 'host');
    dealNow(view(), 'host');
    skipTurn({ playerId: 'bob', handIndex: 2 }, view(), 'host');
    expect(sent).toEqual([{ t: 'sitOutHand', round: 2 }, { t: 'dealNow', round: 2 }, { t: 'skip', playerId: 'bob', handIndex: 2 }]);
    useBlackjackStore.getState().clearPending();
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
    const element = (skippedKey: string | null) => TableAction({ view: theirs, meId: 'host', turnName: 'Pia', skipped: skippedKey, onSkip: (k) => skipped.push(k) });
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

describe("the table's focus and the stage", () => {
  const at = async (v: BlackjackView, meId: string | null, opts: { dealerPlaying?: boolean; shown?: boolean } = {}) => {
    const { focusOf } = await import('./lib/focus');
    return focusOf({ view: v, table: tableOf(v), dealerPlaying: opts.dealerPlaying ?? false, outcomesShown: opts.shown ?? true, meId });
  };

  it('follows the hand being played, with who plays next (the dealer after the last seat)', async () => {
    expect(await at(acting(), 'bob')).toEqual({ kind: 'turn', playerId: 'host', handIndex: 0, mine: false, next: 'bob' });
    expect(await at(acting(), 'host')).toMatchObject({ kind: 'turn', mine: true, next: 'bob' });
    const last = acting({ turn: { playerId: 'bob', handIndex: 0 } });
    expect(await at(last, 'host')).toEqual({ kind: 'turn', playerId: 'bob', handIndex: 0, mine: false, next: null });
  });

  it('follows the dealer while the reveal plays, then my outcome until my next bet goes down', async () => {
    expect(await at(nextBetting(), 'host', { dealerPlaying: true, shown: false })).toEqual({ kind: 'dealer' });
    expect(await at(nextBetting(), 'host')).toEqual({ kind: 'result', playerId: 'host' });
    const placed = nextBetting({ waitingFor: ['bob'], players: { ...nextBetting().players, host: { chips: 1000, bet: 50, hands: [], inRound: true, sittingOut: false, bustedOut: false } } });
    expect(await at(placed, 'host')).toEqual({ kind: 'bets', placed: ['host'], waiting: ['bob'] });
    // A watcher has no outcome of their own: the bets.
    expect(await at(nextBetting(), 'carol')).toMatchObject({ kind: 'bets' });
  });

  it('follows who has bet and who we wait for, a hold, and the end', async () => {
    expect(await at(view(), 'bob')).toEqual({ kind: 'bets', placed: [], waiting: ['host', 'bob'] });
    // Everyone sat out: nobody to wait for, nothing dealt.
    expect(await at(view({ waitingFor: [] }), 'bob')).toEqual({ kind: 'bets', placed: [], waiting: [] });
    expect(await at(view({ phase: 'held' }), 'bob')).toEqual({ kind: 'idle', reason: 'held' });
    expect(await at(nextBetting({ phase: 'ending' }), 'host')).toEqual({ kind: 'result', playerId: 'host' });
    expect(await at(nextBetting({ phase: 'ending' }), 'carol')).toEqual({ kind: 'idle', reason: 'over' });
  });

  it('says the focus in one short line under the banner, with a quieter second part', async () => {
    const { focusLine } = await import('./lib/text');
    const names: Record<string, string> = { host: 'Hana', bob: 'Pia', carol: 'Quinn' };
    const s = { nameOf: (id: string) => names[id] ?? 'Someone', meId: 'host', handCount: 1 };
    expect(focusLine({ kind: 'turn', playerId: 'host', handIndex: 0, mine: true, next: 'bob' }, s)).toEqual({ state: 'mine', text: 'Your turn', tone: 'go' });
    expect(focusLine({ kind: 'turn', playerId: 'host', handIndex: 1, mine: true, next: null }, { ...s, handCount: 3 }).text).toBe('Your turn, hand 2 of 3');
    expect(focusLine({ kind: 'turn', playerId: 'bob', handIndex: 0, mine: false, next: 'host' }, s)).toEqual({ state: 'turn', text: "Pia's turn", tone: 'other', sub: 'Next: You' });
    expect(focusLine({ kind: 'turn', playerId: 'bob', handIndex: 0, mine: false, next: null }, s).sub).toBe('Next: Dealer');
    expect(focusLine({ kind: 'dealer' }, s)).toEqual({ state: 'dealer', text: "Dealer's turn", tone: 'other', sub: 'Draws to 17' });
    expect(focusLine({ kind: 'bets', placed: ['bob'], waiting: ['host'] }, s)).toEqual({ state: 'bets', text: 'Place your bet', tone: 'go', sub: '1 of 2 bets in' });
    expect(focusLine({ kind: 'bets', placed: ['host'], waiting: ['bob'] }, s).text).toBe('Waiting for Pia');
    expect(focusLine({ kind: 'result', playerId: 'host' }, { ...s, result: { outcome: 'win', back: 100 } })).toEqual({ state: 'result', text: 'You win +100', tone: 'go' });
    expect(focusLine({ kind: 'result', playerId: 'host' }, { ...s, result: { outcome: 'loss', back: 0 } }).tone).toBe('bad');
    expect(focusLine({ kind: 'idle', reason: 'next' }, s).text).toBe('Next round soon');
  });

  it("puts another player's hands on the stage on their turn, mine otherwise; a watcher sees the hand in play", async () => {
    const { stageOwner, stageKind } = await import('./lib/focus');
    const theirs = { kind: 'turn' as const, playerId: 'bob', handIndex: 0, mine: false, next: null };
    expect(stageOwner(theirs, true, 'host')).toBe('bob');
    expect(stageOwner({ ...theirs, playerId: 'host', mine: true }, true, 'host')).toBe('host');
    expect(stageOwner({ kind: 'bets', placed: [], waiting: [] }, true, 'host')).toBe('host');
    expect(stageOwner({ kind: 'dealer' }, false, 'carol')).toBeNull();
    expect(stageOwner(theirs, false, 'carol')).toBe('bob');
    expect(stageKind(theirs)).toBe('turn');
    expect(stageKind({ ...theirs, mine: true })).toBe('mine');
    expect(stageKind({ kind: 'dealer' })).toBe('dealer');
  });

  it("someone else's turn: their hand big on the stage, their name and stake beside it, mine small at the side; no turn banner", () => {
    const html = render(bjRoom(acting({ actions: NO_ACTIONS })), 'bob');
    const stage = tagWith(html, 'hand-stage');
    expect(attr(stage, 'data-kind')).toBe('turn');
    expect(attr(stage, 'data-player-id')).toBe('host');
    expect(tagsWith(html, 'stage-hand')).toHaveLength(1);
    expect(attr(tagWith(html, 'stage-hand'), 'class')).toContain('tbl-hand--active');
    expect(attr(tagWith(html, 'stage-bet'), 'data-bet')).toBe('50');
    expect(html).toContain('<span class="tbl-stage__name">Hana</span>');
    // Mine waits small beside theirs, still a full hand with its total.
    expect(attr(tagWith(html, 'my-area'), 'class')).toBe('bj-mine bj-mine--aside');
    expect(attr(tagWith(html, 'my-hand'), 'class')).toContain('tbl-hand--mini');
    // Whose turn it is: the line under the banner, the seat's ring and the panel; no band across the table.
    expect(html).toMatch(/data-testid="table-turn"[^>]*><span class="tbl-turn__text">Hana&#x27;s turn<\/span><span class="tbl-turn__sub" data-testid="turn-sub">Next: You</);
    expect(tagsWith(html, 'spotlight')).toHaveLength(0);
    expect(html).not.toContain('tbl-spot');
    expect(tagsWith(html, 'timer')).toHaveLength(0);
    expect(html).toContain('tbl-panel__status--who');
  });

  it('my turn: my hand big on the stage and lit; top to bottom the dealer, the banner, the seats, the stage', () => {
    const html = render(bjRoom(acting()), 'host');
    expect(attr(tagWith(html, 'hand-stage'), 'data-kind')).toBe('mine');
    expect(attr(tagWith(html, 'my-area'), 'class')).toBe('bj-mine');
    expect(tagsWith(html, 'my-hand')).toHaveLength(1);
    expect(attr(tagWith(html, 'my-hand'), 'data-active')).toBe('true');
    expect(attr(tagWith(html, 'my-hand'), 'class')).toContain('tbl-hand--big');
    const at = (id: string) => html.indexOf(`data-testid="${id}"`);
    expect(at('dealer-area')).toBeLessThan(at('table-ribbon'));
    expect(at('table-ribbon')).toBeLessThan(at('seats'));
    expect(at('seats')).toBeLessThan(at('hand-stage'));
    // The shoe tucked in the corner, the discards just past the other one.
    expect(attr(tagWith(html, 'shoe'), 'class')).toBe('tbl-deck tbl-deck--corner');
    expect(attr(tagWith(html, 'discard-tray'), 'class')).toBe('tbl-discard-corner');
  });

  it("the dealer's play: the dealer's cards stay at the top of the table, the line under the banner says so", () => {
    const me = 'host';
    usePlatformStore.getState().handleServerMessage(welcome(me, bjRoom(acting())));
    // The server is already on the next bets.
    const betting = nextBetting();
    blackjackClient.onRoom?.(bjRoom(acting()), null);
    blackjackClient.onRoom?.(bjRoom(betting), bjRoom(acting()));
    const html = render(bjRoom(betting), me);
    expect(attr(tagWith(html, 'hand-stage'), 'data-kind')).toBe('dealer');
    expect(html).toContain('>Dealer&#x27;s turn<');
    expect(html).toContain('>Draws to 17<');
    // No countdown anywhere: the next bets wait for the players.
    expect(tagsWith(html, 'timer')).toHaveLength(0);
    expect(tagsWith(html, 'dealer-hand')).toHaveLength(1);
    // My hands stay where they are too.
    expect(tagsWith(html, 'my-area')).toHaveLength(1);
  });

  it('keeps the dealer and the stage in the same place, in the same markup, through every phase', () => {
    const phases: [string, BlackjackView][] = [
      ['betting', view()],
      ['my turn', acting()],
      ["another player's turn", acting({ turn: { playerId: 'bob', handIndex: 0 }, actions: NO_ACTIONS })],
      ['the settled table', nextBetting()],
    ];
    for (const [label, v] of phases) {
      const html = render(bjRoom(v), 'host');
      expect(tagsWith(html, 'dealer-area'), label).toHaveLength(1);
      expect(tagsWith(html, 'hand-stage'), label).toHaveLength(1);
      expect(tagsWith(html, 'my-area'), label).toHaveLength(1);
      expect(attr(tagWith(html, 'dealer-area'), 'class'), label).toBe('bj-dealer');
      expect(attr(tagWith(html, 'hand-stage'), 'class'), label).toMatch(/^tbl-stage tbl-stage--(mine|other)$/);
    }
  });

  it('sizes the dealer and the stage from the screen alone: fixed rows, and no card size that goes by the players or the phase', () => {
    const css = readFileSync(fileURLToPath(new URL('./blackjack.css', import.meta.url)), 'utf8');
    // The calm table's fixed first and last rows (table.css) are the dealer's and the stage's.
    expect(css).toMatch(/\.bj-table \{[^}]*--tbl-head-h: var\(--bj-dealer-h\);\s*--tbl-stage-h: var\(--bj-stage-h\);/);
    expect(render(bjRoom(view()), 'host')).toContain('tbl-felt tbl-felt--calm bj-table');
    // A crowd never resizes the dealer's cards or the stage's.
    for (const rule of css.match(/[^{}]*tbl-crowd--[^{}]*\{[^}]*\}/g) ?? []) {
      expect(rule).not.toMatch(/--bj-(dealer|stage)-(w|h)/);
    }
    // The fan keeps one height however many cards (the step down shrinks past four).
    const table = readFileSync(fileURLToPath(new URL('../../platform/styles/table.css', import.meta.url)), 'utf8');
    expect(table).toMatch(/\.tbl-fan \{[^}]*height: calc\(var\(--tbl-w\) \* 1\.77\);/);
    expect(table).toMatch(/--fan-dy: min\(calc\(var\(--tbl-w\) \* 0\.09\), calc\(var\(--tbl-w\) \* 0\.27 \/ max\(1, var\(--fan, 2\) - 1\)\)\);/);
  });

  it("another player's split hands share the stage, the line under the banner says which is in play", () => {
    const split = acting({
      turn: { playerId: 'bob', handIndex: 1 },
      actions: NO_ACTIONS,
      players: { ...acting().players, bob: { chips: 260, bet: 20, hands: [hand([c('8'), c('3'), c('10')], { total: 21, status: 'stood', fromSplit: true }), hand([c('8'), c('2'), c('5')], { total: 15, status: 'acting', fromSplit: true })], inRound: true, sittingOut: false, bustedOut: false } },
    });
    const html = render(bjRoom(split), 'host');
    expect(tagsWith(html, 'stage-hand')).toHaveLength(2);
    expect(tagWith(html, 'stage-hands-row')).toContain('style="--hands:2;--fan:3');
    expect(html).toContain('>Pia&#x27;s turn, hand 2 of 2<');
  });

  it('after the settle: my outcome on my hand and in the line under the banner, in its colour', () => {
    const html = render(bjRoom(nextBetting()), 'host');
    expect(attr(tagWith(html, 'hand-stage'), 'data-kind')).toBe('result');
    expect(attr(tagWith(html, 'table-turn'), 'class')).toBe('tbl-turn tbl-turn--go');
    expect(html).toContain('>You win +100<');
    expect(tagsWith(html, 'my-hands')).toHaveLength(1);
  });
});

describe('many hands', () => {

  it('keeps every hand full size while they fit side by side, and how many fit goes by the width', () => {
    // The stage's middle at 320, 390 and 1440 wide (less its side columns): two, two and six full hands.
    expect(H.fullHandsFit(160, H.MIN_FULL_HAND_PX.mine)).toBe(2);
    expect(H.fullHandsFit(218, H.MIN_FULL_HAND_PX.mine)).toBe(2);
    expect(H.fullHandsFit(320, H.MIN_FULL_HAND_PX.mine)).toBe(4);
    expect(H.fullHandsFit(508, H.MIN_FULL_HAND_PX.mine)).toBe(6);
    // Mine small at the side of another player's turn: one full hand, the rest as chips.
    expect(H.fullHandsFit(58, H.MIN_FULL_HAND_PX.aside)).toBe(1);
    expect(H.fullHandsFit(120, H.MIN_FULL_HAND_PX.aside)).toBe(1);
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
    // Another player's chips on the stage (a tile's totals) may be narrower.
    expect(H.chipGrid(6, 200, 2, H.MIN_CHIP_PX.stage)).toEqual({ cols: 6, rows: 1, shown: 6 });
  });

  it('never narrows a chip below a readable width: once the grid is full, its last slot is a "+N"', () => {
    // 15 chips beside the hand in play on a 320 phone (146 by 53px): two rows of three, five chips and a "+10".
    expect(H.chipGrid(15, 146, H.fitCount(53, H.MIN_CHIP_PX.height))).toEqual({ cols: 3, rows: 2, shown: 5 });
    for (const [chips, width, rows, min] of [[15, 146, 2, H.MIN_CHIP_PX.width], [11, 100, 2, H.MIN_CHIP_PX.width], [6, 40, 2, H.MIN_CHIP_PX.stage], [40, 527, 2, H.MIN_CHIP_PX.width]] as const) {
      const grid = H.chipGrid(chips, width, rows, min);
      expect((width - (grid.cols - 1) * H.CHIP_GAP_PX) / grid.cols, `${chips} in ${width}px`).toBeGreaterThanOrEqual(min);
      expect(grid.rows).toBeLessThanOrEqual(rows);
      // Every hand is a chip or in the "+N".
      expect(grid.shown < chips ? grid.shown + 1 : grid.shown).toBeLessThanOrEqual(grid.cols * grid.rows);
    }
    // My chips' totals are the big totals' size; a chip is wide enough for two digits in it.
    expect(H.MIN_CHIP_PX.width).toBeGreaterThanOrEqual(34);
    const css = readFileSync(fileURLToPath(new URL('./blackjack.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.bj-hands--mine \.bj-chip__total\.tbl-pill,\s*\.bj-hands--aside \.bj-chip__total\.tbl-pill \{[^}]*font-size: 1rem;/);
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
      // Every tile shows the total, the stack in words and the bet as its own pill; the seat on turn is on the stage too.
      expect(tagsWith(html, 'seat-total')).toHaveLength(n - 1);
      expect(tagsWith(html, 'seat-chips')).toHaveLength(n - 1);
      expect(tagsWith(html, 'seat-bet')).toHaveLength(n - 1);
      expect(attr(tagWith(html, 'hand-stage'), 'data-player-id')).toBe(`p${n - 1}`);
    }
  });

  it('tells the stack and the bet apart on every tile: "1,000 chips" in words, "Bet 10" in its own pill', () => {
    const full = render(bigTable(2, 1), 'p0');
    expect(full).toMatch(/data-testid="seat-chips" data-chips="1000"><span class="tbl-stackcount__value">1,000<\/span> <span class="tbl-stackcount__word">chips<\/span>/);
    expect(full).toMatch(/class="tbl-stake tbl-stake--bet" data-testid="seat-bet" data-bet="10"><span class="tbl-stake__word">Bet<\/span> <span class="tbl-stake__value">10<\/span>/);
    // A compact tile writes the stack in full, with the short form only for a tile too narrow for it.
    const compact = render(bigTable(6, 1), 'p0');
    expect(compact).toMatch(/data-testid="seat-chips" data-chips="1000"><span class="tbl-stackcount__value tbl-figure"><span class="tbl-figure__full">1,000<\/span><span class="tbl-figure__short">1k<\/span><\/span> <span class="tbl-stackcount__word">chips<\/span>/);
    // The panel's line says my stack the same way.
    expect(full).toMatch(/data-testid="my-chips" data-chips="1000" aria-label="Balance 1000 chips"><span class="tbl-stackcount"[^>]*><span class="tbl-stackcount__value">1,000<\/span>/);
  });

  it('never writes 1,040 chips as "1k" on a compact tile, so it cannot read like 1,000', () => {
    const table = bigTable(6, 1);
    const game = table.game;
    if (!game) throw new Error('no game');
    const view = { ...game, players: { ...game.players, p2: { ...game.players.p2, chips: 1040, bet: 1040, hands: [hand([c('9'), c('7')], { total: 16, bet: 1040 })] } } };
    const html = render({ ...table, game: view }, 'p0');
    const tile = html.slice(html.indexOf('data-player-id="p2"'), html.indexOf('data-player-id="p3"'));
    const chips = tagWith(tile, 'seat-chips');
    expect(chips).toContain('data-chips="1040"');
    const full = /<span class="tbl-figure__full">([^<]+)<\/span>/;
    expect(full.exec(tile.slice(tile.indexOf('data-testid="seat-chips"')))?.[1]).toBe('1,040');
    expect(full.exec(tile.slice(tile.indexOf('data-testid="seat-bet"')))?.[1]).toBe('1,040');
    // A full tile has the room: one figure, in full.
    expect(tileFigures('full')).toBe('full');
    expect(tileFigures('compact')).toBe('fit');
    expect(tileFigures('small')).toBe('short');
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
  const settings = { contentMode: 'family' as const, ...DEFAULT_BLACKJACK_SETTINGS };
  const fields = (s: typeof settings) => {
    if (!blackjackClient.SettingsFields) throw new Error('no settings fields');
    return renderToString(createElement(blackjackClient.SettingsFields, { settings: s, patch: () => undefined }));
  };

  it('has the starting chips as its only row: no house rules, rounds, bet limits, clocks or decks', () => {
    const host = fields(settings);
    const retired = ['blackjackPayout', 'dealerHitsSoft17', 'allowDouble', 'allowSplit', 'rounds', 'unlimitedRounds', 'minBet', 'maxBet', 'betSeconds', 'actSeconds', 'resultsSeconds', 'decks'];
    for (const id of retired) expect(tagsWith(host, `settings-${id}`), id).toHaveLength(0);
    expect(tagWith(host, 'settings-startingChips')).toBeTruthy();
    expect(host.match(/data-testid="settings-row-/g)).toHaveLength(1);
    expect(host).not.toMatch(/four hands|shoe|reshuffl|soft 17|6 to 5/i);
  });

  it('renders from a room stored with the retired keys, which it ignores', () => {
    const stored = { ...settings, blackjackPayout: '6:5', dealerHitsSoft17: true, allowDouble: false, allowSplit: false };
    expect(fields(stored)).toBe(fields(settings));
    const html = render(bjRoom(view(), { settings: stored }), 'host');
    expect(html).toContain('Blackjack pays 3 to 2');
    expect(html).toContain('Dealer stands on 17');
  });

  it('echoes no value beside a title: the chosen preset and the field show the chips', () => {
    const host = fields(settings);
    expect(host).not.toContain('setting__value');
    expect(tagsWith(host, 'settings-value-startingChips')).toHaveLength(0);
    expect(attr(tagWith(host, 'settings-startingChips-1000'), 'aria-pressed')).toBe('true');
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
  });
});

describe('a tap waiting for its answer', () => {
  function recordSends(): unknown[] {
    const sent: unknown[] = [];
    vi.spyOn(socket, 'send').mockImplementation((msg: unknown) => {
      sent.push(msg);
      return true;
    });
    return sent;
  }

  it('aims a move at the round, the hand in play and the cards I hold', () => {
    const sent = recordSends();
    expect(P.moveTarget(acting(), 'host')).toEqual({ round: 2, handIndex: 0, cards: 2 });
    A.playMove('hit', acting(), 'host');
    expect(sent).toEqual([{ t: 'hit', round: 2, handIndex: 0, cards: 2 }]);
    vi.restoreAllMocks();
  });

  it('holds every control, the pressed move shown pressed, until a snapshot answers it', () => {
    recordSends();
    A.playMove('hit', acting(), 'host');
    const pending = useBlackjackStore.getState().pending;
    expect(pending).toMatchObject({ kind: 'hit' });
    const html = render(bjRoom(acting()), 'host');
    for (const id of ['action-hit', 'action-stand', 'action-split', 'action-double']) expect(disabled(html, id), id).toBe(true);
    expect(attr(tagWith(html, 'action-hit'), 'data-sent')).toBe('true');
    // The same table again is no answer; my new card is.
    if (!pending) throw new Error('no pending move');
    expect(P.answered(pending, acting(), 'host')).toBe(false);
    const hit = acting({ players: { ...acting().players, host: { ...acting().players.host, hands: [hand([c('8'), c('8', 'D'), c('2')], { total: 18, status: 'acting' })] } } });
    expect(P.answered(pending, hit, 'host')).toBe(true);
    blackjackClient.onRoom?.(bjRoom(hit), bjRoom(acting()));
    expect(useBlackjackStore.getState().pending).toBeNull();
    // Answered: nothing is shown pressed any more (the new card still slides in before the moves light up).
    expect(attr(tagWith(render(bjRoom(hit), 'host'), 'action-hit'), 'data-sent')).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('lets go of the controls on its own after PENDING_MS, on a refusal and on a rejoin', async () => {
    vi.useFakeTimers();
    const { PENDING_MS } = await import('./store');
    recordSends();
    A.playMove('stand', acting(), 'host');
    vi.advanceTimersByTime(PENDING_MS - 1);
    expect(useBlackjackStore.getState().pending).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(useBlackjackStore.getState().pending).toBeNull();
    A.playMove('stand', acting(), 'host');
    blackjackClient.onError?.('NOT_ALLOWED', 'You cannot double this hand.');
    expect(useBlackjackStore.getState().pending).toBeNull();
    A.playMove('stand', acting(), 'host');
    blackjackClient.onWelcome?.(undefined);
    expect(useBlackjackStore.getState().pending).toBeNull();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows Bet placed the moment Bet is tapped, and sends the round with it', () => {
    const sent = recordSends();
    A.placeBet(50, view(), 'host');
    expect(sent).toEqual([{ t: 'bet', amount: 50, round: 2 }]);
    const html = render(bjRoom(view()), 'host');
    expect(textOf(html, 'place-bet')).toBe('Bet placed');
    expect(disabled(html, 'place-bet')).toBe(true);
    expect(attr(tagWith(html, 'place-bet'), 'data-sent')).toBe('true');
    vi.restoreAllMocks();
  });

  it('takes a Bet tapped once the outcomes are up, before the bets open, and sends it as they open', () => {
    const sent = recordSends();
    const results = nextBetting({ phase: 'results', round: 2, order: [], waitingFor: [] });
    A.queueBet(40, results);
    expect(useBlackjackStore.getState().queuedBet).toEqual({ round: 3, amount: 40 });
    expect(textOf(render(bjRoom(results), 'host'), 'place-bet')).toBe('Bet placed');
    expect(sent).toEqual([]);
    // The bets open: it goes out at once, for that round.
    blackjackClient.onRoom?.(bjRoom(nextBetting()), bjRoom(results));
    expect(sent).toEqual([{ t: 'bet', amount: 40, round: 3 }]);
    expect(useBlackjackStore.getState().queuedBet).toBeNull();
    vi.restoreAllMocks();
  });

  it('drops a queued bet the game moved past (it ended instead)', () => {
    const sent = recordSends();
    const results = nextBetting({ phase: 'results', round: 2, order: [], waitingFor: [] });
    render(bjRoom(results), 'host');
    A.queueBet(40, results);
    blackjackClient.onRoom?.(bjRoom(nextBetting({ phase: 'ending', round: 2 })), bjRoom(results));
    expect(useBlackjackStore.getState().queuedBet).toBeNull();
    expect(sent).toEqual([]);
    vi.restoreAllMocks();
  });

  it('takes a Bet tapped while the reveal still plays: one bet goes out at once, or waits for the bets to open', async () => {
    const { betTap } = await import('./components/ControlPanel');
    const sent = recordSends();
    const settled = nextBetting();
    // The reveal is planned from the hand in play to the settled table: the outcomes are not up yet.
    useBlackjackStore.getState().applyView(acting(), Date.now(), true, true);
    useBlackjackStore.getState().applyView(settled, Date.now(), false, true);
    const html = render(bjRoom(settled), 'bob');
    expect(textOf(html, 'turn-status')).toBe('Dealer&#x27;s turn');
    expect(disabled(html, 'place-bet')).toBe(false);
    expect(attr(tagWith(html, 'place-bet'), 'aria-disabled')).toBeUndefined();
    // The server already takes bets: the tap places one now.
    const opts = { canSend: true, held: false, queued: false };
    expect(betTap(settled, 'bob', 50, opts)).toBe('place');
    A.placeBet(50, settled, 'bob');
    expect(sent).toEqual([{ t: 'bet', amount: 50, round: 3 }]);
    expect(textOf(render(bjRoom(settled), 'bob'), 'place-bet')).toBe('Bet placed');
    // A second tap finds Bet held: still one bet.
    expect(betTap(settled, 'bob', 50, { ...opts, held: useBlackjackStore.getState().pending !== null })).toBeNull();
    // Outcomes on the server, bets not open yet: the tap is kept for them.
    const results = nextBetting({ phase: 'results', round: 2, order: [], waitingFor: [] });
    expect(betTap(results, 'host', 40, opts)).toBe('queue');
    expect(betTap(results, 'host', 40, { ...opts, queued: true })).toBeNull();
    // Not on offer at all: on my turn, offline, or with nothing to bet.
    expect(betTap(acting(), 'host', 40, opts)).toBeNull();
    expect(betTap(settled, 'host', 40, { ...opts, canSend: false })).toBeNull();
    expect(betTap(settled, 'host', null, opts)).toBeNull();
    vi.restoreAllMocks();
  });

  it('waits for my own cards only before my moves go, saying Dealing meanwhile', () => {
    const at = Date.now();
    useBlackjackStore.getState().applyView(view(), at, true, true);
    useBlackjackStore.getState().applyView(acting(), at, false, true);
    const { timeline, table } = useBlackjackStore.getState();
    expect(T.myHandLanded(timeline, table, 'host', 0, at)).toBe(false);
    // The host's two cards and the dealer's up card land before bob's second card and the hole card.
    const mine = ['host/0/0/8S', 'd0', 'host/0/1/8D'].map((key) => (timeline.arrivals[key] ?? 0) + T.DEAL_MS);
    const ready = Math.max(...mine);
    expect(T.myHandLanded(timeline, table, 'host', 0, ready)).toBe(true);
    expect(ready).toBeLessThan(timeline.endsAt);
    const base = { phase: 'acting' as const, seated: true, bustedOut: false, connected: true, inRound: true, hasChips: true, betPlaced: true, sittingOut: false, pending: [], myTurn: true, turnName: 'Hana', handIndex: 0, handCount: 1, dealerPlaying: false };
    expect(panelStatus({ ...base, dealing: true })).toMatchObject({ state: 'dealing', text: 'Dealing' });
    expect(panelStatus(base)).toMatchObject({ state: 'my-turn', text: 'Your turn' });
  });

  it('does not hold the next deal for the last outcomes when my own bet dealt it', () => {
    const at = Date.now();
    const store = useBlackjackStore.getState();
    store.applyView(acting(), at, true, true);
    store.applyView(nextBetting(), at, false, true);
    const outcomes = T.outcomesAt(useBlackjackStore.getState().timeline) ?? at;
    recordSends();
    A.placeBet(50, nextBetting(), 'host');
    const deal = acting({ round: 3 });
    useBlackjackStore.getState().applyView(deal, outcomes, false, true);
    expect(useBlackjackStore.getState().timeline.discard?.from).toBe(outcomes);
    vi.restoreAllMocks();
  });

  it('shows a seat the table waits on whose phone went quiet as away, and says so on their turn', () => {
    const quiet = acting({ turn: { playerId: 'bob', handIndex: 0 }, away: ['bob'], controls: { ...NO_CONTROLS, canSkip: true } });
    const html = render(bjRoom(quiet), 'host');
    expect(textOf(html, 'turn-status')).toBe('Pia is away');
    expect(tagsWith(html, 'skip-turn')).toHaveLength(1);
    expect(seatLine(quiet, 'bob', [], false)).toMatchObject({ state: 'away', text: 'Away' });
    expect(seatLine(quiet, 'host', [], false).state).not.toBe('away');
  });
});
