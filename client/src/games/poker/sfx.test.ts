/**
 * Poker's sound wiring against the animation timeline: every card movement (the hole cards dealt
 * to each seat, the flop, turn and river sliding out and turning over, a folded hand going to the
 * muck, the hands turning over at a showdown, the last hand clearing before the next deal) plays a
 * card sound at the moment the table shows it, and cards or chips that move together sound once.
 * The fake clock is installed before the module loads, so the schedule and the planner agree.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, PokerActions, PokerPlayerView, PokerResults, PokerView } from '@shared/games/poker/protocol';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();
vi.useFakeTimers();

const { ONLOOKER_VOLUME } = await import('../../platform/lib/sound');
const { pokerSounds } = await import('./sounds');
const { clearPokerSounds, playPokerSounds } = await import('./sfx');
const { usePokerStore } = await import('./store');
const { settleRevealMs } = await import('@shared/games/poker/reveal');

const START = 1_800_000_000_000;
const c = (text: string): Card => ({ rank: text.slice(0, -1) as Card['rank'], suit: text.slice(-1) as Card['suit'] });
const NO_ACTIONS: PokerActions = { canFold: false, canCheck: false, canCall: false, callAmount: 0, canBet: false, minBet: 0, maxBet: 0, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0, canAllIn: false };
const BOARD = ['KS', '7D', '2C', 'QD', '9H'].map(c);

function seat(over: Partial<PokerPlayerView> = {}): PokerPlayerView {
  return { chips: 990, bet: 0, committed: 10, status: 'waiting', isDealer: false, isTurn: false, lastAction: null, busted: false, waitingForSeat: false, ...over };
}

/** Hand `hand` at the table `ids` (the first has the button), on `street`, `me` holding two kings. */
function view(ids: string[], over: Partial<PokerView> = {}, hand = 1): PokerView {
  return {
    phase: 'acting',
    street: 'preflop',
    hand,
    totalHands: 0,
    blinds: { small: 5, big: 10 },
    dealerId: ids[0],
    community: [],
    pot: 10 * ids.length,
    pots: [],
    order: ids,
    turn: ids[0],
    endsAt: null,
    paused: false,
    players: Object.fromEntries(ids.map((id, i) => [id, seat({ isDealer: i === 0 })])),
    myCards: [c('KH'), c('KC')],
    actions: NO_ACTIONS,
    results: null,
    lastMove: null,
    ...over,
  };
}

const THREE = ['me', 'bob', 'carol'];
const flop = (over: Partial<PokerView> = {}) => view(THREE, { street: 'flop', community: BOARD.slice(0, 3), ...over });

const RESULTS: PokerResults = {
  pots: [{ amount: 30, winners: [{ playerId: 'me', amount: 30 }], handName: 'Three of a kind, kings' }],
  revealed: {
    me: { cards: [c('KH'), c('KC')], category: 'threeOfAKind', name: 'Three of a kind, kings', best: [] },
    bob: { cards: [c('7S'), c('7C')], category: 'threeOfAKind', name: 'Three of a kind, sevens', best: [] },
    carol: { cards: [c('AS'), c('AD')], category: 'pair', name: 'Pair of aces', best: [] },
  },
  uncontested: false,
  net: { me: 20, bob: -10, carol: -10 },
};

type Played = [name: string, at: number, volume: number];
let played: Played[] = [];
let shown: PokerView | null = null;

/** Feeds one snapshot the way the module does: plan the timeline, then schedule its sounds. */
function step(next: PokerView, me = 'me') {
  const before = usePokerStore.getState().soundTimeline;
  usePokerStore.getState().applyView(next, me, Date.now(), false, true);
  const timeline = usePokerStore.getState().soundTimeline;
  playPokerSounds({ view: next, prevView: shown, before, timeline, me });
  shown = next;
  return timeline;
}

/** Starts the table on `first` with no sound (a welcome), everything landed. */
function seed(first: PokerView, me = 'me'): void {
  usePokerStore.getState().reset();
  usePokerStore.getState().applyView(first, me, Date.now(), true, true);
  shown = first;
}

const names = (): string[] => played.map(([name]) => name);
const of = (name: string): Played[] => played.filter(([n]) => n === name);

beforeEach(() => {
  vi.setSystemTime(START);
  clearPokerSounds();
  usePokerStore.getState().reset();
  played = [];
  shown = null;
  vi.spyOn(pokerSounds, 'play').mockImplementation((name, opts) => {
    played.push([name, Date.now(), opts?.volume ?? 1]);
  });
});

describe('Poker sounds follow the cards', () => {
  it('deals a card sound for every hole card as it slides to its seat, mine in full and the others softer', () => {
    const tl = step(view(THREE));
    expect(of('deal')).toEqual([]);
    vi.advanceTimersByTime(5000);
    const arrivals = Object.entries(tl.arrivals).sort((a, b) => a[1] - b[1]);
    expect(arrivals).toHaveLength(6);
    expect(of('deal')).toEqual(arrivals.map(([key, at]) => ['deal', at, key.startsWith('h/me/') ? 1 : ONLOOKER_VOLUME]));
  });

  it('chips once for the blinds going in together', () => {
    step(view(THREE, { pot: 15, players: { me: seat({ isDealer: true, committed: 0 }), bob: seat({ bet: 5, committed: 5 }), carol: seat({ bet: 10, committed: 10 }) } }));
    vi.advanceTimersByTime(5000);
    expect(of('chips')).toHaveLength(1);
  });

  it('slides the flop out card by card, then turns it over with one flip; the turn and the river the same, one card each', () => {
    seed(view(THREE));
    const tl = step(flop());
    vi.advanceTimersByTime(5000);
    const board = [0, 1, 2].map((i) => tl.arrivals[`b/${i}`]);
    expect(of('board').map(([, at]) => at)).toEqual(board);
    expect(of('flip')).toEqual([['flip', tl.flips['b/0'], 1]]);
    expect(tl.flips['b/0']).toBeGreaterThan(board[2]);

    for (const [street, count] of [['turn', 4], ['river', 5]] as const) {
      played = [];
      const next = step(flop({ street, community: BOARD.slice(0, count) }));
      vi.advanceTimersByTime(5000);
      const key = `b/${count - 1}`;
      expect(played).toEqual([
        ['board', next.arrivals[key], 1],
        ['flip', next.flips[key], 1],
      ]);
    }
  });

  it("tosses another seat's folded hand once as it goes to the muck, and two folds at the same moment once", () => {
    seed(flop());
    const bobFolds = flop({ players: { ...flop().players, bob: seat({ status: 'folded' }) }, lastMove: { kind: 'fold', amount: 0, seq: 3, playerId: 'bob', street: 'flop' } });
    const tl = step(bobFolds);
    // Nothing before the cards leave.
    expect(of('fold')).toEqual([]);
    vi.advanceTimersByTime(3000);
    expect(of('fold')).toEqual([['fold', tl.departures['h/bob/0'], ONLOOKER_VOLUME]]);

    played = [];
    seed(flop());
    step(flop({ players: { ...flop().players, bob: seat({ status: 'folded' }), carol: seat({ status: 'folded' }) } }));
    vi.advanceTimersByTime(3000);
    expect(of('fold')).toHaveLength(1);
  });

  it('turns the hands over at a showdown with one flip, then pays me with the collect and the sting', () => {
    seed(flop({ street: 'river', community: BOARD }));
    const tl = step(view(THREE, { phase: 'results', street: 'river', community: BOARD, pot: 0, turn: null, results: RESULTS }));
    vi.advanceTimersByTime(5000);
    expect(tl.flips['h/bob/0']).toBe(tl.flips['h/carol/1']);
    expect(of('flip')).toEqual([['flip', tl.flips['h/bob/0'], ONLOOKER_VOLUME]]);
    expect(names().slice(-2)).toEqual(['collect', 'win']);
    expect(of('collect')[0][1]).toBeGreaterThan(of('flip')[0][1]);
  });

  it('sweeps the last hand to the muck with a soft swoosh, then deals the next one after it', () => {
    seed(flop({ street: 'river', community: BOARD }));
    step(view(THREE, { phase: 'results', street: 'river', community: BOARD, pot: 0, turn: null, results: RESULTS }));
    vi.advanceTimersByTime(10_000);
    played = [];
    const tl = step(view(THREE, { dealerId: 'bob' }, 2));
    vi.advanceTimersByTime(10_000);
    expect(tl.discard).not.toBeNull();
    expect(names().filter((n) => n !== 'chips')).toEqual(['sweep', 'deal', 'deal', 'deal', 'deal', 'deal', 'deal']);
    expect(of('sweep')[0][1]).toBe(tl.discard?.from);
    expect(of('deal')[0][1]).toBeGreaterThanOrEqual(tl.discard?.until ?? Infinity);
  });
});

describe('a big table', () => {
  it('deals 23 seats a card sound for each of the 46 hole cards, never closer than the sound cooldown, inside the server allowance', () => {
    const ids = Array.from({ length: 23 }, (_, i) => (i === 5 ? 'me' : `p${i}`));
    const tl = step(view(ids));
    vi.advanceTimersByTime(10_000);
    const deals = of('deal').map(([, at]) => at);
    expect(deals).toHaveLength(46);
    for (let i = 1; i < deals.length; i++) expect(deals[i] - deals[i - 1]).toBeGreaterThanOrEqual(pokerSounds.sounds.deal.cooldownMs ?? 0);
    // The deal speeds up so 46 cards take about three seconds, not seven.
    expect(tl.endsAt - START).toBeLessThan(3500);
    expect(of('deal').filter(([, , volume]) => volume === 1)).toHaveLength(2);
  });

  it('plays a 23-seat hand dealt and settled in one snapshot inside the reveal allowance the server waits for', () => {
    const ids = Array.from({ length: 23 }, (_, i) => (i === 0 ? 'me' : `p${i}`));
    const revealed = Object.fromEntries(ids.map((id) => [id, { cards: [c('2S'), c('3S')], category: 'highCard' as const, name: 'High card', best: [] }]));
    const tl = step(view(ids, { phase: 'results', street: 'river', community: BOARD, pot: 0, turn: null, results: { ...RESULTS, revealed } }));
    vi.advanceTimersByTime(20_000);
    expect(of('deal')).toHaveLength(46);
    expect(of('board')).toHaveLength(5);
    expect(tl.endsAt - START).toBeLessThanOrEqual(settleRevealMs({ holeCards: 46, boardFrom: 0, boardTo: 5, contested: true }));
  });

  it('turns every shown hand over at a 23-seat showdown with a single flip', () => {
    const ids = Array.from({ length: 23 }, (_, i) => (i === 0 ? 'me' : `p${i}`));
    seed(view(ids, { street: 'river', community: BOARD }));
    const revealed = Object.fromEntries(ids.map((id) => [id, { cards: [c('2S'), c('3S')], category: 'highCard' as const, name: 'High card', best: [] }]));
    step(view(ids, { phase: 'results', street: 'river', community: BOARD, pot: 0, turn: null, results: { ...RESULTS, revealed } }));
    vi.advanceTimersByTime(10_000);
    expect(of('flip')).toHaveLength(1);
    expect(of('collect')).toHaveLength(1);
  });
});
