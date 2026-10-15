/**
 * Blackjack's sound wiring against the animation timeline: which sound plays for which card
 * movement (deal, hit, double, split, the dealer's draws, the hole card, the discard sweep), at
 * the moment the table shows it, and the blackjack sting (full on mine, softer on another seat's,
 * one per deal). The fake clock is installed before the module loads, so the sound schedule and
 * the planner read the same time and every sound can be checked against its planned moment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlackjackPlayerView, BlackjackView, Card, HandView, LastRoundView } from '@shared/games/blackjack/protocol';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();
vi.useFakeTimers();

const { ONLOOKER_VOLUME } = await import('../../platform/lib/sound');
const { blackjackSounds } = await import('./sounds');
const { CARD_SOUND_GAP_MS, clearBlackjackSounds, playBlackjackSounds } = await import('./sfx');
const { BLACKJACK_DEAL, dealAllowanceMs } = await import('@shared/games/blackjack/deal');
const { useBlackjackStore } = await import('./store');
const T = await import('./lib/timeline');

const START = 1_800_000_000_000;
const c = (text: string): Card => ({ rank: text.slice(0, -1) as Card['rank'], suit: text.slice(-1) as Card['suit'] });

function hand(cards: string[], over: Partial<HandView> = {}): HandView {
  return { cards: cards.map(c), total: 0, soft: false, bet: 10, status: 'waiting', doubled: false, fromSplit: false, splitAces: false, ...over };
}

function seat(hands: HandView[], bet = 10): BlackjackPlayerView {
  return { chips: 1000, bet, hands, inRound: true, bustedOut: false };
}

function view(over: Partial<BlackjackView> = {}): BlackjackView {
  return {
    phase: 'betting',
    round: 1,
    order: ['me', 'bob'],
    turn: null,
    endsAt: null,
    dealer: { cards: [], holeHidden: true, total: 0, soft: false, blackjack: false },
    players: { me: seat([]), bob: seat([]) },
    actions: { canHit: false, canStand: false, canDouble: false, canSplit: false },
    lastRound: null,
    endRequested: false,
    shoeRemaining: 300,
    shoeSize: 312,
    reshuffled: false,
    ...over,
  };
}

/** The deal of round `round`: me and bob two cards each, the dealer's ten up and the hole card down. */
function dealt(me: string[], bob: string[], round = 1): BlackjackView {
  return view({
    phase: 'acting',
    round,
    turn: { playerId: 'me', handIndex: 0 },
    dealer: { cards: [c('10H')], holeHidden: true, total: 10, soft: false, blackjack: false },
    players: { me: seat([hand(me, { status: 'acting' })]), bob: seat([hand(bob)]) },
  });
}

type Played = [name: string, at: number, volume: number];
let played: Played[] = [];

/** Feeds one snapshot the way the module does: plan the timeline, then schedule its sounds. */
function step(prevView: BlackjackView, next: BlackjackView, me = 'me'): ReturnType<typeof useBlackjackStore.getState>['timeline'] {
  const { soundTimeline: before, table: prevTable } = useBlackjackStore.getState();
  useBlackjackStore.getState().applyView(next, Date.now(), false, true);
  const { table, soundTimeline: timeline } = useBlackjackStore.getState();
  playBlackjackSounds({ view: next, prevView, table, prevTable, before, timeline, me });
  return timeline;
}

/** Starts the table on `first` with no sound (a welcome). */
function seed(first: BlackjackView): void {
  useBlackjackStore.getState().reset();
  useBlackjackStore.getState().applyView(first, Date.now(), true, true);
}

const names = (from = 0): string[] => played.slice(from).map(([name]) => name);
const at = (name: string): number[] => played.filter(([n]) => n === name).map(([, t]) => t);

beforeEach(() => {
  vi.setSystemTime(START);
  clearBlackjackSounds();
  played = [];
  vi.spyOn(blackjackSounds, 'play').mockImplementation((name, opts) => {
    played.push([name, Date.now(), opts?.volume ?? 1]);
  });
});

describe('Blackjack sounds follow the cards', () => {
  it('plays a card sound for every card of the deal as it slides in, in deal order, mine in full and the others softer', () => {
    const betting = view();
    seed(betting);
    const deal = dealt(['9S', '7D'], ['10C', '6H']);
    const tl = step(betting, deal);
    // Nothing plays before its moment.
    expect(played).toEqual([]);
    vi.advanceTimersByTime(5000);
    const arrivals = Object.entries(tl.arrivals).sort((a, b) => a[1] - b[1]);
    expect(arrivals).toHaveLength(6);
    expect(played).toEqual(arrivals.map(([key, time]) => ['deal', time, key.startsWith('me/') ? 1 : key.includes('/') ? ONLOOKER_VOLUME : 0.8]));
  });

  it('plays one card for a hit and for a double (after the chips for the double), each when the card slides in', () => {
    const deal = dealt(['5S', '6D'], ['10C', '6H']);
    seed(deal);
    const hitView = { ...deal, players: { ...deal.players, me: seat([hand(['5S', '6D', '2C'], { status: 'acting' })]) } };
    const hitTl = step(deal, hitView);
    vi.advanceTimersByTime(2000);
    expect(played).toEqual([['deal', hitTl.arrivals['me/0/2/2C'], 1]]);

    played = [];
    const doubled = { ...hitView, turn: { playerId: 'bob', handIndex: 0 }, players: { ...hitView.players, bob: seat([hand(['10C', '6H', 'KD'], { bet: 20, doubled: true, status: 'stood' })]) } };
    const doubleTl = step(hitView, doubled);
    vi.advanceTimersByTime(2000);
    expect(names()).toEqual(['bet', 'deal']);
    expect(played[1]).toEqual(['deal', doubleTl.arrivals['bob/0/2/KD'], ONLOOKER_VOLUME]);
    expect(played[0][1]).toBeLessThanOrEqual(played[1][1]);
  });

  it('slides the split card over first, then deals each new hand its card, never two at once', () => {
    const deal = dealt(['8S', '8D'], ['10C', '6H']);
    seed(deal);
    vi.advanceTimersByTime(5000);
    const split = { ...deal, players: { ...deal.players, me: seat([hand(['8S', '3H'], { status: 'acting', fromSplit: true }), hand(['8D', 'KC'], { fromSplit: true })]) } };
    const tl = step(deal, split);
    vi.advanceTimersByTime(2000);
    const start = tl.arrivals['me/1/0/8D'];
    expect(played).toEqual([
      ['bet', played[0][1], 1],
      ['slide', start, 1],
      ['deal', start + T.MOVE_MS, 1],
      ['deal', start + T.MOVE_MS + T.DEAL_GAP_MS, 1],
    ]);
  });

  it('turns the hole card over, then each dealer draw, then my chips come back with the outcomes', () => {
    const deal = dealt(['10S', '9D'], ['10C', '6H']);
    seed(deal);
    vi.advanceTimersByTime(5000);
    const last: LastRoundView = {
      round: 1,
      order: ['me', 'bob'],
      dealer: { cards: [c('10H'), c('6C'), c('5D')], holeHidden: false, total: 21, soft: false, blackjack: false },
      hands: { me: [{ ...hand(['10S', '9D']), outcome: 'loss', payout: 0 }], bob: [{ ...hand(['10C', '6H']), outcome: 'loss', payout: 0 }] },
      peeked: false,
      revealEndsAt: Date.now() + 1700,
    };
    // A dealer 21: everyone loses; then a dealer bust that pays me.
    const lost = view({ round: 2, lastRound: last, players: { me: seat([], 0), bob: seat([], 0) } });
    const tl = step(deal, lost);
    vi.advanceTimersByTime(5000);
    expect(played).toEqual([
      ['flip', T.holeFlipAt(tl), 1],
      ['deal', tl.arrivals.d2, 0.8],
    ]);
    expect(tl.arrivals.d2).toBeGreaterThan(T.holeFlipAt(tl) ?? Infinity);

    played = [];
    seed(deal);
    const won = { ...lost, lastRound: { ...last, dealer: { ...last.dealer, cards: [c('10H'), c('6C'), c('KD')], total: 26 }, hands: { ...last.hands, me: [{ ...hand(['10S', '9D']), outcome: 'win' as const, payout: 20 }] } } };
    const wonTl = step(deal, won);
    vi.advanceTimersByTime(5000);
    expect(names()).toEqual(['flip', 'deal', 'collect']);
    expect(played[2][1]).toBe(T.outcomesAt(wonTl));
    expect(played[2][1]).toBeGreaterThan(played[1][1]);
  });

  it('sweeps the last round to the discards with a soft swoosh, then deals the new round after it', () => {
    const deal = dealt(['10S', '9D'], ['10C', '6H']);
    seed(deal);
    vi.advanceTimersByTime(5000);
    const last: LastRoundView = {
      round: 1,
      order: ['me', 'bob'],
      dealer: { cards: [c('10H'), c('8C')], holeHidden: false, total: 18, soft: false, blackjack: false },
      hands: { me: [{ ...hand(['10S', '9D']), outcome: 'win', payout: 20 }], bob: [{ ...hand(['10C', '6H']), outcome: 'loss', payout: 0 }] },
      peeked: false,
      revealEndsAt: Date.now() + 1200,
    };
    const betting = view({ round: 2, lastRound: last, players: { me: seat([], 10), bob: seat([], 10) } });
    step(deal, betting);
    vi.advanceTimersByTime(10_000);
    played = [];
    const next = dealt(['4S', '5D'], ['2C', '3H'], 2);
    const tl = step(betting, next);
    vi.advanceTimersByTime(10_000);
    expect(tl.discard).not.toBeNull();
    expect(names()).toEqual(['sweep', 'deal', 'deal', 'deal', 'deal', 'deal', 'deal']);
    expect(played[0][1]).toBe(tl.discard?.from);
    expect(played[1][1]).toBeGreaterThanOrEqual(tl.discard?.until ?? Infinity);
  });
});

describe('the blackjack sting', () => {
  it('plays in full on my natural once my second card has landed, and only once when another seat has one too', () => {
    seed(view());
    const both = dealt(['AS', 'KH'], ['AD', 'QC']);
    both.players.me.hands[0].status = 'blackjack';
    both.players.bob.hands[0].status = 'blackjack';
    both.turn = null;
    const bothTl = step(view(), both);
    vi.advanceTimersByTime(5000);
    const stings = played.filter(([name]) => name === 'blackjack');
    expect(stings).toEqual([['blackjack', bothTl.arrivals['me/0/1/KH'] + T.DEAL_MS, 1]]);
    // After my cards, never over them.
    expect(stings[0][1]).toBeGreaterThan(Math.max(...at('deal').filter((t) => t <= bothTl.arrivals['me/0/1/KH'])));
  });

  it("plays softer for another seat's natural, and not again when the round settles", () => {
    seed(view());
    const deal = dealt(['9S', '7D'], ['AD', 'QC']);
    deal.players.bob.hands[0].status = 'blackjack';
    const tl = step(view(), deal);
    vi.advanceTimersByTime(5000);
    expect(played.filter(([name]) => name === 'blackjack')).toEqual([['blackjack', tl.arrivals['bob/0/1/QC'] + T.DEAL_MS, ONLOOKER_VOLUME]]);
    played = [];
    const settled = { ...deal, players: { ...deal.players, me: seat([hand(['9S', '7D', 'KC'], { status: 'bust' })]) }, turn: null };
    step(deal, settled);
    vi.advanceTimersByTime(5000);
    expect(names()).not.toContain('blackjack');
  });
});

describe('a big table', () => {
  it('shares its deal timings with the server, which starts the first turn once the deal has landed', () => {
    expect(BLACKJACK_DEAL).toEqual({ deal: T.DEAL_MS, dealGap: T.DEAL_GAP_MS, discard: T.DISCARD_MS });
  });

  const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);
  const fifty = (hands: (id: string) => HandView[], over: Partial<BlackjackView> = {}): BlackjackView =>
    view({
      phase: 'acting',
      order: ids,
      turn: { playerId: 'p0', handIndex: 0 },
      dealer: { cards: [c('10H')], holeHidden: true, total: 10, soft: false, blackjack: false },
      players: Object.fromEntries(ids.map((id) => [id, seat(hands(id))])),
      ...over,
    });

  it('deals fifty seats in under the animation backlog: a riffle of card sounds, mine always heard, none on top of each other', () => {
    const betting = view({ order: ids, players: Object.fromEntries(ids.map((id) => [id, seat([])])) });
    seed(betting);
    const deal = fifty(() => [hand(['9S', '7D'])]);
    const start = Date.now();
    const tl = step(betting, deal, 'p0');
    vi.advanceTimersByTime(60_000);
    const deals = at('deal');
    // The whole deal is as long as the server allows for it (no last round to clear here), and under the backlog.
    expect(tl.endsAt - start).toBe(dealAllowanceMs(50) - T.DISCARD_MS);
    expect(tl.endsAt - start).toBeLessThan(T.MAX_BACKLOG_MS);
    // One card sound every CARD_SOUND_GAP_MS or so through the deal, from the first card to the last.
    const cardsAt = Object.values(tl.arrivals).sort((a, b) => a - b);
    expect(deals[0]).toBe(cardsAt[0]);
    expect(deals.length).toBeGreaterThan((cardsAt[cardsAt.length - 1] - cardsAt[0]) / CARD_SOUND_GAP_MS / 2);
    for (let i = 1; i < deals.length; i++) expect(deals[i] - deals[i - 1]).toBeGreaterThanOrEqual(blackjackSounds.sounds.deal.cooldownMs ?? 0);
    // My two cards always sound, in full.
    expect(played.filter(([name, , volume]) => name === 'deal' && volume === 1).map(([, time]) => time)).toEqual([tl.arrivals['p0/0/0/9S'], tl.arrivals['p0/0/1/7D']]);
  });

  it('a snapshot mid-deal keeps the deal playing and gives the new card its sound after it; a snap drops the old plan\'s sounds', () => {
    const betting = view({ order: ids, players: Object.fromEntries(ids.map((id) => [id, seat([])])) });
    seed(betting);
    const deal = fifty(() => [hand(['9S', '7D'])]);
    const dealTl = step(betting, deal, 'p1');
    vi.advanceTimersByTime(500);
    // p0 (on a reduced-motion phone, never held busy) hits while the deal still plays.
    const hit = fifty((id) => [hand(id === 'p0' ? ['9S', '7D', '2C'] : ['9S', '7D'], id === 'p0' ? { status: 'acting' } : {})]);
    played = [];
    const hitTl = step(deal, hit, 'p1');
    expect(hitTl.arrivals['p0/0/2/2C']).toBeGreaterThanOrEqual(dealTl.endsAt);
    vi.advanceTimersByTime(60_000);
    expect(at('deal')).toContain(hitTl.arrivals['p0/0/2/2C']);
    expect(Math.max(...at('deal'))).toBe(hitTl.arrivals['p0/0/2/2C']);

    // A snap (here: a backlog grown past the limit) drops every sound the dropped plan still had to play.
    seed(betting);
    step(betting, deal, 'p1');
    vi.advanceTimersByTime(100);
    played = [];
    const before = useBlackjackStore.getState().soundTimeline;
    const snapped = { ...before, endsAt: Date.now() + T.MAX_BACKLOG_MS + 1000 };
    useBlackjackStore.setState({ soundTimeline: snapped, timeline: snapped });
    const snapTl = step(deal, hit, 'p1');
    expect(snapTl.endsAt).toBeLessThanOrEqual(Date.now());
    vi.advanceTimersByTime(60_000);
    expect(at('deal')).toEqual([]);
  });
});
