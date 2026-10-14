/**
 * Blackjack's client module under test: the table model and the animation timeline planned from
 * snapshot diffs (deal order, hits, the reveal inside the server's allowance, the discards, splits,
 * snapping to the truth), the bet arithmetic, the copy, the screen per phase (the panel's lit and
 * dimmed controls, the hidden hole card, split hands up to four, the settled table during the next
 * betting), the settings rows with Unlimited rounds and the player-list hooks. Runs in node:
 * browser globals are stubbed, components render through react-dom/server.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
const { betAmount, betWindow, defaultBet, doubleBet, halfBet, parseBet } = await import('./lib/bet');
const { panelStatus, roundLabel, ribbonText, payoutText, joinNames, phaseKicker, HOTKEY_HINT } = await import('./lib/text');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

const NOW = Date.now();
const NO_ACTIONS = { canHit: false, canStand: false, canDouble: false, canSplit: false };
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
    totalRounds: 10,
    order: ['host', 'bob'],
    turn: null,
    endsAt: NOW + 20_000,
    dealer: EMPTY_DEALER,
    players: {
      host: { chips: 1000, bet: 0, hands: [], inRound: true, bustedOut: false },
      bob: { chips: 300, bet: 0, hands: [], inRound: true, bustedOut: false },
    },
    actions: NO_ACTIONS,
    lastRound: null,
    endRequested: false,
    shoeRemaining: 280,
    reshuffled: false,
    ...overrides,
  };
}

/** The deal in play: the host acts on a pair of eights against the dealer's ten, bob waits with 19. */
function acting(overrides: Partial<BlackjackView> = {}): BlackjackView {
  return view({
    phase: 'acting',
    turn: { playerId: 'host', handIndex: 0 },
    dealer: { cards: [c('10', 'H')], holeHidden: true, total: 10, soft: false, blackjack: false },
    players: {
      host: { chips: 950, bet: 50, hands: [hand([c('8'), c('8', 'D')], { total: 16, status: 'acting' })], inRound: true, bustedOut: false },
      bob: { chips: 280, bet: 20, hands: [hand([c('9'), c('10', 'C')], { total: 19, bet: 20 })], inRound: true, bustedOut: false },
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
      host: { chips: 1050, bet: 0, hands: [], inRound: true, bustedOut: false },
      bob: { chips: 280, bet: 0, hands: [], inRound: true, bustedOut: false },
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
    // Six decks; three cards went to the tray in round 1, round 2's nine cards are still on the felt.
    expect(discardedCount(6, 300, settledTable, settledTable)).toBe(3);
    // Round 3 is dealt (six cards out of the shoe) while round 2 slides off: still three in the tray.
    expect(discardedCount(6, 294, deal3, settledTable)).toBe(3);
    // Once they reach the tray, round 2's cards count.
    expect(discardedCount(6, 294, deal3, deal3)).toBe(12);
    expect(discardedCount(1, 52, settledTable, settledTable)).toBe(0);
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
    const deal3 = acting({ round: 3, players: { host: { chips: 1000, bet: 50, hands: [hand([c('2'), c('3')], { status: 'acting' })], inRound: true, bustedOut: false }, bob: { chips: 260, bet: 20, hands: [hand([c('4'), c('5')])], inRound: true, bustedOut: false } } });
    const tl = plan(nextBetting(), deal3, revealed, outcomesAt + 100);
    expect(tl.discard?.from).toBe(outcomesAt + T.OUTCOME_HOLD_MS);
    expect(tl.discard?.until).toBe(outcomesAt + T.OUTCOME_HOLD_MS + T.DISCARD_MS);
    expect(tl.arrivals['host/0/0/2S']).toBe(tl.discard?.until);
    const during = T.frameAt(tl, tableOf(deal3), outcomesAt + T.OUTCOME_HOLD_MS + 10);
    expect(during.leaving).toBe(true);
    expect(during.table?.round).toBe(2);
    expect(T.frameAt(tl, tableOf(deal3), (tl.discard?.until ?? 0) + 1).table?.round).toBe(3);
  });

  it('moves the split card instead of dealing it, and deals the two new cards after it', () => {
    const before = acting();
    const after = acting({
      players: {
        ...before.players,
        host: { chips: 900, bet: 50, hands: [hand([c('8'), c('3', 'H')], { status: 'acting', fromSplit: true }), hand([c('8', 'D'), c('K', 'C')], { fromSplit: true })], inRound: true, bustedOut: false },
      },
    });
    const tl = plan(before, after, plan(view(), before), NOW + 3000);
    expect(tl.moved['host/1/0/8D']).toBe(true);
    expect(tl.arrivals['host/1/0/8D']).toBe(NOW + 3000);
    expect(tl.arrivals['host/0/1/3H']).toBe(NOW + 3000);
    expect(tl.arrivals['host/1/1/KC']).toBe(NOW + 3150);
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
  it('stays inside the table limits and the stack, remembers the last bet and walks with 1/2, 2x and MAX', () => {
    const w = betWindow(10, 500, 300, 0);
    expect(w).toEqual({ min: 10, max: 300 });
    expect(betWindow(10, 500, 5, 0)).toBeNull();
    if (!w) throw new Error('no window');
    expect(defaultBet(null, w)).toBe(10);
    expect(defaultBet(800, w)).toBe(300);
    expect(halfBet(15, w)).toBe(10);
    expect(doubleBet(200, w)).toBe(300);
    expect(parseBet('')).toBeNull();
    expect(parseBet('12a')).toBeNull();
    expect(parseBet('0')).toBeNull();
    expect(betAmount('9999', w)).toBe(300);
    expect(betAmount('3', w)).toBe(10);
  });
});

describe('copy', () => {
  it('says whose turn it is in the panel', () => {
    const base = { phase: 'acting' as const, seated: true, bustedOut: false, connected: true, inRound: true, betPlaced: true, pending: [], myTurn: false, turnName: 'Pia', handIndex: 0, handCount: 1, dealerPlaying: false };
    expect(panelStatus(base).text).toBe("Pia's turn");
    expect(panelStatus({ ...base, myTurn: true }).text).toBe('Your turn');
    expect(panelStatus({ ...base, myTurn: true, handIndex: 1, handCount: 3 }).text).toBe('Your turn, hand 2 of 3');
    expect(panelStatus({ ...base, phase: 'betting', betPlaced: false }).text).toBe('Place your bet');
    expect(panelStatus({ ...base, phase: 'betting', pending: ['Pia', 'Quinn'] }).text).toBe('Waiting for Pia and Quinn');
    expect(panelStatus({ ...base, phase: 'betting', dealerPlaying: true }).text).toBe("Dealer's turn");
    expect(panelStatus({ ...base, bustedOut: true }).state).toBe('out');
    expect(panelStatus({ ...base, seated: false }).state).toBe('spectating');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('labels the rounds, the ribbon and the payouts', () => {
    expect(roundLabel(4, 10)).toBe('Round 4 of 10');
    expect(roundLabel(4, 0)).toBe('Round 4');
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
    expect(attr(tagWith(html, 'round-indicator'), 'data-total')).toBe('10');
  });

  it('betting after my stake: Bet is dimmed and says so, my bet shows on the table', () => {
    const v = view({ players: { ...view().players, bob: { chips: 280, bet: 20, hands: [], inRound: true, bustedOut: false } } });
    const html = render(bjRoom(v), 'bob');
    expect(disabled(html, 'place-bet')).toBe(true);
    expect(attr(tagWith(html, 'place-bet'), 'data-placed')).toBe('true');
    expect(attr(tagWith(html, 'my-bet'), 'data-bet')).toBe('20');
    expect(attr(tagWith(html, 'turn-status'), 'data-state')).toBe('waiting');
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

  it('re-split hands: four hands side by side, the one in play lit, each with its stake', () => {
    const hands = [
      hand([c('8'), c('3')], { status: 'stood', fromSplit: true }),
      hand([c('8', 'D'), c('10')], { status: 'stood', fromSplit: true }),
      hand([c('8', 'H'), c('2')], { status: 'acting', fromSplit: true }),
      hand([c('8', 'C'), c('9')], { fromSplit: true, bet: 50 }),
    ];
    const v = acting({ turn: { playerId: 'host', handIndex: 2 }, players: { ...acting().players, host: { chips: 800, bet: 50, hands, inRound: true, bustedOut: false } }, actions: { canHit: true, canStand: true, canDouble: true, canSplit: false } });
    const html = render(bjRoom(v), 'host');
    expect(attr(tagWith(html, 'my-hands'), 'data-count')).toBe('4');
    const mine = tagsWith(html, 'my-hand');
    expect(mine).toHaveLength(4);
    expect(mine.map((t) => attr(t, 'data-active'))).toEqual(['false', 'false', 'true', 'false']);
    expect(mine.every((t) => attr(t, 'data-bet') === '50')).toBe(true);
    expect(disabled(html, 'action-split')).toBe(true);
    expect(html).toContain('Your turn, hand 3 of 4');
  });

  it('the next betting keeps the settled table up: the dealer turned over, each hand with its outcome and payout', () => {
    const html = render(bjRoom(nextBetting()), 'host');
    expect(attr(tagWith(html, 'bj-table'), 'data-settled')).toBe('true');
    expect(attr(tagWith(html, 'dealer-hand'), 'data-hole-hidden')).toBe('false');
    expect(tagsWith(html, 'dealer-card')).toHaveLength(3);
    const mine = tagWith(html, 'my-hand');
    expect(attr(mine, 'data-outcome')).toBe('win');
    expect(attr(mine, 'data-payout')).toBe('100');
    expect(html).toContain('Win +100');
    const seat = tagWith(html, 'seat-hand');
    expect(attr(seat, 'data-outcome')).toBe('loss');
    expect(disabled(html, 'place-bet')).toBe(false);
    expect(attr(tagWith(html, 'round-indicator'), 'data-round')).toBe('3');
  });

  it('unlimited rounds read "Round N"; a spectator watches with everything dimmed', () => {
    const html = render(bjRoom(acting({ totalRounds: 0 })), 'carol');
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

describe('settings rows', () => {
  const settings = { allowMidGameJoin: true, contentMode: 'family' as const, ...DEFAULT_BLACKJACK_SETTINGS };
  const fields = (s: typeof settings, canEdit: boolean) => {
    if (!blackjackClient.SettingsFields) throw new Error('no settings fields');
    return renderToString(createElement(blackjackClient.SettingsFields, { settings: s, canEdit, patch: () => undefined }));
  };

  it('offers Unlimited rounds: a toggle, then "Unlimited" in place of the slider', () => {
    const finite = fields(settings, true);
    expect(tagWith(finite, 'settings-rounds')).toContain('type="range"');
    expect(tagWith(finite, 'settings-unlimitedRounds')).not.toContain('checked');
    const unlimited = fields({ ...settings, rounds: 0 }, true);
    expect(tagsWith(unlimited, 'settings-rounds')).toHaveLength(0);
    expect(unlimited).toMatch(/data-testid="settings-value-rounds"[^>]*>Unlimited</);
    expect(tagWith(unlimited, 'settings-unlimitedRounds')).toContain('checked');
  });

  it('shows the defaults read-only to the guests', () => {
    const guest = fields(settings, false);
    expect(guest).toMatch(/data-testid="settings-value-betSeconds"[^>]*>15s</);
    expect(guest).toMatch(/data-testid="settings-value-actSeconds"[^>]*>20s</);
    expect(guest).toMatch(/data-testid="settings-value-rounds"[^>]*>10</);
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
    const out = bjRoom(view({ players: { ...view().players, bob: { chips: 5, bet: 0, hands: [], inRound: false, bustedOut: true } } }));
    expect(blackjackClient.playerClassName?.(out, out.players[1])).toBe('player--out');
    expect(blackjackClient.chatPlaceholder?.(bjRoom(view()), 'bob')).toBe('Bet, then chat…');
  });
});
