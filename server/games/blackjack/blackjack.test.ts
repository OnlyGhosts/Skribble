/** Blackjack's rules through the pure engine: betting (no clock: sitting out, Deal now), the deal from the endless deck and the peek, the moves one hand at a time (no clock: away hands stand, the host's Skip), splits with no cap, the dealer, payouts, chips as the score, rounds, the end, holds and seats. Every deck is scripted through ctx.rng. */
import { describe, expect, it } from 'vitest';
import { DECK, handTotal, revealAllowanceMs } from '../../../shared/games/blackjack/cards.js';
import { BLACKJACK_RESULTS_MS, DEFAULT_BLACKJACK_SETTINGS, blackjackClientMessageSchema, type BlackjackClientMessage, type BlackjackView, type Card, type CardRank } from '../../../shared/games/blackjack/protocol.js';
import { PLATFORM_CLIENT_MESSAGE_TYPES, type RoomState } from '../../../shared/platform/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defaultPlatformSettings } from '../../../shared/platform/settings.js';
import type { Effect } from '../../platform/engine/effects.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { viewFor } from '../../platform/engine/view.js';
import { AVATAR, START, chatTexts, noticeTexts, errorsOf, sim, startGame, type Sim } from '../../platform/engine/testHarness.js';
import { BLACKJACK_DEAL, MIN_DEAL_GAP_MS, dealAllowanceMs } from '../../../shared/games/blackjack/deal.js';
import { RESUME_SETTLE_MS } from '../waiting.js';
import { blackjackModule, type BlackjackData } from './module.js';

// The fixture: one deck, any bet from 1000 chips; no clock but the 5 s final pause; the rounds never run out.
const RESULTS_MS = BLACKJACK_RESULTS_MS;
/** Five minutes: far longer than any clock the table used to have, and inside a dropped seat's grace. */
const LONG_MS = 5 * 60_000;
const NO_ACTIONS = { canHit: false, canStand: false, canDouble: false, canSplit: false };
const NO_CONTROLS = { canSitOut: false, canDealNow: false, canSkip: false };

const card = (text: string): Card => ({ rank: text.slice(0, -1) as CardRank, suit: text.slice(-1) as Card['suit'] });
const cards = (...texts: string[]): Card[] => texts.map(card);
const data = (s: Sim): BlackjackData => s.data.game as BlackjackData;
const view = (s: Sim, viewer: string | null = null): BlackjackView => {
  const game = viewFor(s.data, viewer, s.now).game;
  if (!game) throw new Error('no game');
  return game as BlackjackView;
};
const score = (s: Sim, id: string): number => s.data.players.find((p) => p.id === id)?.score ?? -1;
const chips = (s: Sim, id: string): number => data(s).seats[id]?.chips ?? -1;
const token = (s: Sim, id: string): string => s.data.players.find((p) => p.id === id)?.token ?? '';
const waiting = (s: Sim): string[] | null => viewFor(s.data, null, s.now).waiting?.missing ?? null;
const disconnect = (s: Sim, id: string, name: string): Effect[] => s.apply({ type: 'connectionClosed', playerId: id, connectionId: `conn-${name}` });
const reconnect = (s: Sim, id: string, name: string): Effect[] => s.apply({ type: 'rejoin', token: token(s, id), connectionId: `conn-${name}-2` });

/** The platform score must equal the chips of every seated participant, and the chips never go negative. */
function expectScoresMatchChips(s: Sim): void {
  for (const p of s.data.players) {
    const seat = data(s).seats[p.id];
    if (seat) {
      expect(p.score, p.name).toBe(seat.chips);
      expect(seat.chips, p.name).toBeGreaterThanOrEqual(0);
    }
  }
}

/** No snapshot sent, and no view of the current state, shows the hole card before the dealer plays. */
function expectHoleHidden(s: Sim, effects: Effect[]): void {
  for (const e of effects) {
    if (e.type !== 'send' || e.msg.t !== 'room') continue;
    const game = (e.msg as { room: RoomState<BlackjackView> }).room.game;
    if (game?.dealer.holeHidden) expect(game.dealer.cards.length).toBeLessThanOrEqual(1);
  }
  const { dealer, holeHidden } = data(s);
  if (!holeHidden || dealer.length < 2) return;
  for (const viewer of [null, ...s.data.players.map((p) => p.id)]) expect(view(s, viewer).dealer.cards).toEqual(dealer.slice(0, 1));
}

/** The rng value that draws `c` from the endless deck (the middle of its slice of [0, 1)). */
const valueOf = (c: Card): number => (DECK.findIndex((d) => d.rank === c.rank && d.suit === c.suit) + 0.5) / DECK.length;

/** Every table's scripted deck: the cards still to come, first card first. */
const scripts = new WeakMap<Sim, Card[]>();

/**
 * A Blackjack room whose endless deck is scripted through ctx.rng (the only thing that reads it):
 * the cards queued by rig come out in order, then a two of spades every time.
 */
function table(): Sim {
  const queue: Card[] = [];
  const s = sim('blackjack', 'ABCD', START, () => valueOf(queue.shift() ?? card('2S')));
  scripts.set(s, queue);
  return s;
}

/** The next cards drawn, in the given order (replacing any still queued); twos after them. */
function rig(s: Sim, ...texts: string[]): void {
  const queue = scripts.get(s);
  if (!queue) throw new Error('rig needs a table()');
  queue.splice(0, queue.length, ...texts.map(card));
}

/** Cards still queued: every rigged card was drawn once this is empty. */
const queued = (s: Sim): number => scripts.get(s)?.length ?? 0;

/** A seeded uniform rng (mulberry32), for the long and statistical runs. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checked(s: Sim, effects: Effect[]): Effect[] {
  expectScoresMatchChips(s);
  expectHoleHidden(s, effects);
  expect(JSON.parse(JSON.stringify(data(s)))).toEqual(data(s));
  return effects;
}
const act = (s: Sim, id: string, msg: unknown): Effect[] => checked(s, s.game(id, msg));
const betAll = (s: Sim, ids: string[], amount = 10): void => {
  for (const id of ids) act(s, id, { t: 'bet', amount });
};
const controls = (s: Sim, viewer: string) => view(s, viewer).controls;
const tick = (s: Sim, ms: number): Effect[] => {
  s.now += ms;
  return checked(s, s.tick());
};
/** The settled table's pause runs out (the dealer's reveal, then BLACKJACK_RESULTS_MS): the next round's bets open. */
const nextRound = (s: Sim): Effect[] => {
  const { phase } = data(s);
  if (phase.kind !== 'results') throw new Error(`no results pause but ${phase.kind}`);
  return tick(s, phase.endsAt - s.now);
};
/** Skip, aimed at the hand in play right now (or at nobody's, between turns). */
const skipNow = (s: Sim) => ({ t: 'skip', ...(view(s).turn ?? { playerId: 'nobody', handIndex: 0 }) });
const handsOf = (s: Sim, id: string) => view(s).players[id].hands;
/** The last settled round as flat per-hand results, in play order. */
const results = (s: Sim) => {
  const last = view(s).lastRound;
  if (!last) return [];
  return last.order.flatMap((playerId) => last.hands[playerId].map((h, handIndex) => ({ playerId, handIndex, outcome: h.outcome, bet: h.bet, payout: h.payout })));
};
const lastHands = (s: Sim, id: string) => view(s).lastRound?.hands[id] ?? [];

describe('Blackjack: the table', () => {
  it('seats everyone with the starting stack as their score and opens the first round with betting', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    expect(s.data.phase).toBe('playing');
    expect(data(s)).toEqual({
      phase: { kind: 'betting' },
      round: 1,
      seats: expect.any(Object),
      order: [alice, bob],
      dealer: [],
      holeHidden: true,
      lastRound: null,
      endRequested: false,
    });
    // No betting clock: the table waits for the bets.
    expect(data(s).phase).toEqual({ kind: 'betting' });
    expect(data(s).seats).toEqual({ [alice]: { chips: 1000, bet: 0, hands: [], bustedOut: false, sittingOut: false }, [bob]: { chips: 1000, bet: 0, hands: [], bustedOut: false, sittingOut: false } });
    expect([score(s, alice), score(s, bob)]).toEqual([1000, 1000]);
    expect(chatTexts(s.effects)).toContain('Round 1: place your bets!');
    expect(nextDeadline(s.data)).toBeNull();
    expect(view(s, alice)).toEqual({
      phase: 'betting',
      round: 1,
      order: [alice, bob],
      turn: null,
      waitingFor: [alice, bob],
      dealer: { cards: [], holeHidden: true, total: 0, soft: false, blackjack: false },
      players: {
        [alice]: { chips: 1000, bet: 0, hands: [], inRound: true, sittingOut: false, bustedOut: false },
        [bob]: { chips: 1000, bet: 0, hands: [], inRound: true, sittingOut: false, bustedOut: false },
      },
      actions: NO_ACTIONS,
      controls: { canSitOut: true, canDealNow: false, canSkip: false },
      lastRound: null,
      endRequested: false,
    });
  });

  it('has the starting chips as its only setting: no house rules, rounds, bet limits, clocks or decks to set', () => {
    const { settings } = blackjackModule;
    expect(DEFAULT_BLACKJACK_SETTINGS).toEqual({ startingChips: 1000 });
    expect(settings.normalize).toBeUndefined();
    // The retired keys are dropped from a patch, never stored or validated, even with values the old schema refused.
    const retired = { rounds: 0, minBet: 10, maxBet: 500, betSeconds: 30, actSeconds: 30, resultsSeconds: 10, decks: 2, dealerHitsSoft17: true, blackjackPayout: '6:5', allowDouble: false, allowSplit: 'no' };
    const patch = settings.patchSchema.safeParse({ ...retired, startingChips: 2500 });
    expect(patch.success && patch.data).toEqual({ startingChips: 2500 });
    expect(settings.schema.safeParse({ ...DEFAULT_BLACKJACK_SETTINGS, ...retired }).success).toBe(true);
    expect(RESULTS_MS).toBe(5000);
    expect(gameById('blackjack').maxPlayers).toBeNull();
  });

  it('plays a room stored with the old rounds, bet limit, clock and decks settings, ignoring them', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice']);
    // A room saved before the settings went: the stored keys ride along and change nothing.
    s.data = { ...s.data, settings: { ...s.data.settings, rounds: 1, minBet: 50, maxBet: 60, betSeconds: 10, actSeconds: 10, resultsSeconds: 4, decks: 8 } };
    rig(s, '10S', '9D', '8H', '7C');
    act(s, alice, { t: 'bet', amount: 1 });
    expect(tick(s, LONG_MS)).toEqual([]);
    expect(view(s).phase).toBe('acting');
    act(s, alice, { t: 'stand' });
    // Round one is over, and round two opens rather than the game ending.
    expect(view(s)).toMatchObject({ phase: 'results', round: 1, lastRound: { round: 1 } });
    nextRound(s);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, lastRound: { round: 1 } });
    act(s, alice, { t: 'bet', amount: 900 });
    expect(view(s, alice).players[alice].hands[0].bet).toBe(900);
    expect(s.data.phase).toBe('playing');
  });

  it('plays a room stored with the old house rules at the fixed ones: stands on soft 17, pays 3 to 2, doubles and splits', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    // A room saved while the house rules were settings, set to the other way round: nothing reads them now.
    s.data = { ...s.data, settings: { ...s.data.settings, dealerHitsSoft17: true, blackjackPayout: '6:5', allowDouble: false, allowSplit: false } };
    // Alice: a natural. Bob: a pair of eights, split, each eight doubled. Dealer: ace and six, a soft 17.
    rig(s, 'AS', '8S', 'AD', 'KH', '8H', '6S', '3C', '2D', '10C', '9C');
    betAll(s, [alice, bob]);
    expect(view(s, bob).actions).toMatchObject({ canDouble: true, canSplit: true });
    act(s, bob, { t: 'split' });
    act(s, bob, { t: 'double' });
    act(s, bob, { t: 'double' });
    expect(view(s).lastRound?.dealer).toMatchObject({ cards: cards('AD', '6S'), total: 17, soft: true });
    expect(queued(s)).toBe(0);
    // 21 and 19 against the dealer's 17.
    expect(results(s)).toEqual([
      { playerId: alice, handIndex: 0, outcome: 'blackjack', bet: 10, payout: 25 },
      { playerId: bob, handIndex: 0, outcome: 'win', bet: 20, payout: 40 },
      { playerId: bob, handIndex: 1, outcome: 'win', bet: 20, payout: 40 },
    ]);
    expect([chips(s, alice), chips(s, bob)]).toEqual([1015, 1040]);
  });

  it('has no insurance anywhere; the host has End game, Deal now and Skip, even while sitting the game out', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice', 'Bob']);
    expect(JSON.stringify(blackjackModule.settings.defaults)).not.toMatch(/insur/i);
    expect(JSON.stringify(view(s, alice))).not.toMatch(/insur/i);
    expect(blackjackClientMessageSchema.safeParse({ t: 'insurance' }).success).toBe(false);
    expect(blackjackClientMessageSchema.safeParse({ t: 'next' }).success).toBe(false);
    expect([...(blackjackModule.hostMessages ?? [])]).toEqual(['endGame', 'dealNow', 'skip']);
    // A game message named like a platform one (the lobby's sitOut) would never reach the game.
    const types = blackjackClientMessageSchema.options.map((o) => o.shape.t.value);
    expect(types).toEqual(['bet', 'hit', 'stand', 'double', 'split', 'sitOutHand', 'dealNow', 'skip', 'endGame']);
    for (const t of types) expect(PLATFORM_CLIENT_MESSAGE_TYPES.has(t), t).toBe(false);
    expect(errorsOf(s.game(alice, { t: 'next' }))).toHaveLength(1);
    expect(view(s).phase).toBe('betting');
  });
});

describe('Blackjack: betting', () => {
  it('takes any whole stake from 1 chip up to the whole stack, lets it be changed, and deals once everyone has bet', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S');
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 1001 }))).toEqual(['Bet between 1 and 1000 chips.']);
    // No chips and part chips never reach the table.
    expect(errorsOf(s.game(alice, { t: 'bet', amount: 0 }))).toHaveLength(1);
    expect(errorsOf(s.game(alice, { t: 'bet', amount: 2.5 }))).toHaveLength(1);
    act(s, alice, { t: 'bet', amount: 1 });
    expect([chips(s, alice), view(s).players[alice].bet]).toEqual([999, 1]);
    // All in, then changed before the deal: the earlier stake comes back first and counts as available.
    act(s, alice, { t: 'bet', amount: 1000 });
    expect([chips(s, alice), view(s).players[alice].bet]).toEqual([0, 1000]);
    act(s, alice, { t: 'bet', amount: 50 });
    expect([chips(s, alice), view(s).players[alice].bet]).toEqual([950, 50]);
    expect(view(s).phase).toBe('betting');
    act(s, bob, { t: 'bet', amount: 10 });
    expect(view(s).phase).toBe('acting');
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 0 });
    expect(handsOf(s, alice)[0]).toMatchObject({ bet: 50, status: 'acting', cards: cards('10S', '6H') });
    expect(handsOf(s, bob)[0].cards).toEqual(cards('5H', '6C'));
    expect(view(s).dealer).toEqual({ cards: cards('9D'), holeHidden: true, total: 9, soft: false, blackjack: false });
    expect(queued(s)).toBe(0);
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 10 }))).toEqual(['You cannot bet right now.']);
  });

  it('has no table maximum: a big stack goes all in', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice', 'Bob'], { startingChips: 100_000 });
    act(s, alice, { t: 'bet', amount: 100_000 });
    expect([chips(s, alice), view(s).players[alice].bet]).toEqual([0, 100_000]);
    expect(view(s).phase).toBe('betting');
  });

  it('deals once every connected seat has bet or sat out: a seat that sat out or is away gets no cards, chips untouched, and is dealt in again from the next round', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rig(s, '10S', '9D', '6H', '7S');
    act(s, alice, { t: 'bet', amount: 100 });
    // Carol drops: the deal stops waiting for her, but Bob is still to decide.
    disconnect(s, carol, 'Carol');
    expect(view(s)).toMatchObject({ phase: 'betting', waitingFor: [bob] });
    expect(tick(s, LONG_MS)).toEqual([]);
    expect(view(s).phase).toBe('betting');
    const effects = act(s, bob, { t: 'sitOutHand' });
    expect(chatTexts(effects)).toEqual(['Bob, Carol sit this hand out.']);
    expect(view(s)).toMatchObject({ phase: 'acting', order: [alice], turn: { playerId: alice, handIndex: 0 }, waitingFor: [] });
    expect(view(s).players[bob]).toEqual({ chips: 1000, bet: 0, hands: [], inRound: false, sittingOut: false, bustedOut: false });
    expect(view(s).players[carol]).toEqual({ chips: 1000, bet: 0, hands: [], inRound: false, sittingOut: false, bustedOut: false });
    expect(errorsOf(act(s, bob, { t: 'bet', amount: 10 }))).toEqual(['You cannot bet right now.']);
    expect(errorsOf(act(s, bob, { t: 'sitOutHand' }))).toEqual(['You cannot sit out right now.']);
    const settled = act(s, alice, { t: 'stand' });
    expect(chatTexts(settled)).toEqual(['The dealer stands on 18.', 'Alice loses 100.']);
    expect(chatTexts(nextRound(s))).toEqual(['Round 2: place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, bob, carol], waitingFor: [alice, bob] });
    // Sitting out lasts one hand.
    expect(view(s).players[bob]).toMatchObject({ sittingOut: false, inRound: true });
    act(s, bob, { t: 'bet', amount: 10 });
    expect(view(s).players[bob]).toMatchObject({ chips: 990, bet: 10, inRound: true });
  });

  it('lets a seat with chips and no stake sit out only while the bets are open, and a bet before the deal brings it back in', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    expect(controls(s, bob)).toEqual({ canSitOut: true, canDealNow: false, canSkip: false });
    act(s, bob, { t: 'sitOutHand' });
    expect(view(s).players[bob]).toMatchObject({ sittingOut: true, inRound: true, bet: 0 });
    expect(view(s).waitingFor).toEqual([alice, carol]);
    expect(controls(s, bob).canSitOut).toBe(false);
    expect(errorsOf(act(s, bob, { t: 'sitOutHand' }))).toEqual(['You cannot sit out right now.']);
    // Changed their mind: a bet puts them back in.
    act(s, bob, { t: 'bet', amount: 20 });
    expect(view(s).players[bob]).toMatchObject({ sittingOut: false, bet: 20 });
    // A stake down cannot sit out.
    expect(controls(s, bob).canSitOut).toBe(false);
    expect(errorsOf(act(s, bob, { t: 'sitOutHand' }))).toEqual(['You cannot sit out right now.']);
    // A newcomer only watches: they have nothing to sit out.
    act(s, alice, { t: 'bet', amount: 10 });
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' });
    const dave = s.playerId('Dave');
    expect(view(s).order).not.toContain(dave);
    expect(errorsOf(act(s, dave, { t: 'sitOutHand' }))).toEqual(['You are watching this game.']);
    // The last seat still to decide sits out: the cards go out at once.
    rig(s, '10S', '9D', '6H', '7S', '8C', '5D');
    act(s, carol, { t: 'sitOutHand' });
    expect(view(s)).toMatchObject({ phase: 'acting', order: [alice, bob] });
    expect(errorsOf(act(s, carol, { t: 'sitOutHand' }))).toEqual(['You cannot sit out right now.']);
    expect(controls(s, carol).canSitOut).toBe(false);
  });

  it('never lets a seat with no chips sit out (it is out of the game)', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { startingChips: 100 });
    rig(s, '10S', '10H', '10C', '10D', '6H', '9C', '9S', '7S');
    betAll(s, [alice, bob, carol], 100);
    for (const id of [alice, bob, carol]) act(s, id, { t: 'stand' });
    nextRound(s);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [bob, carol] });
    expect(view(s).players[alice]).toMatchObject({ bustedOut: true });
    expect(controls(s, alice).canSitOut).toBe(false);
    expect(errorsOf(act(s, alice, { t: 'sitOutHand' }))).toEqual(['You cannot sit out right now.']);
  });

  it('waits, unclocked, while nobody has bet: everyone sitting out deals nothing, and the first bet then deals at once', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    act(s, alice, { t: 'sitOutHand' });
    act(s, bob, { t: 'sitOutHand' });
    expect(view(s)).toMatchObject({ phase: 'betting', round: 1, waitingFor: [], dealer: { cards: [] } });
    expect(nextDeadline(s.data)).toBeNull();
    expect(tick(s, LONG_MS)).toEqual([]);
    expect([chips(s, alice), chips(s, bob)]).toEqual([1000, 1000]);
    // Nothing to deal to: the host cannot deal either.
    expect(controls(s, alice).canDealNow).toBe(false);
    expect(errorsOf(act(s, alice, { t: 'dealNow' }))).toEqual(['Nobody has bet yet.']);
    rig(s, '10S', '9D', '6H', '7S');
    const dealt = act(s, bob, { t: 'bet', amount: 5 });
    expect(chatTexts(dealt)).toEqual(['Alice sits this hand out.']);
    expect(view(s)).toMatchObject({ phase: 'acting', round: 1, order: [bob], turn: { playerId: bob, handIndex: 0 } });
    expect(handsOf(s, bob)[0].cards).toEqual(cards('10S', '6H'));
  });

  it('keeps a newcomer out of bets that have none down yet: they watch, and the deal never waits for them', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expectScoresMatchChips(s);
    expect(view(s)).toMatchObject({ order: [alice, bob], waitingFor: [alice, bob] });
    expect(data(s).seats[carol]).toBeUndefined();
    expect(view(s, carol).players[carol]).toBeUndefined();
    expect(errorsOf(act(s, carol, { t: 'bet', amount: 30 }))).toEqual(['You are watching this game.']);
    rig(s, '10S', '5H', '9C', '9D', '6H', '6C');
    betAll(s, [alice, bob]);
    expect(view(s)).toMatchObject({ phase: 'acting', order: [alice, bob] });
  });

  it('lets only the host deal now, once a stake is down: the seats that bet are dealt in and the rest sit the hand out', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    expect(errorsOf(act(s, alice, { t: 'dealNow' }))).toEqual(['Nobody has bet yet.']);
    act(s, bob, { t: 'bet', amount: 10 });
    expect(controls(s, alice)).toEqual({ canSitOut: true, canDealNow: true, canSkip: false });
    act(s, alice, { t: 'sitOutHand' });
    // The table waits on Carol, not on the host: only the host may deal.
    expect(controls(s, alice)).toEqual({ canSitOut: false, canDealNow: true, canSkip: false });
    expect(controls(s, bob).canDealNow).toBe(false);
    expect(errorsOf(act(s, bob, { t: 'dealNow' }))).toEqual(['Only the host can deal.']);
    expect(errorsOf(act(s, carol, { t: 'dealNow' }))).toEqual(['Only the host can deal.']);
    expect(view(s).phase).toBe('betting');
    rig(s, '10S', '9D', '6H', '7S');
    // The host deals without betting: Alice and Carol sit this one out.
    const dealt = act(s, alice, { t: 'dealNow' });
    expect(chatTexts(dealt)).toEqual(['Alice, Carol sit this hand out.']);
    expect(view(s)).toMatchObject({ phase: 'acting', order: [bob], turn: { playerId: bob, handIndex: 0 } });
    expect([chips(s, alice), chips(s, carol)]).toEqual([1000, 1000]);
    expect(controls(s, alice).canDealNow).toBe(false);
    expect(errorsOf(act(s, alice, { t: 'dealNow' }))).toEqual(['The cards are already out.']);
  });

  it('hands Deal now to the next host when the host leaves', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    act(s, bob, { t: 'bet', amount: 10 });
    s.apply({ type: 'leave', playerId: alice });
    expect(s.data.hostId).toBe(bob);
    expect(view(s)).toMatchObject({ phase: 'betting', order: [bob, carol], waitingFor: [carol] });
    expect(controls(s, bob).canDealNow).toBe(true);
    expect(errorsOf(act(s, carol, { t: 'dealNow' }))).toEqual(['Only the host can deal.']);
    rig(s, '10S', '9D', '6H', '7S');
    expect(chatTexts(act(s, bob, { t: 'dealNow' }))).toEqual(['Carol sits this hand out.']);
    expect(view(s)).toMatchObject({ phase: 'acting', order: [bob] });
  });

  it('deals as soon as the last seat still to bet drops: a disconnected player never holds up the deal', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '9D', '6H', '7S');
    act(s, alice, { t: 'bet', amount: 10 });
    const dropped = disconnect(s, bob, 'Bob');
    expect(chatTexts(dropped)).toContain('Bob sits this hand out.');
    expect(view(s)).toMatchObject({ phase: 'acting', order: [alice], turn: { playerId: alice, handIndex: 0 } });
    expect(waiting(s)).toBeNull();
  });

  it('holds bets with none down once nobody connected is left to place one, and opens the same round again when someone is back', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    disconnect(s, alice, 'Alice');
    expect(view(s)).toMatchObject({ phase: 'betting', waitingFor: [bob] });
    const held = disconnect(s, bob, 'Bob');
    expect(chatTexts(held)).toContain('Waiting for Alice, Bob to reconnect…');
    expect(view(s).phase).toBe('held');
    expect(waiting(s)).toEqual([alice, bob]);
    reconnect(s, bob, 'Bob');
    const resumed = tick(s, RESUME_SETTLE_MS);
    expect(chatTexts(resumed)).toEqual(['Round 1: place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 1, order: [alice, bob], waitingFor: [bob] });
  });

  it('holds a sole player who dropped before anything was dealt: nothing is bet for them, and the round opens again once they are back', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice']);
    const held = disconnect(s, alice, 'Alice');
    expect(chatTexts(held)).toEqual(['Waiting for Alice to reconnect…']);
    expect(view(s)).toMatchObject({ phase: 'held', dealer: { cards: [] } });
    expect(chips(s, alice)).toBe(1000);
    expect(waiting(s)).toEqual([alice]);
    reconnect(s, alice, 'Alice');
    const resumed = tick(s, RESUME_SETTLE_MS);
    expect(chatTexts(resumed)).toEqual(['Round 1: place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 1, order: [alice] });
    expect(waiting(s)).toBeNull();
    expect(s.data.phase).toBe('playing');
  });

  it('never seats a newcomer, not even when the only stake leaves the table: the bets go on with the seats still there', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    act(s, alice, { t: 'bet', amount: 10 });
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expect(view(s).order).toEqual([alice, bob]);
    expect(errorsOf(act(s, carol, { t: 'bet', amount: 10 }))).toEqual(['You are watching this game.']);
    // Alice leaves with the only stake: the table waits on Bob alone, and Carol still watches.
    s.apply({ type: 'leave', playerId: alice });
    expectScoresMatchChips(s);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 1, order: [bob], waitingFor: [bob] });
    expect(data(s).seats[carol]).toBeUndefined();
    rig(s, '10S', '9D', '6H', '7S');
    act(s, bob, { t: 'bet', amount: 10 });
    expect(view(s)).toMatchObject({ phase: 'acting', round: 1, order: [bob], turn: { playerId: bob, handIndex: 0 } });
  });
});

describe('Blackjack: the deal and the moves', () => {
  it('deals in table order, calls out naturals and skips them, then settles straight into the next betting with the table kept in lastRound', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '9H', '5D', 'KH', '7C', '10S', '2S');
    act(s, alice, { t: 'bet', amount: 10 });
    const effects = act(s, bob, { t: 'bet', amount: 10 });
    expect(chatTexts(effects)).toEqual(['Alice has blackjack!']);
    expect(handsOf(s, alice)).toEqual([{ cards: cards('AS', 'KH'), total: 21, soft: true, bet: 10, status: 'blackjack', doubled: false, fromSplit: false, splitAces: false }]);
    expect(handsOf(s, bob)).toEqual([{ cards: cards('9H', '7C'), total: 16, soft: false, bet: 10, status: 'acting', doubled: false, fromSplit: false, splitAces: false }]);
    expect(view(s)).toMatchObject({ phase: 'acting', turn: { playerId: bob, handIndex: 0 }, waitingFor: [] });
    expect(nextDeadline(s.data)).toBeNull();
    expect(view(s).dealer).toEqual({ cards: cards('5D'), holeHidden: true, total: 5, soft: false, blackjack: false });
    expect(data(s).dealer).toEqual(cards('5D', '10S'));
    expect(view(s, alice).actions).toEqual(NO_ACTIONS);
    expect(view(s, bob).actions).toEqual({ canHit: true, canStand: true, canDouble: true, canSplit: false });
    expect(view(s, null).actions).toEqual(NO_ACTIONS);
    expect(errorsOf(act(s, alice, { t: 'hit' }))).toEqual(['It is not your turn.']);

    // Bob stands on 16; the dealer turns 15 and draws a 2: the natural pays 3:2, the 16 loses.
    const stood = act(s, bob, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 17.', 'Alice wins 15, Bob loses 10.']);
    const reveal = revealAllowanceMs(3);
    expect(reveal).toBe(1700);
    // The settled table stays up for the dealer's reveal only, then the next bets open at once.
    expect(view(s)).toMatchObject({ phase: 'results', round: 1, turn: null, order: [], waitingFor: [] });
    expect(nextDeadline(s.data)).toBe(s.now + reveal);
    expect(controls(s, alice)).toEqual(NO_CONTROLS);
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 10 }))).toEqual(['You cannot bet right now.']);
    expect(tick(s, reveal - 1)).toEqual([]);
    expect(view(s).phase).toBe('results');
    s.now -= reveal - 1;
    expect(chatTexts(nextRound(s))).toEqual(['Round 2: place your bets!']);
    s.now -= reveal;
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, turn: null, order: [alice, bob], waitingFor: [alice, bob] });
    // The seats and the dealer are cleared; the settled table lives in lastRound.
    expect(view(s).dealer).toEqual({ cards: [], holeHidden: true, total: 0, soft: false, blackjack: false });
    expect(view(s).players[alice]).toEqual({ chips: 1015, bet: 0, hands: [], inRound: true, sittingOut: false, bustedOut: false });
    expect(view(s).lastRound).toEqual({
      round: 1,
      order: [alice, bob],
      dealer: { cards: cards('5D', '10S', '2S'), holeHidden: false, total: 17, soft: false, blackjack: false },
      hands: {
        [alice]: [{ cards: cards('AS', 'KH'), total: 21, soft: true, bet: 10, status: 'blackjack', doubled: false, fromSplit: false, splitAces: false, outcome: 'blackjack', payout: 25 }],
        [bob]: [{ cards: cards('9H', '7C'), total: 16, soft: false, bet: 10, status: 'lost', doubled: false, fromSplit: false, splitAces: false, outcome: 'loss', payout: 0 }],
      },
      peeked: false,
      revealEndsAt: s.now + reveal,
    });
    expect([chips(s, alice), chips(s, bob)]).toEqual([1015, 990]);
    // The next bets have no clock either.
    expect(nextDeadline(s.data)).toBeNull();
  });

  it('hits for a card, stands a 21 by itself and busts over it', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '5D', '9H', '5C', '2C');
    betAll(s, [alice, bob]);
    s.now += 3000;
    const hit = act(s, alice, { t: 'hit' });
    expect(chatTexts(hit)).toEqual([]);
    // 10 + 6 + 5 = 21: nothing left to do, the play passes to Bob.
    expect(handsOf(s, alice)[0]).toMatchObject({ total: 21, status: 'stood' });
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
    s.now += 2000;
    act(s, bob, { t: 'hit' });
    expect(handsOf(s, bob)[0]).toMatchObject({ total: 20, status: 'acting', cards: cards('5H', '6C', '9H') });
    expect(view(s, bob).actions).toEqual({ canHit: true, canStand: true, canDouble: false, canSplit: false });
    const bust = act(s, bob, { t: 'hit' });
    // The dealer draws 9 + 7 + 2 = 18: Alice's 21 wins even money.
    expect(chatTexts(bust)).toEqual(['Bob busts with 25.', 'The dealer stands on 18.', 'Alice wins 10, Bob loses 10.']);
    expect(lastHands(s, bob)[0]).toMatchObject({ total: 25, status: 'bust', outcome: 'loss' });
    expect(results(s)).toEqual([
      { playerId: alice, handIndex: 0, outcome: 'win', bet: 10, payout: 20 },
      { playerId: bob, handIndex: 0, outcome: 'loss', bet: 10, payout: 0 },
    ]);
    expect([chips(s, alice), chips(s, bob)]).toEqual([1010, 990]);
  });

  it('doubles on two cards for exactly one more card, when the table allows it and the chips are there', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '5S', '9H', '6D', '6H', '8C', '10S', 'KS', '2D', '5H');
    betAll(s, [alice, bob]);
    const doubled = act(s, alice, { t: 'double' });
    expect(handsOf(s, alice)[0]).toEqual({ cards: cards('5S', '6H', 'KS'), total: 21, soft: false, bet: 20, status: 'stood', doubled: true, fromSplit: false, splitAces: false });
    expect(chips(s, alice)).toBe(980);
    expect(chatTexts(doubled)).toEqual([]);
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
    act(s, bob, { t: 'hit' });
    expect(errorsOf(act(s, bob, { t: 'double' }))).toEqual(['You cannot double this hand.']);
    expect(view(s, bob).actions.canDouble).toBe(false);
    act(s, bob, { t: 'stand' });
    // Dealer 6 + 10 + 5 = 21: the doubled 21 pushes its 20 back, Bob's 19 loses.
    expect(results(s)).toEqual([
      { playerId: alice, handIndex: 0, outcome: 'push', bet: 20, payout: 20 },
      { playerId: bob, handIndex: 0, outcome: 'loss', bet: 10, payout: 0 },
    ]);
    expect([chips(s, alice), chips(s, bob)]).toEqual([1000, 990]);
  });

  it('refuses a double the chips cannot cover, and a doubled hand can bust', () => {
    const broke = table();
    const [bob] = startGame(broke, ['Bob'], { startingChips: 100 });
    rig(broke, '7S', '6D', '6H', '10S', 'KS', '5C');
    act(broke, bob, { t: 'bet', amount: 100 });
    expect(view(broke, bob).actions.canDouble).toBe(false);
    expect(errorsOf(act(broke, bob, { t: 'double' }))).toEqual(['You cannot double this hand.']);

    const bust = table();
    const [carol] = startGame(bust, ['Carol']);
    rig(bust, '7S', '6D', '6H', '10S', 'KS');
    betAll(bust, [carol]);
    const effects = act(bust, carol, { t: 'double' });
    expect(lastHands(bust, carol)[0]).toMatchObject({ total: 23, bet: 20, status: 'bust', doubled: true, outcome: 'loss' });
    expect(chatTexts(effects)).toEqual(['Carol busts with 23.', 'The dealer shows 16.', 'Carol loses 20.']);
    expect(chips(bust, carol)).toBe(980);
  });

  it('has no turn clock: the player in play acts whenever they are ready', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    expect(nextDeadline(s.data)).toBeNull();
    expect(tick(s, LONG_MS)).toEqual([]);
    expect(view(s)).toMatchObject({ phase: 'acting', turn: { playerId: alice, handIndex: 0 } });
    expect(handsOf(s, alice)[0].status).toBe('acting');
    act(s, alice, { t: 'stand' });
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
  });
});

describe('Blackjack: away players and the host\'s Skip', () => {
  it('stands the hand of a player who drops on their turn at once, and plays on; back again, they play their next hand as usual', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    const dropped = disconnect(s, alice, 'Alice');
    expect(chatTexts(dropped)).toContain('Alice is away and stands.');
    expect(noticeTexts(dropped)).toContain('Alice is away and stands.');
    expect(handsOf(s, alice)[0].status).toBe('stood');
    expect(view(s)).toMatchObject({ phase: 'acting', turn: { playerId: bob, handIndex: 0 } });
    expect(waiting(s)).toBeNull();
    reconnect(s, alice, 'Alice');
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
    act(s, bob, { t: 'stand' });
    nextRound(s);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, bob] });
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 0 });
    expect(view(s, alice).actions.canStand).toBe(true);
  });

  it('stands a player who is away when their turn comes, and every split hand of theirs, with one line', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rig(s, '8S', '10H', '9C', '6D', '8H', '7C', '9D', '10S', '3H', '2C', '4D');
    betAll(s, [alice, bob, carol]);
    // Bob drops while Alice plays: nothing changes until his turn comes.
    disconnect(s, bob, 'Bob');
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 0 });
    expect(chatTexts(act(s, alice, { t: 'stand' }))).toEqual(['Bob is away and stands.']);
    expect(view(s).turn).toEqual({ playerId: carol, handIndex: 0 });
    expect(handsOf(s, bob)[0].status).toBe('stood');

    // Carol splits, then drops on her first split hand: both of her hands stand.
    act(s, carol, { t: 'split' });
    expect(handsOf(s, carol)).toHaveLength(2);
    const dropped = disconnect(s, carol, 'Carol');
    expect(chatTexts(dropped).filter((line) => line.includes('away'))).toEqual(['Carol is away and stands.']);
    expect(lastHands(s, carol).map((h) => h.status)).not.toContain('acting');
    expect(view(s).phase).toBe('results');
  });

  it('lets only the host skip, and only on another player\'s turn: the hand in play stands, a split hand at a time', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    // Alice 10 + 9, Bob 8 + 8 (a pair), Carol 10 + 7; the dealer 6 + 10.
    rig(s, '10S', '8H', '10C', '6D', '9S', '8D', '7C', '10H', '3S', '2S', 'KD');
    expect(errorsOf(act(s, alice, skipNow(s)))).toEqual(['There is no turn to skip.']);
    betAll(s, [alice, bob, carol]);
    // The host's own turn: nothing for the host to skip.
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 0 });
    expect(controls(s, alice).canSkip).toBe(false);
    expect(errorsOf(act(s, alice, skipNow(s)))).toEqual(['It is your own turn.']);
    act(s, alice, { t: 'stand' });
    expect(controls(s, alice)).toEqual({ canSitOut: false, canDealNow: false, canSkip: true });
    expect(controls(s, bob).canSkip).toBe(false);
    expect(controls(s, carol).canSkip).toBe(false);
    expect(errorsOf(act(s, carol, skipNow(s)))).toEqual(['Only the host can skip a turn.']);
    expect(errorsOf(act(s, bob, skipNow(s)))).toEqual(['It is your own turn.']);
    // A skip names the hand it stands.
    expect(blackjackClientMessageSchema.safeParse({ t: 'skip' }).success).toBe(false);

    // Bob splits his eights; the host skips the first split hand only.
    act(s, bob, { t: 'split' });
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
    const skipped = act(s, alice, skipNow(s));
    expect(chatTexts(skipped)).toEqual(["Alice stood Bob's hand."]);
    expect(noticeTexts(skipped)).toEqual(["Alice stood Bob's hand."]);
    expect(handsOf(s, bob).map((h) => h.status)).toEqual(['stood', 'acting']);
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 1 });
    act(s, alice, skipNow(s));
    expect(view(s).turn).toEqual({ playerId: carol, handIndex: 0 });

    // Skipping the last hand sends the play to the dealer, who plays it out at once: nothing is left to skip.
    const last = act(s, alice, skipNow(s));
    expect(chatTexts(last)[0]).toBe("Alice stood Carol's hand.");
    expect(view(s).phase).toBe('results');
    expect(lastHands(s, carol)[0].status).not.toBe('acting');
    expect(controls(s, alice).canSkip).toBe(false);
    expect(errorsOf(act(s, alice, { t: 'skip', playerId: carol, handIndex: 0 }))).toEqual(['There is no turn to skip.']);
  });

  it('never stands the next hand on a second tap of Skip: a skip names the hand, and a stale one is refused', () => {
    const s = table();
    const [hana, ben, cleo, dev] = startGame(s, ['Hana', 'Ben', 'Cleo', 'Dev']);
    rig(s, '10S', '9H', '10C', '6D', '9S', '8D', '7C', '10H', '8H', '7S');
    act(s, hana, { t: 'sitOutHand' });
    betAll(s, [ben, cleo, dev]);
    expect(view(s).turn).toEqual({ playerId: ben, handIndex: 0 });
    // Two taps on Ben's turn: both aimed at Ben's hand.
    const tap = skipNow(s);
    expect(chatTexts(act(s, hana, tap))).toEqual(["Hana stood Ben's hand."]);
    expect(view(s).turn).toEqual({ playerId: cleo, handIndex: 0 });
    expect(errorsOf(act(s, hana, tap))).toEqual(['That hand is already done.']);
    expect(handsOf(s, cleo)[0].status).toBe('acting');
    expect(handsOf(s, dev)[0].status).toBe('waiting');
    // A skip aimed at a hand still to come is refused too.
    expect(errorsOf(act(s, hana, { t: 'skip', playerId: dev, handIndex: 0 }))).toEqual(['That hand is already done.']);
    expect(view(s).turn).toEqual({ playerId: cleo, handIndex: 0 });
  });

  it('never lets an idle host stall the table: while it waits on the host, anyone may deal now or skip the host\'s hand', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    act(s, bob, { t: 'bet', amount: 10 });
    // Carol and the host still to bet: the table waits on the host, so Bob and Carol may deal.
    expect(view(s).waitingFor).toEqual([alice, carol]);
    expect(controls(s, bob)).toEqual({ canSitOut: false, canDealNow: true, canSkip: false });
    expect(controls(s, carol)).toEqual({ canSitOut: true, canDealNow: true, canSkip: false });
    // Once the host has bet, only the host deals again.
    act(s, alice, { t: 'bet', amount: 10 });
    expect(controls(s, bob).canDealNow).toBe(false);
    expect(errorsOf(act(s, bob, { t: 'dealNow' }))).toEqual(['Only the host can deal.']);
    rig(s, '10S', '9H', '10C', '6D', '8S', '7D', '10H');
    expect(chatTexts(act(s, bob, { t: 'bet', amount: 20 }))).toEqual([]);
    // Carol deals: the host is no longer the one waited on, so she cannot; the host can.
    expect(controls(s, carol).canDealNow).toBe(false);
    act(s, alice, { t: 'dealNow' });
    // The host's own turn: anyone else may stand it; nobody may skip their own.
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 0 });
    expect(controls(s, bob)).toEqual({ canSitOut: false, canDealNow: false, canSkip: true });
    expect(controls(s, carol).canSkip).toBe(true);
    expect(controls(s, alice).canSkip).toBe(false);
    expect(chatTexts(act(s, carol, skipNow(s)))).toEqual(["Carol stood Alice's hand."]);
    // Bob's turn: only the host may skip it.
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
    expect(controls(s, carol).canSkip).toBe(false);
    expect(errorsOf(act(s, carol, skipNow(s)))).toEqual(['Only the host can skip a turn.']);
  });

  it('lets a lone other player move a 2-player table on past an idle host', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '9H', '10C', '6D', '8S', '7D', '10H');
    act(s, bob, { t: 'bet', amount: 10 });
    expect(chatTexts(act(s, bob, { t: 'dealNow' }))).toEqual(['Alice sits this hand out.']);
    expect(view(s)).toMatchObject({ phase: 'acting', order: [bob] });
    act(s, bob, { t: 'stand' });
    nextRound(s);
    // Both bet; the host's turn comes and the host is idle: Bob stands it and plays on.
    betAll(s, [alice, bob]);
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 0 });
    act(s, bob, skipNow(s));
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
  });

  it('lets a host who sits the game out skip and deal', () => {
    const s = table();
    s.apply({ type: 'create', gameId: 'blackjack', name: 'Hana', avatar: AVATAR, connectionId: 'h' });
    const hana = s.playerId('Hana');
    s.platform(hana, { t: 'sitOut', sitOut: true });
    s.apply({ type: 'join', name: 'Pia', avatar: AVATAR, connectionId: 'p' });
    s.apply({ type: 'join', name: 'Quinn', avatar: AVATAR, connectionId: 'q' });
    const pia = s.playerId('Pia');
    const quinn = s.playerId('Quinn');
    for (const id of [pia, quinn]) s.platform(id, { t: 'ready', ready: true });
    s.platform(hana, { t: 'start' });
    expect(s.data.phase).toBe('playing');
    expect(view(s).order).toEqual([pia, quinn]);
    act(s, pia, { t: 'bet', amount: 10 });
    expect(controls(s, hana)).toEqual({ canSitOut: false, canDealNow: true, canSkip: false });
    // A watching host is never waited on: the players cannot deal.
    expect(controls(s, pia).canDealNow).toBe(false);
    rig(s, '10S', '9D', '6H', '7S');
    expect(chatTexts(act(s, hana, { t: 'dealNow' }))).toEqual(['Quinn sits this hand out.']);
    expect(view(s).turn).toEqual({ playerId: pia, handIndex: 0 });
    const skipped = act(s, hana, skipNow(s));
    expect(errorsOf(skipped)).toEqual([]);
    expect(chatTexts(skipped)).toContain("Hana stood Pia's hand.");
    expect(view(s).phase).toBe('results');
  });
});

describe('Blackjack: one hand at a time', () => {
  it('plays the seats in join order, each seat its hands left to right with split hands, the dealer last', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rig(s, '8S', '10H', '9C', '6D', '8H', '7C', '9D', '10S', '3H', '2C', '4D', '9S', 'KD');
    betAll(s, [alice, bob, carol]);
    const ids = [alice, bob, carol];
    /** Only the seat in play has anything lit; everyone else, spectators included, sees nothing to do. */
    const expectTurn = (playerId: string, handIndex: number) => {
      expect(view(s)).toMatchObject({ phase: 'acting', turn: { playerId, handIndex } });
      expect(nextDeadline(s.data)).toBeNull();
      for (const id of ids) if (id !== playerId) expect(view(s, id).actions, id).toEqual(NO_ACTIONS);
      expect(view(s, null).actions).toEqual(NO_ACTIONS);
      expect(view(s, playerId).actions.canStand).toBe(true);
    };

    expectTurn(alice, 0);
    expect(view(s, alice).actions).toEqual({ canHit: true, canStand: true, canDouble: true, canSplit: true });
    expect(errorsOf(act(s, bob, { t: 'stand' }))).toEqual(['It is not your turn.']);
    s.now += 1000;
    act(s, alice, { t: 'split' });
    expect(handsOf(s, alice).map((h) => [h.cards, h.status])).toEqual([
      [cards('8S', '3H'), 'acting'],
      [cards('8H', '2C'), 'waiting'],
    ]);
    expectTurn(alice, 0);
    s.now += 1000;
    act(s, alice, { t: 'hit' });
    expectTurn(alice, 0);
    s.now += 1000;
    act(s, alice, { t: 'stand' });
    expectTurn(alice, 1);
    // Doubling a split hand is allowed.
    expect(view(s, alice).actions).toEqual({ canHit: true, canStand: true, canDouble: true, canSplit: false });
    s.now += 1000;
    act(s, alice, { t: 'double' });
    expect(handsOf(s, alice)[1]).toMatchObject({ cards: cards('8H', '2C', '9S'), bet: 20, doubled: true, status: 'stood' });
    expectTurn(bob, 0);
    s.now += 1000;
    act(s, bob, { t: 'stand' });
    expectTurn(carol, 0);
    expect(view(s, carol).actions.canSplit).toBe(true);
    // The hole card is still face down while the last seat plays.
    expect(view(s, carol).dealer).toMatchObject({ cards: cards('6D'), holeHidden: true });
    s.now += 1000;
    const last = act(s, carol, { t: 'stand' });
    // Dealer 6 + 10 + K busts: every standing hand wins.
    expect(chatTexts(last)).toEqual(['The dealer busts with 26.', 'Alice wins 30, Bob wins 10, Carol wins 10.']);
    expect(results(s)).toEqual([
      { playerId: alice, handIndex: 0, outcome: 'win', bet: 10, payout: 20 },
      { playerId: alice, handIndex: 1, outcome: 'win', bet: 20, payout: 40 },
      { playerId: bob, handIndex: 0, outcome: 'win', bet: 10, payout: 20 },
      { playerId: carol, handIndex: 0, outcome: 'win', bet: 10, payout: 20 },
    ]);
    expect([chips(s, alice), chips(s, bob), chips(s, carol)]).toEqual([1030, 1010, 1010]);
  });
});

describe('Blackjack: splits', () => {
  it('re-splits pairs (ten-value cards mixed) with no cap, each hand with its own stake, and plays them left to right', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice']);
    rig(s, '10S', '6D', 'KH', '10H', 'QD', '5C', 'JC', '3H', 'KD', '4S', '7H', '9C', '7D', '9S', '2D');
    betAll(s, [alice]);
    expect(view(s, alice).actions.canSplit).toBe(true);
    expect(chatTexts(act(s, alice, { t: 'split' }))).toEqual(['Alice splits a pair.']);
    expect(handsOf(s, alice).map((h) => h.cards)).toEqual([cards('10S', 'QD'), cards('KH', '5C')]);
    expect(view(s, alice).actions.canSplit).toBe(true);
    act(s, alice, { t: 'split' });
    expect(handsOf(s, alice).map((h) => h.cards)).toEqual([cards('10S', 'JC'), cards('QD', '3H'), cards('KH', '5C')]);
    act(s, alice, { t: 'split' });
    expect(handsOf(s, alice).map((h) => h.cards)).toEqual([cards('10S', 'KD'), cards('JC', '4S'), cards('QD', '3H'), cards('KH', '5C')]);
    // Four hands is no limit: a fifth comes from the next pair.
    expect(view(s, alice).actions).toEqual({ canHit: true, canStand: true, canDouble: true, canSplit: true });
    act(s, alice, { t: 'split' });
    expect(handsOf(s, alice).map((h) => h.cards)).toEqual([cards('10S', '7H'), cards('KD', '9C'), cards('JC', '4S'), cards('QD', '3H'), cards('KH', '5C')]);
    expect(handsOf(s, alice).every((h) => h.fromSplit && h.bet === 10 && !h.splitAces)).toBe(true);
    expect(chips(s, alice)).toBe(950);
    expect(view(s, alice).actions.canSplit).toBe(false);
    expect(errorsOf(act(s, alice, { t: 'split' }))).toEqual(['You cannot split this hand.']);
    act(s, alice, { t: 'stand' });
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 1 });
    act(s, alice, { t: 'stand' });
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 2 });
    act(s, alice, { t: 'double' }); // 14 + 7 = 21 for twice the stake
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 3 });
    act(s, alice, { t: 'hit' }); // 13 + 9 busts
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 4 });
    const last = act(s, alice, { t: 'stand' });
    // Dealer 6 + 10 + 2 = 18.
    expect(chatTexts(last)).toEqual(['The dealer stands on 18.', 'Alice pushes.']);
    expect(lastHands(s, alice).map((h) => [h.total, h.bet, h.status, h.payout])).toEqual([
      [17, 10, 'lost', 0],
      [19, 10, 'won', 20],
      [21, 20, 'won', 40],
      [22, 10, 'bust', 0],
      [15, 10, 'lost', 0],
    ]);
    expect(chips(s, alice)).toBe(1000);
  });

  /** Splits whatever pair is in play until the seat holds `count` hands. */
  function splitTo(s: Sim, id: string, count: number): void {
    for (let guard = 0; handsOf(s, id).length < count && guard < count; guard++) {
      expect(view(s, id).actions.canSplit, `${handsOf(s, id).length} hands`).toBe(true);
      act(s, id, { t: 'split' });
    }
    expect(handsOf(s, id)).toHaveLength(count);
  }

  for (const count of [8, 16]) {
    it(`splits a run of pairs into ${count} hands, with a stake each, and plays them all left to right`, () => {
      const s = table();
      const [alice] = startGame(s, ['Alice']);
      const suits = ['S', 'H', 'D', 'C'];
      const eights = Array.from({ length: 2 * (count - 1) }, (_, i) => `8${suits[i % 4]}`);
      rig(s, '8S', '6D', '8H', '10H', ...eights);
      betAll(s, [alice]);
      splitTo(s, alice, count);
      expect(queued(s)).toBe(0);
      expect(chips(s, alice)).toBe(1000 - 10 * count);
      expect(handsOf(s, alice).every((h) => h.fromSplit && h.bet === 10 && h.total === 16 && h.cards.length === 2)).toBe(true);
      // Still no cap: the pair in play could be split again.
      expect(view(s, alice).actions.canSplit).toBe(true);
      for (let i = 0; i < count; i++) {
        expect(view(s).turn).toEqual({ playerId: alice, handIndex: i });
        act(s, alice, { t: 'stand' });
      }
      // Dealer 6 + 10 + 2 = 18 beats every 16.
      expect(lastHands(s, alice)).toHaveLength(count);
      expect(lastHands(s, alice).every((h) => h.outcome === 'loss')).toBe(true);
      expect(chips(s, alice)).toBe(1000 - 10 * count);
    });
  }

  it('stops splitting once the chips for another stake run out, however many pairs come', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice'], { startingChips: 100 });
    rig(s, '8S', '6D', '8H', '10H', ...Array<string>(12).fill('8C'));
    act(s, alice, { t: 'bet', amount: 20 });
    splitTo(s, alice, 5);
    expect(chips(s, alice)).toBe(0);
    expect(handsOf(s, alice)[0].cards).toEqual(cards('8S', '8C'));
    expect(view(s, alice).actions).toEqual({ canHit: true, canStand: true, canDouble: false, canSplit: false });
    expect(errorsOf(act(s, alice, { t: 'split' }))).toEqual(['You cannot split this hand.']);
    expect(handsOf(s, alice)).toHaveLength(5);
  });

  it('splits a pair dealt onto a later split hand when its turn comes', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice']);
    rig(s, '8S', '7D', '8H', '10C', '10S', '8D', '3C', '2H');
    betAll(s, [alice]);
    act(s, alice, { t: 'split' });
    expect(handsOf(s, alice).map((h) => h.cards)).toEqual([cards('8S', '10S'), cards('8H', '8D')]);
    expect(view(s, alice).actions.canSplit).toBe(false);
    act(s, alice, { t: 'stand' });
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 1 });
    expect(view(s, alice).actions.canSplit).toBe(true);
    act(s, alice, { t: 'split' });
    expect(handsOf(s, alice).map((h) => [h.cards, h.status])).toEqual([
      [cards('8S', '10S'), 'stood'],
      [cards('8H', '3C'), 'acting'],
      [cards('8D', '2H'), 'waiting'],
    ]);
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 1 });
    act(s, alice, { t: 'stand' });
    act(s, alice, { t: 'stand' });
    // Dealer 7 + 10 = 17: the 18 wins, the 11 and the 10 lose.
    expect(results(s).map((r) => r.payout)).toEqual([20, 0, 0]);
    expect(chips(s, alice)).toBe(990);
  });

  it('gives split aces one card each, lets an ace on a split ace be split again with no cap, and pays 21 on a split hand 1:1', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice']);
    rig(s, 'AS', '7S', 'AH', '10D', 'AD', 'AC', 'AS', 'AH', 'AD', 'AC', 'AS', 'AH', 'KC', '9H');
    betAll(s, [alice]);
    expect(chatTexts(act(s, alice, { t: 'split' }))).toEqual(['Alice splits aces.']);
    expect(handsOf(s, alice).map((h) => [h.cards, h.status, h.splitAces])).toEqual([
      [cards('AS', 'AD'), 'acting', true],
      [cards('AH', 'AC'), 'waiting', true],
    ]);
    // An ace on a split ace: split again or stand, never hit or double.
    expect(view(s, alice).actions).toEqual({ canHit: false, canStand: true, canDouble: false, canSplit: true });
    expect(errorsOf(act(s, alice, { t: 'hit' }))).toEqual(['Split aces take one card each.']);
    expect(errorsOf(act(s, alice, { t: 'double' }))).toEqual(['You cannot double this hand.']);
    act(s, alice, { t: 'split' });
    expect(handsOf(s, alice).map((h) => h.cards)).toEqual([cards('AS', 'AS'), cards('AD', 'AH'), cards('AH', 'AC')]);
    act(s, alice, { t: 'split' });
    act(s, alice, { t: 'split' });
    // Five hands and the ace in play still splits: there is no cap on aces either.
    expect(handsOf(s, alice)).toHaveLength(5);
    expect(view(s, alice).actions).toEqual({ canHit: false, canStand: true, canDouble: false, canSplit: true });
    act(s, alice, { t: 'split' });
    // The 21 and the 20 take their one card and stand; the pairs of aces after them wait for the player.
    expect(handsOf(s, alice).map((h) => [h.cards, h.status])).toEqual([
      [cards('AS', 'KC'), 'stood'],
      [cards('AS', '9H'), 'stood'],
      [cards('AD', 'AH'), 'acting'],
      [cards('AS', 'AC'), 'waiting'],
      [cards('AD', 'AH'), 'waiting'],
      [cards('AH', 'AC'), 'waiting'],
    ]);
    expect(handsOf(s, alice).every((h) => h.splitAces && h.fromSplit && h.bet === 10)).toBe(true);
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 2 });
    for (let i = 2; i < 5; i++) act(s, alice, { t: 'stand' });
    const last = act(s, alice, { t: 'stand' });
    // Dealer 7 + 10 = 17: the split 21 pays 1:1 (no blackjack), the 20 wins, the four 12s lose.
    expect(chatTexts(last)).toEqual(['The dealer stands on 17.', 'Alice loses 20.']);
    expect(lastHands(s, alice).map((h) => [h.total, h.outcome, h.payout])).toEqual([
      [21, 'win', 20],
      [20, 'win', 20],
      [12, 'loss', 0],
      [12, 'loss', 0],
      [12, 'loss', 0],
      [12, 'loss', 0],
    ]);
    expect(chips(s, alice)).toBe(980);
  });

  it('stands split aces that cannot be split again for want of chips, and refuses a split the table forbids or the chips cannot cover', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice'], { startingChips: 100 });
    rig(s, 'AS', '7S', 'AH', '10D', 'AD', '6C');
    act(s, alice, { t: 'bet', amount: 40 });
    const split = act(s, alice, { t: 'split' });
    expect(chatTexts(split)).toEqual(['Alice splits aces.', 'The dealer stands on 17.', 'Alice loses 40.']);
    expect(lastHands(s, alice).map((h) => [h.cards, h.outcome])).toEqual([
      [cards('AS', 'AD'), 'loss'],
      [cards('AH', '6C'), 'push'],
    ]);
    expect(chips(s, alice)).toBe(60);

    const broke = table();
    const [dave] = startGame(broke, ['Dave'], { startingChips: 100 });
    rig(broke, '8S', '6D', '8H', '10S', '2C');
    act(broke, dave, { t: 'bet', amount: 100 });
    expect(view(broke, dave).actions.canSplit).toBe(false);
    expect(errorsOf(act(broke, dave, { t: 'split' }))).toEqual(['You cannot split this hand.']);
  });
});

describe('Blackjack: the dealer', () => {
  it('peeks with an ace up: a dealer blackjack shows at once and settles the round, naturals push and nobody plays', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '10H', 'AD', 'KH', '9C', 'KS');
    act(s, alice, { t: 'bet', amount: 10 });
    const effects = act(s, bob, { t: 'bet', amount: 10 });
    expect(chatTexts(effects)).toEqual(['Alice has blackjack!', 'The dealer has blackjack.', 'Alice pushes, Bob loses 10.']);
    expect(effects.some((e) => e.type === 'send' && e.msg.t === 'room' && (e.msg as { room: RoomState<BlackjackView> }).room.game?.phase === 'acting')).toBe(false);
    // Only the hole card turns over: the reveal allowance is the flip alone.
    expect(view(s)).toMatchObject({ phase: 'results', round: 1 });
    expect(view(s).lastRound).toMatchObject({
      peeked: true,
      revealEndsAt: s.now + 1200,
      dealer: { cards: cards('AD', 'KS'), holeHidden: false, total: 21, soft: true, blackjack: true },
    });
    expect(results(s)).toEqual([
      { playerId: alice, handIndex: 0, outcome: 'push', bet: 10, payout: 10 },
      { playerId: bob, handIndex: 0, outcome: 'loss', bet: 10, payout: 0 },
    ]);
    expect(lastHands(s, alice)[0].status).toBe('push');
    expect(lastHands(s, bob)[0]).toMatchObject({ cards: cards('10H', '9C'), status: 'lost' });
    expect([chips(s, alice), chips(s, bob)]).toEqual([1000, 990]);
  });

  it('peeks with a ten-value card up too, and plays on with the hole card hidden when there is no blackjack', () => {
    const ten = table();
    const [alice] = startGame(ten, ['Alice']);
    rig(ten, '9S', 'KD', '7H', 'AH');
    const peeked = act(ten, alice, { t: 'bet', amount: 10 });
    expect(chatTexts(peeked)).toEqual(['The dealer has blackjack.', 'Alice loses 10.']);
    expect(ten.data.game && view(ten).lastRound?.peeked).toBe(true);

    const none = table();
    const [bob] = startGame(none, ['Bob']);
    rig(none, '10S', 'AD', '7H', '9C');
    const dealt = act(none, bob, { t: 'bet', amount: 10 });
    expect(chatTexts(dealt)).toEqual([]);
    expect(view(none)).toMatchObject({ phase: 'acting', turn: { playerId: bob, handIndex: 0 } });
    for (const viewer of [bob, null]) {
      expect(view(none, viewer).dealer).toEqual({ cards: cards('AD'), holeHidden: true, total: 11, soft: true, blackjack: false });
      expect(JSON.stringify(view(none, viewer))).not.toContain('{"rank":"9","suit":"C"}');
    }
    const stood = act(none, bob, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 20.', 'Bob loses 10.']);
    expect(view(none).lastRound?.peeked).toBe(false);
  });

  it('never peeks under a low up card: a natural there is settled when the dealer plays', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice']);
    rig(s, 'AS', '9D', 'KH', '8S');
    betAll(s, [alice]);
    expect(chatTexts(s.effects).slice(-3)).toEqual(['Alice has blackjack!', 'The dealer shows 17.', 'Alice wins 15.']);
    expect(results(s)).toEqual([{ playerId: alice, handIndex: 0, outcome: 'blackjack', bet: 10, payout: 25 }]);
    expect(chips(s, alice)).toBe(1015);
  });

  it('stands on a soft 17', () => {
    const stands = table();
    const [alice] = startGame(stands, ['Alice']);
    rig(stands, '10S', 'AD', '8H', '6S', '4C');
    betAll(stands, [alice]);
    const stood = act(stands, alice, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 17.', 'Alice wins 10.']);
    expect(view(stands).lastRound?.dealer).toEqual({ cards: cards('AD', '6S'), holeHidden: false, total: 17, soft: true, blackjack: false });
    expect(chips(stands, alice)).toBe(1010);
  });

  it('shows the hole card without drawing when no hand is left standing', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice']);
    rig(s, '10S', '6D', '6H', '10S', 'KD', '5C');
    betAll(s, [alice]);
    const effects = act(s, alice, { t: 'hit' });
    expect(chatTexts(effects)).toEqual(['Alice busts with 26.', 'The dealer shows 16.', 'Alice loses 10.']);
    expect(view(s).lastRound?.dealer).toEqual({ cards: cards('6D', '10S'), holeHidden: false, total: 16, soft: false, blackjack: false });
    expect(queued(s)).toBe(1);
  });
});

describe('Blackjack: rounds', () => {
  it("shows a settled table for the dealer's reveal only, then opens the next betting, unclocked, with the last table on show until the deal", () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    act(s, alice, { t: 'stand' });
    const settled = act(s, bob, { t: 'stand' });
    expect(chatTexts(settled)).toEqual(['The dealer stands on 18.', 'Alice loses 10, Bob loses 10.']);
    // One card drawn after the hole card: 1200 + 500 ms for the reveal, and no wait after it.
    const settledAt = s.now;
    expect(data(s).phase).toEqual({ kind: 'results', endsAt: settledAt + 1700 });
    expect(chatTexts(nextRound(s))).toEqual(['Round 2: place your bets!']);
    expect(s.now).toBe(settledAt + 1700);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, bob], waitingFor: [alice, bob] });
    expect(nextDeadline(s.data)).toBeNull();
    expect(view(s).dealer).toEqual({ cards: [], holeHidden: true, total: 0, soft: false, blackjack: false });
    expect(view(s).players[alice]).toMatchObject({ bet: 0, hands: [], inRound: true });
    expect(view(s).lastRound).toMatchObject({ round: 1, order: [alice, bob], dealer: { cards: cards('9D', '7S', '2C') }, revealEndsAt: settledAt + 1700 });
    // A bet does not clear it; the deal does.
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    act(s, alice, { t: 'bet', amount: 10 });
    expect(view(s).lastRound?.round).toBe(1);
    act(s, bob, { t: 'bet', amount: 10 });
    expect(view(s)).toMatchObject({ phase: 'acting', round: 2, lastRound: null });
    act(s, alice, { t: 'stand' });
    act(s, bob, { t: 'stand' });
    expect(chatTexts(nextRound(s))).toEqual(['Round 3: place your bets!']);
    expect(view(s).round).toBe(3);
  });

  it('holds the next bets for the whole pause: no bet, sit-out or deal before it, a newcomer still only watches after it, and the host can end the game during it', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice']);
    rig(s, '10S', '9D', '8H', '7C');
    act(s, alice, { t: 'bet', amount: 10 });
    act(s, alice, { t: 'stand' });
    expect(view(s)).toMatchObject({ phase: 'results', round: 1, waitingFor: [] });
    // A lone player cannot bet into the next round while the table is still on show.
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 10 }))).toEqual(['You cannot bet right now.']);
    expect(errorsOf(act(s, alice, { t: 'sitOutHand' }))).toEqual(['You cannot sit out right now.']);
    expect(errorsOf(act(s, alice, { t: 'dealNow' }))).toEqual(['The cards are already out.']);
    expect(errorsOf(act(s, alice, { t: 'skip', playerId: alice, handIndex: 0 }))).toEqual(['There is no turn to skip.']);
    s.apply({ type: 'join', name: 'Bob', avatar: AVATAR, connectionId: 'b' });
    const bob = s.playerId('Bob');
    expect(data(s).seats[bob]).toBeUndefined();
    // The pause runs out: round 2 opens without the newcomer, who watches until the next game.
    nextRound(s);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice], waitingFor: [alice] });
    expect(data(s).seats[bob]).toBeUndefined();

    const ended = table();
    const [carol, dave] = startGame(ended, ['Carol', 'Dave']);
    rig(ended, '10S', '9D', '8H', '7C', '6S', '5H');
    betAll(ended, [carol, dave]);
    act(ended, carol, { t: 'stand' });
    act(ended, dave, { t: 'stand' });
    expect(view(ended).phase).toBe('results');
    // A player who leaves during the pause is gone from the next round.
    ended.apply({ type: 'leave', playerId: dave });
    expect(view(ended).phase).toBe('results');
    expect(chatTexts(act(ended, carol, { t: 'endGame' }))).toEqual(['The host ended the game.', 'Game over! Carol wins with 1000 points.']);
    expect(ended.data.phase).toBe('ended');
  });

  it('holds once a pause runs out with nobody still in the game connected', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '9D', '8H', '7C', '6S', '5H');
    betAll(s, [alice, bob]);
    act(s, alice, { t: 'stand' });
    act(s, bob, { t: 'stand' });
    disconnect(s, alice, 'Alice');
    disconnect(s, bob, 'Bob');
    expect(view(s).phase).toBe('results');
    expect(chatTexts(nextRound(s))).toEqual(['Waiting for Alice, Bob to reconnect…']);
    expect(view(s)).toMatchObject({ phase: 'held', round: 1 });
  });

  it('never runs out of rounds: a table plays on round after round while two stacks are left', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    for (let round = 1; round <= 60; round++) {
      expect(view(s)).toMatchObject({ phase: 'betting', round });
      betAll(s, [alice, bob], 1);
      for (let guard = 0; view(s).phase === 'acting' && guard < 20; guard++) {
        const turn = view(s).turn;
        if (turn) act(s, turn.playerId, { t: 'stand' });
      }
      nextRound(s);
    }
    expect(s.data.phase).toBe('playing');
    expect(view(s).round).toBe(61);
  });

  it('puts a player with no chips left out of the game to watch, and a stack that is out counts for nothing in a hold', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { startingChips: 100 });
    rig(s, '10S', '10H', '10C', '10D', '6H', '9C', '9S', '7S');
    act(s, alice, { t: 'bet', amount: 100 });
    betAll(s, [bob, carol], 50);
    act(s, alice, { t: 'stand' });
    act(s, bob, { t: 'stand' });
    const stood = act(s, carol, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 17.', 'Alice loses 100, Bob wins 50, Carol wins 50.', 'Alice is out of chips.']);
    expect(view(s).players[alice]).toEqual({ chips: 0, bet: 0, hands: [], inRound: false, sittingOut: false, bustedOut: true });
    expect([score(s, alice), score(s, bob), score(s, carol)]).toEqual([0, 150, 150]);
    nextRound(s);
    expect(view(s)).toMatchObject({ round: 2, order: [bob, carol] });
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 50 }))).toEqual(['You cannot bet right now.']);
    expect(view(s, alice).actions).toEqual(NO_ACTIONS);

    // Alice keeps her socket but counts for nothing: with Bob and Carol away at the settle the next round holds.
    betAll(s, [bob, carol], 50);
    expect(chatTexts(disconnect(s, bob, 'Bob'))).toContain('Bob is away and stands.');
    const settled = disconnect(s, carol, 'Carol');
    expect(chatTexts(settled).slice(-3)).toEqual(['Carol is away and stands.', 'The dealer stands on 18.', 'Bob loses 50, Carol loses 50.']);
    expect(chatTexts(nextRound(s))).toEqual(['Waiting for Bob, Carol to reconnect…']);
    expect(waiting(s)).toEqual([bob, carol]);
    expect(view(s)).toMatchObject({ phase: 'held', lastRound: { round: 2 } });
    expect(data(s).phase).toEqual({ kind: 'held', resumeAt: null });
    reconnect(s, bob, 'Bob');
    tick(s, RESUME_SETTLE_MS);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 3, order: [bob, carol] });
  });

  it('ends once everyone is out of chips', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { startingChips: 100 });
    rig(s, '10S', '10H', '10D', '6H', '6C', '7S');
    betAll(s, [alice, bob], 100);
    act(s, alice, { t: 'stand' });
    const last = act(s, bob, { t: 'stand' });
    expect(chatTexts(last)).toEqual(['The dealer stands on 17.', 'Alice loses 100, Bob loses 100.', 'Alice is out of chips.', 'Bob is out of chips.', 'Everyone is out of chips. The house wins.']);
    expect(view(s).phase).toBe('ending');
    const over = tick(s, 1200 + RESULTS_MS);
    expect(chatTexts(over)).toEqual(['Game over! Alice and Bob tie with 0 points.']);
    expect(s.data.phase).toBe('ended');
  });

  it('deals from an endless deck: every card drawn on its own from the 52, so a round never runs out and nothing is ever reshuffled', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice']);
    // The same card five times over, and then twos for ever: no shoe could deal that.
    rig(s, 'AS', 'AS', 'AS', 'AS', 'AS');
    betAll(s, [alice]);
    expect(handsOf(s, alice)[0].cards).toEqual(cards('AS', 'AS'));
    expect(view(s).dealer.cards).toEqual(cards('AS'));
    act(s, alice, { t: 'split' });
    for (let i = 0; i < 6; i++) if (view(s).phase === 'acting') act(s, alice, { t: 'stand' });
    nextRound(s);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2 });
    // No shoe, size or reshuffle flag in the state or the view.
    expect(Object.keys(data(s)).sort()).toEqual(['dealer', 'endRequested', 'holeHidden', 'lastRound', 'order', 'phase', 'round', 'seats']);
    expect(view(s)).not.toHaveProperty('shoeRemaining');
    expect(view(s)).not.toHaveProperty('reshuffled');
    expect(chatTexts(s.effects).filter((line) => /shoe|shuffl/i.test(line))).toEqual([]);
  });

  it('plays a room stored with the old shoe, dropping it at the next round', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice']);
    s.data = { ...s.data, game: { ...data(s), shoe: cards('KS', 'KH'), shoeSize: 312, reshuffled: true } as BlackjackData };
    rig(s, '10S', '9D', '8H', '7C');
    betAll(s, [alice]);
    // The stored cards are never dealt: the endless deck is.
    expect(handsOf(s, alice)[0].cards).toEqual(cards('10S', '8H'));
    act(s, alice, { t: 'stand' });
    nextRound(s);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2 });
    expect(data(s)).not.toHaveProperty('shoe');
    expect(data(s)).not.toHaveProperty('shoeSize');
    expect(data(s)).not.toHaveProperty('reshuffled');
  });

  it('draws every card about as often as any other through the module (a chi-squared check with a seeded rng)', () => {
    const players = [0, 1].map((i) => ({ id: `p${i}`, name: `P${i + 1}`, joinOrder: i, connected: true, score: 0 }));
    const rng = seeded(2026);
    const settings = { ...defaultPlatformSettings(gameById('blackjack')), ...blackjackModule.settings.defaults, startingChips: 100_000 };
    const ctx = { now: START, rng, newId: () => 'x', settings, players, spectators: [], hostId: 'p0' };
    let game = blackjackModule.start(ctx).data;
    const counts = new Map<string, number>();
    let drawn = 0;
    for (let round = 0; drawn < 26_000; round++) {
      for (const p of players) game = blackjackModule.handle(ctx, game, { type: 'message', playerId: p.id, msg: { t: 'bet', amount: 1 } }).data;
      for (let guard = 0; guard < 50 && game.phase.kind === 'acting'; guard++) {
        game = blackjackModule.handle(ctx, game, { type: 'message', playerId: game.phase.playerId, msg: { t: 'hit' } }).data;
      }
      // Every round settles, shows its table for the dealer's reveal, then opens the next one's betting: no round is counted twice.
      if (game.phase.kind !== 'results') throw new Error(`no results pause but ${game.phase.kind}`);
      ctx.now = game.phase.endsAt;
      game = blackjackModule.handle(ctx, game, { type: 'tick' }).data;
      const last = game.lastRound;
      expect([game.phase.kind, last?.round]).toEqual(['betting', round + 1]);
      if (!last) throw new Error('the round did not settle');
      const all = [...last.dealer, ...Object.values(last.hands).flatMap((hands) => hands.flatMap((h) => h.cards))];
      for (const c of all) counts.set(c.rank + c.suit, (counts.get(c.rank + c.suit) ?? 0) + 1);
      drawn += all.length;
    }
    expect(counts.size).toBe(52);
    const expected = drawn / 52;
    const chi = [...counts.values()].reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
    // 51 degrees of freedom: the 99.9th percentile is about 87.
    expect(chi).toBeLessThan(87);
  }, 30_000);

  it('keeps a fifty-seat table going round after round while the seats split all they can: nothing throws and no card ever runs out', () => {
    // Driven through the module itself: fifty seats through the whole engine would project fifty views per move.
    const players = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `P${i + 1}`, joinOrder: i, connected: true, score: 0 }));
    const uniform = seeded(7);
    // Nearly a third of the cards are eights, so pairs (and splits of splits) come all the time.
    const rng = (): number => (uniform() < 0.3 ? valueOf(card('8D')) : uniform());
    const settings = { ...defaultPlatformSettings(gameById('blackjack')), ...blackjackModule.settings.defaults };
    const ctx = { now: START, rng, newId: () => 'x', settings, players, spectators: [], hostId: 'p0' };
    const lines: string[] = [];
    const collect = (effects: readonly { type: string; text?: string }[]): void => {
      for (const e of effects) if (e.type === 'chat' && e.text) lines.push(e.text);
    };
    const started = blackjackModule.start(ctx);
    let game = started.data;
    collect(started.effects);
    const send = (playerId: string, msg: BlackjackClientMessage): void => {
      const next = blackjackModule.handle(ctx, game, { type: 'message', playerId, msg });
      game = next.data;
      collect(next.effects);
    };
    let most = 0;
    for (let round = 1; round <= 12; round++) {
      expect(game.phase.kind).toBe('betting');
      for (const p of players) send(p.id, { t: 'bet', amount: 50 });
      // Every seat plays it out the long way: split whatever it can, hit to 17.
      for (let guard = 0; guard < 20_000 && game.phase.kind === 'acting'; guard++) {
        const { playerId, handIndex } = game.phase;
        const hand = game.seats[playerId].hands[handIndex];
        most = Math.max(most, game.seats[playerId].hands.length);
        const actions = blackjackModule.view(game, playerId, ctx).actions;
        send(playerId, actions.canSplit ? { t: 'split' } : actions.canHit && handTotal(hand.cards).total < 17 ? { t: 'hit' } : { t: 'stand' });
      }
      for (const seat of Object.values(game.seats)) expect(seat.chips).toBeGreaterThanOrEqual(0);
      if (game.phase.kind !== 'results') throw new Error(`no results pause but ${game.phase.kind}`);
      ctx.now = game.phase.endsAt;
      const next = blackjackModule.handle(ctx, game, { type: 'tick' });
      game = next.data;
      collect(next.effects);
    }
    expect(game.round).toBe(13);
    expect(most).toBeGreaterThan(4);
    expect(lines.filter((line) => line.includes('splits')).length).toBeGreaterThan(100);
    expect(lines.filter((line) => /shoe|shuffl/i.test(line))).toEqual([]);
  }, 60_000);

  it('deals a fifty-seat table in one go, quick enough to show, and the first turn waits for its player', () => {
    const players = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `P${i + 1}`, joinOrder: i, connected: true, score: 0 }));
    const settings = { ...defaultPlatformSettings(gameById('blackjack')), ...blackjackModule.settings.defaults };
    const ctx = { now: START, rng: () => 0.5, newId: () => 'x', settings, players, spectators: [], hostId: 'p0' };
    let game = blackjackModule.start(ctx).data;
    for (const p of players) game = blackjackModule.handle(ctx, game, { type: 'message', playerId: p.id, msg: { t: 'bet', amount: 1 } }).data;
    expect(game.phase.kind).toBe('acting');
    expect(blackjackModule.nextDeadline(game)).toBeNull();
    // The deal takes this long to show on a phone (the discards, then 102 cards one after another).
    expect(dealAllowanceMs(50)).toBeGreaterThan(BLACKJACK_DEAL.discard + 101 * MIN_DEAL_GAP_MS);
    // The whole deal stays under the client's animation backlog, so a snapshot mid-deal never snaps it.
    expect(dealAllowanceMs(50)).toBeLessThan(3000);
  });
});

describe('Blackjack: the end', () => {
  it('plays on until one player is left with chips: the last one standing', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { startingChips: 100 });
    expect(chatTexts(s.effects)).toContain('Round 1: place your bets!');
    rig(s, '10S', '10H', '9D', '6H', '6C', '8S');
    betAll(s, [alice, bob], 50);
    act(s, alice, { t: 'stand' });
    const first = act(s, bob, { t: 'stand' });
    expect(chatTexts(first)).toEqual(['The dealer stands on 17.', 'Alice loses 50, Bob loses 50.']);
    nextRound(s);

    rig(s, '10S', '10H', '9D', '6H', 'KC', '8S');
    betAll(s, [alice, bob], 50);
    act(s, alice, { t: 'stand' });
    const second = act(s, bob, { t: 'stand' });
    expect(chatTexts(second)).toEqual(['The dealer stands on 17.', 'Alice loses 50, Bob wins 50.', 'Alice is out of chips.', 'Bob is the last one standing.']);
    // The final table stays up for the reveal, then five seconds.
    expect(data(s).phase).toEqual({ kind: 'ending', endsAt: s.now + 1200 + RESULTS_MS });
    expect(tick(s, 1200 + RESULTS_MS - 1)).toEqual([]);
    tick(s, 1);
    expect(s.data.phase).toBe('ended');
    expect(s.data.podium).toEqual([
      { playerId: bob, score: 100, rank: 1 },
      { playerId: alice, score: 0, rank: 2 },
    ]);
  });

  it('plays a lone player (or one left alone by a leave) on until their chips are gone', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice'], { startingChips: 100 });
    rig(s, '10S', '9D', 'KH', '8S');
    const won = act(s, alice, { t: 'bet', amount: 50 });
    act(s, alice, { t: 'stand' });
    expect(chatTexts(won)).toEqual([]);
    expect(chatTexts(s.effects).slice(-1)).toEqual(['Alice wins 50.']);
    nextRound(s);
    rig(s, '10S', '9D', '6H', '8S');
    act(s, alice, { t: 'bet', amount: 100 });
    expect(chatTexts(act(s, alice, { t: 'stand' }))).toEqual(['The dealer stands on 17.', 'Alice loses 100.']);
    nextRound(s);
    rig(s, '10S', '9D', '6H', '8S');
    act(s, alice, { t: 'bet', amount: 50 });
    expect(chatTexts(act(s, alice, { t: 'stand' }))).toEqual(['The dealer stands on 17.', 'Alice loses 50.', 'Alice is out of chips.', 'Everyone is out of chips. The house wins.']);
    expect(view(s).phase).toBe('ending');

    const left = table();
    const [carol, dave] = startGame(left, ['Carol', 'Dave']);
    left.apply({ type: 'leave', playerId: dave });
    rig(left, '10S', '9D', 'KH', '8S');
    act(left, carol, { t: 'bet', amount: 10 });
    act(left, carol, { t: 'stand' });
    expect(chatTexts(nextRound(left))).toEqual(['Round 2: place your bets!']);
    expect(view(left)).toMatchObject({ phase: 'betting', round: 2, order: [carol] });
  });

  it('ends when the last stack is gone, whoever is watching: a newcomer never keeps the game going', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice'], { startingChips: 100 });
    rig(s, '10S', '9D', '6H', '8S');
    act(s, alice, { t: 'bet', amount: 100 });
    s.apply({ type: 'join', name: 'Bob', avatar: AVATAR, connectionId: 'b' });
    const bob = s.playerId('Bob');
    const settled = act(s, alice, { t: 'stand' });
    expect(chatTexts(settled)).toEqual(['The dealer stands on 17.', 'Alice loses 100.', 'Alice is out of chips.', 'Everyone is out of chips. The house wins.']);
    expect(view(s).phase).toBe('ending');
    tick(s, 1200 + RESULTS_MS);
    expect(s.data.phase).toBe('ended');
    expect(s.data.podium).toEqual([{ playerId: alice, score: 0, rank: 1 }]);
    expect(data(s).seats[bob]).toBeUndefined();
  });
});

describe('Blackjack: the host ends the game', () => {
  it('ends at once during the betting, every stake back, straight to the podium; only the host may', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    act(s, alice, { t: 'bet', amount: 100 });
    expect(chips(s, alice)).toBe(900);
    expect(errorsOf(act(s, bob, { t: 'endGame' }))).toEqual(['Only the host can end the game.']);
    const effects = act(s, alice, { t: 'endGame' });
    expect(chatTexts(effects)).toEqual(['The host ended the game.', 'Game over! Alice and Bob tie with 1000 points.']);
    expect([chips(s, alice), score(s, alice)]).toEqual([1000, 1000]);
    expect(s.data.phase).toBe('ended');
    expect(view(s)).toMatchObject({ phase: 'gameOver', endRequested: true });
  });

  it('ends at once while everyone sits the hand out', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    act(s, alice, { t: 'sitOutHand' });
    act(s, bob, { t: 'sitOutHand' });
    expect(view(s)).toMatchObject({ phase: 'betting', waitingFor: [] });
    expect(chatTexts(act(s, alice, { t: 'endGame' }))).toEqual(['The host ended the game.', 'Game over! Alice and Bob tie with 1000 points.']);
    expect(s.data.phase).toBe('ended');
  });

  it('ends after the hand in play settles, through the final pause instead of the next betting, then the podium ranked by chips', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '9H', '5D', 'KH', '7C', '10S', '2S');
    betAll(s, [alice, bob]);
    const asked = act(s, alice, { t: 'endGame' });
    expect(chatTexts(asked)).toEqual(['The host ends the game after this hand.']);
    expect(view(s)).toMatchObject({ phase: 'acting', endRequested: true, turn: { playerId: bob, handIndex: 0 } });
    expect(errorsOf(act(s, alice, { t: 'endGame' }))).toEqual(['The game ends after this hand.']);
    const settled = act(s, bob, { t: 'stand' });
    expect(chatTexts(settled)).toEqual(['The dealer stands on 17.', 'Alice wins 15, Bob loses 10.']);
    expect(view(s)).toMatchObject({ phase: 'ending', lastRound: { round: 1 } });
    expect(data(s).phase).toEqual({ kind: 'ending', endsAt: s.now + 1700 + RESULTS_MS });
    expect(s.data.phase).toBe('playing');
    expect(errorsOf(act(s, alice, { t: 'endGame' }))).toEqual(['The game is ending already.']);
    expect(tick(s, 1700 + RESULTS_MS - 1)).toEqual([]);
    const effects = tick(s, 1);
    expect(s.data.phase).toBe('ended');
    expect(data(s).phase).toEqual({ kind: 'gameOver' });
    expect(view(s)).toMatchObject({ phase: 'gameOver', turn: null, lastRound: { round: 1 } });
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 1015, rank: 1 },
      { playerId: bob, score: 990, rank: 2 },
    ]);
    expect(chatTexts(effects)).toEqual(['Game over! Alice wins with 1015 points.']);
    expect(nextDeadline(s.data)).toBeNull();
    expect(errorsOf(s.game(alice, { t: 'endGame' }))).toEqual(['The game is not running.']);
  });

  it('ends at once while the table is held, clearing the hold', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { startingChips: 100 });
    rig(s, '10S', '10H', '10C', '10D', '6H', '9C', '9S', '7S');
    act(s, alice, { t: 'bet', amount: 100 });
    betAll(s, [bob, carol], 50);
    act(s, alice, { t: 'stand' });
    // Alice is out of chips but still the host and connected; Bob and Carol, the stacks left, drop on their turns.
    disconnect(s, bob, 'Bob');
    disconnect(s, carol, 'Carol');
    nextRound(s);
    expect(view(s).phase).toBe('held');
    expect(waiting(s)).toEqual([bob, carol]);
    const effects = act(s, alice, { t: 'endGame' });
    expect(chatTexts(effects)).toEqual(['The host ended the game.', 'Game over! Bob and Carol tie with 150 points.']);
    expect(waiting(s)).toBeNull();
    expect(s.data.phase).toBe('ended');
  });
});

describe('Blackjack: seats coming and going', () => {
  it('lets a late joiner watch the whole game: no seat, no stack, no bet, round after round', () => {
    const s = table();
    const [alice] = startGame(s, ['Alice']);
    rig(s, '10S', '6D', '8H', '10S', '3C');
    act(s, alice, { t: 'bet', amount: 10 });
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expectScoresMatchChips(s);
    expect(score(s, carol)).toBe(0);
    expect(data(s).seats[carol]).toBeUndefined();
    expect(view(s).players[carol]).toBeUndefined();
    expect(view(s)).toMatchObject({ order: [alice], phase: 'acting' });
    expect(errorsOf(act(s, carol, { t: 'bet', amount: 10 }))).toEqual(['You are watching this game.']);
    act(s, alice, { t: 'stand' });
    nextRound(s);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice] });
    expect(errorsOf(act(s, carol, { t: 'bet', amount: 20 }))).toEqual(['You are watching this game.']);
    expect(score(s, carol)).toBe(0);
  });

  it('has no seat limit: everyone ready at the start is dealt in, and newcomers watch', () => {
    const s = table();
    const names = 'ABCDEFGHIJKLMNOPQRST'.split('');
    const ids = startGame(s, names);
    expect(gameById('blackjack').maxPlayers).toBeNull();
    expect(view(s).order).toEqual(ids);
    const late = ['U', 'V'].map((name) => {
      s.apply({ type: 'join', name, avatar: AVATAR, connectionId: name });
      return s.playerId(name);
    });
    betAll(s, ids);
    for (let guard = 0; view(s).phase === 'acting' && guard < 50; guard++) {
      const turn = view(s).turn;
      if (turn) act(s, turn.playerId, { t: 'stand' });
    }
    nextRound(s);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: ids });
    expect(view(s).order).toHaveLength(20);
    expect(late.map((id) => data(s).seats[id])).toEqual([undefined, undefined]);
  });

  it('leaves a newcomer who arrived during the final pause off the podium: nobody who never played is ranked', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '9H', '5D', 'KH', '7C', '10S', '2S');
    betAll(s, [alice, bob]);
    act(s, alice, { t: 'endGame' });
    act(s, bob, { t: 'stand' });
    expect(view(s).phase).toBe('ending');
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expectScoresMatchChips(s);
    expect([score(s, carol), data(s).seats[carol]]).toEqual([0, undefined]);
    expect(view(s).phase).toBe('ending');
    const over = tick(s, 1700 + RESULTS_MS);
    expect(s.data.phase).toBe('ended');
    expect(chatTexts(over)).toEqual(['Game over! Alice wins with 1015 points.']);
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 1015, rank: 1 },
      { playerId: bob, score: 990, rank: 2 },
    ]);
    expect(s.data.players.find((p) => p.id === carol)?.participating).toBe(false);
  });

  it('deals when the last player still to bet leaves, passes the play when the acting player leaves, and drops leavers from the last table', () => {
    const s = table();
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '8D', '2C');
    act(s, alice, { t: 'bet', amount: 10 });
    act(s, carol, { t: 'bet', amount: 10 });
    expect(view(s).phase).toBe('betting');
    s.apply({ type: 'leave', playerId: bob });
    expectScoresMatchChips(s);
    expect(view(s)).toMatchObject({ phase: 'acting', order: [alice, carol], turn: { playerId: alice, handIndex: 0 } });
    expect(data(s).seats[bob]).toBeUndefined();
    expect(view(s).players[bob]).toBeUndefined();
    s.apply({ type: 'leave', playerId: alice });
    expectScoresMatchChips(s);
    expect(view(s)).toMatchObject({ order: [carol], turn: { playerId: carol, handIndex: 0 } });
    expect(s.data.phase).toBe('playing');
    act(s, carol, { t: 'stand' });
    nextRound(s);
    expect(view(s).phase).toBe('betting');
    expect(results(s).every((r) => r.playerId === carol)).toBe(true);

    // Dave comes in before any stake is down, but only to watch: once Carol leaves nobody is left to play.
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' });
    const dave = s.playerId('Dave');
    s.apply({ type: 'leave', playerId: carol });
    expect(s.data.phase).toBe('lobby');
    expect(s.data.players.map((p) => [p.id, p.participating])).toEqual([[dave, false]]);
  });

  it('holds before the next round while nobody still in the game is connected, and seats everyone back after a settle', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    act(s, alice, { t: 'stand' });
    disconnect(s, alice, 'Alice');
    const settled = disconnect(s, bob, 'Bob');
    expect(chatTexts(settled).slice(-3)).toEqual(['Bob is away and stands.', 'The dealer stands on 18.', 'Alice loses 10, Bob loses 10.']);
    expect(chatTexts(nextRound(s))).toEqual(['Waiting for Alice, Bob to reconnect…']);
    expect(waiting(s)).toEqual([alice, bob]);
    expect(view(s)).toMatchObject({ phase: 'held', round: 1, lastRound: { round: 1 } });
    expect(nextDeadline(s.data)).toBeGreaterThan(s.now + RESUME_SETTLE_MS); // the seat expiries only
    // Nothing happens while the hold lasts.
    expect(tick(s, 60_000)).toEqual([]);

    reconnect(s, bob, 'Bob');
    expect(waiting(s)).toEqual([alice]);
    expect(data(s).phase).toEqual({ kind: 'held', resumeAt: s.now + RESUME_SETTLE_MS });
    // A further reconnect restarts the settle; then the round starts for everyone seated, Alice included.
    s.now += 1000;
    reconnect(s, alice, 'Alice');
    expect(data(s).phase).toEqual({ kind: 'held', resumeAt: s.now + RESUME_SETTLE_MS });
    expect(tick(s, RESUME_SETTLE_MS - 1)).toEqual([]);
    const resumed = tick(s, 1);
    expect(chatTexts(resumed)).toEqual(['Round 2: place your bets!']);
    expect(waiting(s)).toBeNull();
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, bob], waitingFor: [alice, bob] });
  });

  it('keeps going mid-round when a player drops: their hand stands, the next round goes on without them, and they sit out a hand they never bet on', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    act(s, alice, { t: 'stand' });
    const effects = disconnect(s, bob, 'Bob');
    // Alice alone is enough for the next round; Bob keeps his seat.
    expect(chatTexts(effects).slice(-3)).toEqual(['Bob is away and stands.', 'The dealer stands on 18.', 'Alice loses 10, Bob loses 10.']);
    nextRound(s);
    expect(waiting(s)).toBeNull();
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, bob], waitingFor: [alice] });
    const dealt = act(s, alice, { t: 'bet', amount: 10 });
    expect(chatTexts(dealt)).toEqual(['Bob sits this hand out.']);
    expect(view(s)).toMatchObject({ phase: 'acting', order: [alice], lastRound: null });
    expect(chips(s, bob)).toBe(990);
  });

  it('is a pure module: the same object comes back when nothing changed, and the view copies its cards', () => {
    const s = table();
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    const game = data(s);
    const players = [
      { id: alice, name: 'Alice', joinOrder: 0, connected: true, score: 1000 },
      { id: bob, name: 'Bob', joinOrder: 1, connected: true, score: 1000 },
    ];
    const ctx = { now: s.now, rng: () => 0, newId: () => 'x', settings: { ...defaultPlatformSettings(gameById('blackjack')), ...blackjackModule.settings.defaults }, players, spectators: [], hostId: alice };
    expect(blackjackModule.handle(ctx, game, { type: 'tick' }).data).toBe(game);
    expect(blackjackModule.handle(ctx, game, { type: 'chat', playerId: alice, text: 'hi' }).data).toBe(game);
    expect(blackjackModule.handle(ctx, game, { type: 'playerReconnected', playerId: alice }).data).toBe(game);
    const bet = blackjackModule.handle(ctx, game, { type: 'message', playerId: alice, msg: { t: 'bet', amount: 10 } });
    expect(bet.data).not.toBe(game);
    expect(bet.data.seats[alice]).toMatchObject({ chips: 990, bet: 10 });
    expect(game.seats[alice].chips).toBe(1000);
    expect(bet.effects).toEqual([
      { type: 'score', playerId: alice, delta: -10 },
      { type: 'snapshot', to: 'all' },
    ]);
    const projected = blackjackModule.view(bet.data, alice, ctx);
    expect(projected.order).not.toBe(bet.data.order);
    expect(projected.dealer.cards).toEqual([]);
  });
});
