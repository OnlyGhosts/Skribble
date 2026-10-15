/** Blackjack's rules through the pure engine: betting, the deal and the peek, the moves one hand at a time, splits, the dealer, payouts, chips as the score, rounds, the end, holds and seats. */
import { describe, expect, it } from 'vitest';
import { freshShoe, handTotal, revealAllowanceMs, roundReserve, shoeDecks, shuffle } from '../../../shared/games/blackjack/cards.js';
import { DEFAULT_BLACKJACK_SETTINGS, blackjackClientMessageSchema, type BlackjackClientMessage, type BlackjackView, type Card, type CardRank } from '../../../shared/games/blackjack/protocol.js';
import type { RoomState } from '../../../shared/platform/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defaultPlatformSettings } from '../../../shared/platform/settings.js';
import type { Effect } from '../../platform/engine/effects.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { viewFor } from '../../platform/engine/view.js';
import { AVATAR, START, chatTexts, errorsOf, sim, startGame, type Sim } from '../../platform/engine/testHarness.js';
import { BLACKJACK_DEAL, MIN_DEAL_GAP_MS, dealAllowanceMs } from '../../../shared/games/blackjack/deal.js';
import { RESUME_SETTLE_MS } from '../waiting.js';
import { blackjackModule, type BlackjackData } from './module.js';

// The fixture: one deck, any bet from 1000 chips, 10 s to bet, 10 s to act, a 4 s final pause; the rounds never run out.
const BET_MS = 10_000;
const ACT_MS = 10_000;
/** The first turn after a deal starts its clock once the deal has landed on the screens. */
const DEAL = (seats: number): number => dealAllowanceMs(seats);
const RESULTS_MS = 4_000;
const NO_ACTIONS = { canHit: false, canStand: false, canDouble: false, canSplit: false };

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

/** Replaces the shoe with exactly these cards, coming out in the given order (first card first). */
function rigExact(s: Sim, ...texts: string[]): void {
  s.data = { ...s.data, game: { ...data(s), shoe: texts.map(card).reverse() } };
}

/** Cards under the rigged ones, so a rigged shoe never triggers the between-rounds reshuffle (a round's reserve for three seats, with room to spare). */
const PAD = 60;

/** Replaces the shoe so the next cards come out in the given order, with twos underneath. */
function rig(s: Sim, ...texts: string[]): void {
  rigExact(s, ...texts, ...Array<string>(PAD).fill('2S'));
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
const tick = (s: Sim, ms: number): Effect[] => {
  s.now += ms;
  return checked(s, s.tick());
};
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
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    expect(s.data.phase).toBe('playing');
    expect(data(s)).toMatchObject({ round: 1, order: [alice, bob], dealer: [], holeHidden: true, reshuffled: false, lastRound: null, endRequested: false });
    // The first round has no reveal to wait for.
    expect(data(s).phase).toEqual({ kind: 'betting', endsAt: START + BET_MS });
    expect(data(s).seats).toEqual({ [alice]: { chips: 1000, bet: 0, hands: [], bustedOut: false }, [bob]: { chips: 1000, bet: 0, hands: [], bustedOut: false } });
    expect([score(s, alice), score(s, bob)]).toEqual([1000, 1000]);
    expect(data(s).shoe).toEqual(shuffle(freshShoe(1), () => 0));
    expect(chatTexts(s.effects)).toContain('Round 1: place your bets!');
    expect(nextDeadline(s.data)).toBe(START + BET_MS);
    expect(view(s, alice)).toEqual({
      phase: 'betting',
      round: 1,
      order: [alice, bob],
      turn: null,
      endsAt: START + BET_MS,
      dealer: { cards: [], holeHidden: true, total: 0, soft: false, blackjack: false },
      players: {
        [alice]: { chips: 1000, bet: 0, hands: [], inRound: true, bustedOut: false },
        [bob]: { chips: 1000, bet: 0, hands: [], inRound: true, bustedOut: false },
      },
      actions: NO_ACTIONS,
      lastRound: null,
      endRequested: false,
      shoeRemaining: 52,
      shoeSize: 52,
      reshuffled: false,
    });
  });

  it('has the table defaults and no rounds, minimum or maximum bet settings at all', () => {
    const { settings } = blackjackModule;
    expect(DEFAULT_BLACKJACK_SETTINGS).toEqual({
      startingChips: 1000,
      decks: 6,
      betSeconds: 15,
      actSeconds: 20,
      resultsSeconds: 5,
      dealerHitsSoft17: false,
      blackjackPayout: '3:2',
      allowDouble: true,
      allowSplit: true,
    });
    expect(settings.normalize).toBeUndefined();
    // The retired keys are dropped from a patch, never stored or validated.
    const patch = settings.patchSchema.safeParse({ rounds: 0, minBet: 10, maxBet: 500, decks: 2 });
    expect(patch.success && patch.data).toEqual({ decks: 2 });
    expect(gameById('blackjack').maxPlayers).toBeNull();
  });

  it('plays a room stored with the old rounds, minimum and maximum bet settings, ignoring them', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice']);
    // A room saved before the settings went: the stored keys ride along and change nothing.
    s.data = { ...s.data, settings: { ...s.data.settings, rounds: 1, minBet: 50, maxBet: 60 } };
    rig(s, '10S', '9D', '8H', '7C');
    act(s, alice, { t: 'bet', amount: 1 });
    tick(s, DEAL(1) + ACT_MS);
    // Round one is over, and round two opens rather than the game ending.
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, lastRound: { round: 1 } });
    act(s, alice, { t: 'bet', amount: 900 });
    expect(view(s, alice).players[alice].hands[0].bet).toBe(900);
    expect(s.data.phase).toBe('playing');
  });

  it('has no insurance anywhere and no host skip: the host may only end the game', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice', 'Bob']);
    expect(JSON.stringify(blackjackModule.settings.defaults)).not.toMatch(/insur/i);
    expect(JSON.stringify(view(s, alice))).not.toMatch(/insur/i);
    expect(blackjackClientMessageSchema.safeParse({ t: 'insurance' }).success).toBe(false);
    expect(blackjackClientMessageSchema.safeParse({ t: 'next' }).success).toBe(false);
    expect([...(blackjackModule.hostMessages ?? [])]).toEqual(['endGame']);
    expect(errorsOf(s.game(alice, { t: 'next' }))).toHaveLength(1);
    expect(view(s).phase).toBe('betting');
  });
});

describe('Blackjack: betting', () => {
  it('takes any whole stake from 1 chip up to the whole stack, lets it be changed, and deals once everyone has bet', () => {
    const s = sim('blackjack');
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
    expect(view(s).shoeRemaining).toBe(PAD);
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 10 }))).toEqual(['You cannot bet right now.']);
  });

  it('has no table maximum: a big stack goes all in', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice', 'Bob'], { startingChips: 100_000 });
    act(s, alice, { t: 'bet', amount: 100_000 });
    expect([chips(s, alice), view(s).players[alice].bet]).toEqual([0, 100_000]);
    expect(view(s).phase).toBe('betting');
  });

  it('sits out whoever has not bet at the deadline, connected or not: no cards, chips untouched, dealt in again from the next round', () => {
    const s = sim('blackjack');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rig(s, '10S', '9D', '6H', '7S');
    act(s, alice, { t: 'bet', amount: 100 });
    disconnect(s, carol, 'Carol');
    expect(view(s).phase).toBe('betting');
    const effects = tick(s, BET_MS);
    expect(chatTexts(effects)).toEqual(['Bob, Carol sit this hand out.']);
    expect(view(s)).toMatchObject({ phase: 'acting', order: [alice], turn: { playerId: alice, handIndex: 0 } });
    expect(view(s).players[bob]).toEqual({ chips: 1000, bet: 0, hands: [], inRound: false, bustedOut: false });
    expect(view(s).players[carol]).toEqual({ chips: 1000, bet: 0, hands: [], inRound: false, bustedOut: false });
    expect(errorsOf(act(s, bob, { t: 'bet', amount: 10 }))).toEqual(['You cannot bet right now.']);
    expect(nextDeadline(s.data)).toBe(s.now + DEAL(1) + ACT_MS);
    const settled = act(s, alice, { t: 'stand' });
    expect(chatTexts(settled)).toEqual(['The dealer stands on 18.', 'Alice loses 100.', 'Round 2: place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, bob, carol] });
    act(s, bob, { t: 'bet', amount: 10 });
    expect(view(s).players[bob]).toMatchObject({ chips: 990, bet: 10, inRound: true });
  });

  it('deals nobody in when nobody bet: the table waits, unclocked, for the first bet, seats newcomers straight into it, and that bet starts the clock again', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    const effects = tick(s, BET_MS);
    expect(chatTexts(effects)).toEqual(['Nobody bet. The dealer waits for the first bet.']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 1, endsAt: null, order: [alice, bob], dealer: { cards: [] } });
    expect(data(s).phase).toEqual({ kind: 'betting', endsAt: null });
    expect(nextDeadline(s.data)).toBeNull();
    expect(tick(s, 60_000)).toEqual([]);
    expect([chips(s, alice), chips(s, bob)]).toEqual([1000, 1000]);

    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expectScoresMatchChips(s);
    expect(view(s).order).toEqual([alice, bob, carol]);
    expect([chips(s, carol), score(s, carol)]).toEqual([1000, 1000]);

    rig(s, '10S', '9D', '6H', '7S');
    act(s, bob, { t: 'bet', amount: 5 });
    expect(view(s)).toMatchObject({ phase: 'betting', endsAt: s.now + BET_MS });
    const dealt = tick(s, BET_MS);
    expect(chatTexts(dealt)).toEqual(['Alice, Carol sit this hand out.']);
    expect(view(s)).toMatchObject({ phase: 'acting', round: 1, order: [bob], turn: { playerId: bob, handIndex: 0 } });
    expect(view(s).players[alice]).toMatchObject({ chips: 1000, bet: 0, hands: [], inRound: false });
    expect(handsOf(s, bob)[0].cards).toEqual(cards('10S', '6H'));
  });

  it('holds a waiting table once nobody connected is left to bet, and opens the same round again when someone is back', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    tick(s, BET_MS);
    disconnect(s, alice, 'Alice');
    expect(view(s)).toMatchObject({ phase: 'betting', endsAt: null });
    const held = disconnect(s, bob, 'Bob');
    expect(chatTexts(held)).toContain('Waiting for Alice, Bob to reconnect…');
    expect(view(s).phase).toBe('held');
    expect(waiting(s)).toEqual([alice, bob]);
    reconnect(s, bob, 'Bob');
    const resumed = tick(s, RESUME_SETTLE_MS);
    expect(chatTexts(resumed)).toEqual(['Round 1: place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 1, order: [alice, bob], endsAt: s.now + BET_MS });
  });

  it('holds a sole player who dropped before anything was dealt: nothing is bet for them, and the round opens again once they are back', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice']);
    disconnect(s, alice, 'Alice');
    const held = tick(s, BET_MS);
    expect(chatTexts(held)).toEqual(['Waiting for Alice to reconnect…']);
    expect(view(s)).toMatchObject({ phase: 'held', endsAt: null, dealer: { cards: [] } });
    expect(chips(s, alice)).toBe(1000);
    expect(waiting(s)).toEqual([alice]);
    reconnect(s, alice, 'Alice');
    const resumed = tick(s, RESUME_SETTLE_MS);
    expect(chatTexts(resumed)).toEqual(['Round 1: place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 1, order: [alice], endsAt: s.now + BET_MS });
    expect(waiting(s)).toBeNull();
    expect(s.data.phase).toBe('playing');
  });

  it('does not spend a round when every seat left while the bets were open: the same round opens again for whoever is left', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice']);
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    s.apply({ type: 'leave', playerId: alice });
    expectScoresMatchChips(s);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 1, order: [] });
    const effects = tick(s, BET_MS);
    expect(chatTexts(effects)).toEqual(['Round 1: place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 1, order: [carol] });
    expect([chips(s, carol), score(s, carol)]).toEqual([1000, 1000]);
    expect(s.data.phase).toBe('playing');
  });
});

describe('Blackjack: the deal and the moves', () => {
  it('deals in table order, calls out naturals and skips them, then settles straight into the next betting with the table kept in lastRound', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '9H', '5D', 'KH', '7C', '10S', '2S');
    act(s, alice, { t: 'bet', amount: 10 });
    const effects = act(s, bob, { t: 'bet', amount: 10 });
    expect(chatTexts(effects)).toEqual(['Alice has blackjack!']);
    expect(handsOf(s, alice)).toEqual([{ cards: cards('AS', 'KH'), total: 21, soft: true, bet: 10, status: 'blackjack', doubled: false, fromSplit: false, splitAces: false }]);
    expect(handsOf(s, bob)).toEqual([{ cards: cards('9H', '7C'), total: 16, soft: false, bet: 10, status: 'acting', doubled: false, fromSplit: false, splitAces: false }]);
    expect(view(s)).toMatchObject({ phase: 'acting', turn: { playerId: bob, handIndex: 0 }, endsAt: s.now + DEAL(2) + ACT_MS, shoeRemaining: PAD + 1 });
    expect(view(s).dealer).toEqual({ cards: cards('5D'), holeHidden: true, total: 5, soft: false, blackjack: false });
    expect(data(s).dealer).toEqual(cards('5D', '10S'));
    expect(view(s, alice).actions).toEqual(NO_ACTIONS);
    expect(view(s, bob).actions).toEqual({ canHit: true, canStand: true, canDouble: true, canSplit: false });
    expect(view(s, null).actions).toEqual(NO_ACTIONS);
    expect(errorsOf(act(s, alice, { t: 'hit' }))).toEqual(['It is not your turn.']);

    // Bob stands on 16; the dealer turns 15 and draws a 2: the natural pays 3:2, the 16 loses.
    const stood = act(s, bob, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 17.', 'Alice wins 15, Bob loses 10.', 'Round 2: place your bets!']);
    const reveal = revealAllowanceMs(3);
    expect(reveal).toBe(1700);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, turn: null, order: [alice, bob], endsAt: s.now + reveal + BET_MS });
    // The seats and the dealer are cleared; the settled table lives in lastRound.
    expect(view(s).dealer).toEqual({ cards: [], holeHidden: true, total: 0, soft: false, blackjack: false });
    expect(view(s).players[alice]).toEqual({ chips: 1015, bet: 0, hands: [], inRound: true, bustedOut: false });
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
    expect(nextDeadline(s.data)).toBe(s.now + reveal + BET_MS);
  });

  it('hits for a card with a fresh clock, stands a 21 by itself and busts over it', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '5D', '9H', '5C', '2C');
    betAll(s, [alice, bob]);
    s.now += 3000;
    const hit = act(s, alice, { t: 'hit' });
    expect(chatTexts(hit)).toEqual([]);
    // 10 + 6 + 5 = 21: nothing left to do, the play passes to Bob with a fresh clock.
    expect(handsOf(s, alice)[0]).toMatchObject({ total: 21, status: 'stood' });
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
    expect(view(s).endsAt).toBe(s.now + ACT_MS);
    s.now += 2000;
    act(s, bob, { t: 'hit' });
    expect(handsOf(s, bob)[0]).toMatchObject({ total: 20, status: 'acting', cards: cards('5H', '6C', '9H') });
    expect(view(s).endsAt).toBe(s.now + ACT_MS);
    expect(view(s, bob).actions).toEqual({ canHit: true, canStand: true, canDouble: false, canSplit: false });
    const bust = act(s, bob, { t: 'hit' });
    // The dealer draws 9 + 7 + 2 = 18: Alice's 21 wins even money.
    expect(chatTexts(bust)).toEqual(['Bob busts with 25.', 'The dealer stands on 18.', 'Alice wins 10, Bob loses 10.', 'Round 2: place your bets!']);
    expect(lastHands(s, bob)[0]).toMatchObject({ total: 25, status: 'bust', outcome: 'loss' });
    expect(results(s)).toEqual([
      { playerId: alice, handIndex: 0, outcome: 'win', bet: 10, payout: 20 },
      { playerId: bob, handIndex: 0, outcome: 'loss', bet: 10, payout: 0 },
    ]);
    expect([chips(s, alice), chips(s, bob)]).toEqual([1010, 990]);
  });

  it('doubles on two cards for exactly one more card, when the table allows it and the chips are there', () => {
    const s = sim('blackjack');
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

  it('refuses a double the table forbids or the chips cannot cover, and a doubled hand can bust', () => {
    const off = sim('blackjack');
    const [alice] = startGame(off, ['Alice'], { allowDouble: false });
    rig(off, '5S', '6D', '6H', '10S', 'KS');
    betAll(off, [alice]);
    expect(view(off, alice).actions.canDouble).toBe(false);
    expect(errorsOf(act(off, alice, { t: 'double' }))).toEqual(['You cannot double this hand.']);

    const broke = sim('blackjack');
    const [bob] = startGame(broke, ['Bob'], { startingChips: 100 });
    rig(broke, '7S', '6D', '6H', '10S', 'KS', '5C');
    act(broke, bob, { t: 'bet', amount: 100 });
    expect(view(broke, bob).actions.canDouble).toBe(false);
    expect(errorsOf(act(broke, bob, { t: 'double' }))).toEqual(['You cannot double this hand.']);

    const bust = sim('blackjack');
    const [carol] = startGame(bust, ['Carol']);
    rig(bust, '7S', '6D', '6H', '10S', 'KS');
    betAll(bust, [carol]);
    const effects = act(bust, carol, { t: 'double' });
    expect(lastHands(bust, carol)[0]).toMatchObject({ total: 23, bet: 20, status: 'bust', doubled: true, outcome: 'loss' });
    expect(chatTexts(effects)).toEqual(['Carol busts with 23.', 'The dealer shows 16.', 'Carol loses 20.', 'Round 2: place your bets!']);
    expect(chips(bust, carol)).toBe(980);
  });

  it('stands a hand whose clock runs out', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    const effects = tick(s, DEAL(2) + ACT_MS);
    expect(chatTexts(effects)).toEqual(['Alice ran out of time and stands.']);
    expect(handsOf(s, alice)[0].status).toBe('stood');
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
    expect(nextDeadline(s.data)).toBe(s.now + ACT_MS);
  });
});

describe('Blackjack: one hand at a time', () => {
  it('plays the seats in join order, each seat its hands left to right with split hands, one clock reset after every action, the dealer last', () => {
    const s = sim('blackjack');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rig(s, '8S', '10H', '9C', '6D', '8H', '7C', '9D', '10S', '3H', '2C', '4D', '9S', 'KD');
    betAll(s, [alice, bob, carol]);
    const ids = [alice, bob, carol];
    /** Only the seat in play has anything lit; everyone else, spectators included, sees nothing to do. */
    const expectTurn = (playerId: string, handIndex: number, allowance = 0) => {
      expect(view(s)).toMatchObject({ phase: 'acting', turn: { playerId, handIndex }, endsAt: s.now + allowance + ACT_MS });
      for (const id of ids) if (id !== playerId) expect(view(s, id).actions, id).toEqual(NO_ACTIONS);
      expect(view(s, null).actions).toEqual(NO_ACTIONS);
      expect(view(s, playerId).actions.canStand).toBe(true);
    };

    expectTurn(alice, 0, DEAL(3));
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
    expect(chatTexts(last)).toEqual(['The dealer busts with 26.', 'Alice wins 30, Bob wins 10, Carol wins 10.', 'Round 2: place your bets!']);
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
  it('re-splits pairs (ten-value cards mixed) up to four hands, each with its own stake, and plays them left to right', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice']);
    rig(s, '10S', '6D', 'KH', '10H', 'QD', '5C', 'JC', '3H', 'KD', '4S', '7D', '9S', '2D');
    betAll(s, [alice]);
    expect(view(s, alice).actions.canSplit).toBe(true);
    expect(chatTexts(act(s, alice, { t: 'split' }))).toEqual(['Alice splits a pair.']);
    expect(handsOf(s, alice).map((h) => h.cards)).toEqual([cards('10S', 'QD'), cards('KH', '5C')]);
    expect(view(s, alice).actions.canSplit).toBe(true);
    act(s, alice, { t: 'split' });
    expect(handsOf(s, alice).map((h) => h.cards)).toEqual([cards('10S', 'JC'), cards('QD', '3H'), cards('KH', '5C')]);
    act(s, alice, { t: 'split' });
    expect(handsOf(s, alice).map((h) => h.cards)).toEqual([cards('10S', 'KD'), cards('JC', '4S'), cards('QD', '3H'), cards('KH', '5C')]);
    expect(handsOf(s, alice).every((h) => h.fromSplit && h.bet === 10 && !h.splitAces)).toBe(true);
    expect(chips(s, alice)).toBe(960);
    // A fifth hand is one too many, even from a pair.
    expect(view(s, alice).actions).toEqual({ canHit: true, canStand: true, canDouble: true, canSplit: false });
    expect(errorsOf(act(s, alice, { t: 'split' }))).toEqual(['You cannot split this hand.']);
    act(s, alice, { t: 'stand' });
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 1 });
    act(s, alice, { t: 'double' }); // 14 + 7 = 21 for twice the stake
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 2 });
    act(s, alice, { t: 'hit' }); // 13 + 9 busts
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 3 });
    const last = act(s, alice, { t: 'stand' });
    // Dealer 6 + 10 + 2 = 18.
    expect(chatTexts(last)).toEqual(['The dealer stands on 18.', 'Alice wins 10.', 'Round 2: place your bets!']);
    expect(lastHands(s, alice).map((h) => [h.total, h.bet, h.status, h.payout])).toEqual([
      [20, 10, 'won', 20],
      [21, 20, 'won', 40],
      [22, 10, 'bust', 0],
      [15, 10, 'lost', 0],
    ]);
    expect(chips(s, alice)).toBe(1010);
  });

  it('splits a pair dealt onto a later split hand when its turn comes', () => {
    const s = sim('blackjack');
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

  it('gives split aces one card each, lets a second ace be split again up to four hands, and pays 21 on a split hand 1:1', () => {
    const s = sim('blackjack', 'ABCD');
    const [alice] = startGame(s, ['Alice'], { decks: 2 });
    rig(s, 'AS', '7S', 'AH', '10D', 'AD', 'AC', 'AS', 'AH', 'KC', '9H');
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
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 0 });
    const last = act(s, alice, { t: 'split' });
    // Four hands: the two pairs of aces left cannot be split again and stand with the rest; the dealer plays at once.
    expect(chatTexts(last)).toEqual(['Alice splits aces.', 'The dealer stands on 17.', 'Alice pushes.', 'Round 2: place your bets!']);
    expect(lastHands(s, alice).map((h) => [h.cards, h.total, h.outcome, h.payout])).toEqual([
      [cards('AS', 'KC'), 21, 'win', 20],
      [cards('AS', '9H'), 20, 'win', 20],
      [cards('AD', 'AH'), 12, 'loss', 0],
      [cards('AH', 'AC'), 12, 'loss', 0],
    ]);
    expect(chips(s, alice)).toBe(1000);
  });

  it('stands split aces that cannot be split again for want of chips, and refuses a split the table forbids or the chips cannot cover', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice'], { startingChips: 100 });
    rig(s, 'AS', '7S', 'AH', '10D', 'AD', '6C');
    act(s, alice, { t: 'bet', amount: 40 });
    const split = act(s, alice, { t: 'split' });
    expect(chatTexts(split)).toEqual(['Alice splits aces.', 'The dealer stands on 17.', 'Alice loses 40.', 'Round 2: place your bets!']);
    expect(lastHands(s, alice).map((h) => [h.cards, h.outcome])).toEqual([
      [cards('AS', 'AD'), 'loss'],
      [cards('AH', '6C'), 'push'],
    ]);
    expect(chips(s, alice)).toBe(60);

    const off = sim('blackjack');
    const [carol] = startGame(off, ['Carol'], { allowSplit: false });
    rig(off, '8S', '6D', '8H', '10S', '2C');
    betAll(off, [carol]);
    expect(view(off, carol).actions.canSplit).toBe(false);
    expect(errorsOf(act(off, carol, { t: 'split' }))).toEqual(['You cannot split this hand.']);

    const broke = sim('blackjack');
    const [dave] = startGame(broke, ['Dave'], { startingChips: 100 });
    rig(broke, '8S', '6D', '8H', '10S', '2C');
    act(broke, dave, { t: 'bet', amount: 100 });
    expect(view(broke, dave).actions.canSplit).toBe(false);
    expect(errorsOf(act(broke, dave, { t: 'split' }))).toEqual(['You cannot split this hand.']);
  });
});

describe('Blackjack: the dealer', () => {
  it('peeks with an ace up: a dealer blackjack shows at once and settles the round, naturals push and nobody plays', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '10H', 'AD', 'KH', '9C', 'KS');
    act(s, alice, { t: 'bet', amount: 10 });
    const effects = act(s, bob, { t: 'bet', amount: 10 });
    expect(chatTexts(effects)).toEqual(['Alice has blackjack!', 'The dealer has blackjack.', 'Alice pushes, Bob loses 10.', 'Round 2: place your bets!']);
    expect(effects.some((e) => e.type === 'send' && e.msg.t === 'room' && (e.msg as { room: RoomState<BlackjackView> }).room.game?.phase === 'acting')).toBe(false);
    // Only the hole card turns over: the reveal allowance is the flip alone.
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, endsAt: s.now + 1200 + BET_MS });
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
    const ten = sim('blackjack');
    const [alice] = startGame(ten, ['Alice']);
    rig(ten, '9S', 'KD', '7H', 'AH');
    const peeked = act(ten, alice, { t: 'bet', amount: 10 });
    expect(chatTexts(peeked)).toEqual(['The dealer has blackjack.', 'Alice loses 10.', 'Round 2: place your bets!']);
    expect(ten.data.game && view(ten).lastRound?.peeked).toBe(true);

    const none = sim('blackjack');
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
    expect(chatTexts(stood)).toEqual(['The dealer stands on 20.', 'Bob loses 10.', 'Round 2: place your bets!']);
    expect(view(none).lastRound?.peeked).toBe(false);
  });

  it('never peeks under a low up card: a natural there is settled when the dealer plays', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice'], { blackjackPayout: '6:5' });
    rig(s, 'AS', '9D', 'KH', '8S');
    betAll(s, [alice]);
    expect(chatTexts(s.effects).slice(-4)).toEqual(['Alice has blackjack!', 'The dealer shows 17.', 'Alice wins 12.', 'Round 2: place your bets!']);
    expect(results(s)).toEqual([{ playerId: alice, handIndex: 0, outcome: 'blackjack', bet: 10, payout: 22 }]);
    expect(chips(s, alice)).toBe(1012);
  });

  it('stands on a soft 17 unless the table says to hit it', () => {
    const stands = sim('blackjack');
    const [alice] = startGame(stands, ['Alice']);
    rig(stands, '10S', 'AD', '8H', '6S', '4C');
    betAll(stands, [alice]);
    const stood = act(stands, alice, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 17.', 'Alice wins 10.', 'Round 2: place your bets!']);
    expect(view(stands).lastRound?.dealer).toEqual({ cards: cards('AD', '6S'), holeHidden: false, total: 17, soft: true, blackjack: false });
    expect(chips(stands, alice)).toBe(1010);

    const hits = sim('blackjack');
    const [bob] = startGame(hits, ['Bob'], { dealerHitsSoft17: true });
    rig(hits, '10S', 'AD', '8H', '6S', '4C');
    betAll(hits, [bob]);
    const effects = act(hits, bob, { t: 'stand' });
    expect(chatTexts(effects)).toEqual(['The dealer stands on 21.', 'Bob loses 10.', 'Round 2: place your bets!']);
    expect(view(hits).lastRound?.dealer).toMatchObject({ cards: cards('AD', '6S', '4C'), total: 21, soft: true });
    expect(chips(hits, bob)).toBe(990);
  });

  it('shows the hole card without drawing when no hand is left standing', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice']);
    rig(s, '10S', '6D', '6H', '10S', 'KD', '5C');
    betAll(s, [alice]);
    const effects = act(s, alice, { t: 'hit' });
    expect(chatTexts(effects)).toEqual(['Alice busts with 26.', 'The dealer shows 16.', 'Alice loses 10.', 'Round 2: place your bets!']);
    expect(view(s).lastRound?.dealer).toEqual({ cards: cards('6D', '10S'), holeHidden: false, total: 16, soft: false, blackjack: false });
    expect(view(s).shoeRemaining).toBe(PAD + 1);
  });
});

describe('Blackjack: rounds', () => {
  it('goes straight from a settle into the next betting, with the reveal allowance on the clock and the last table on show until the deal', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    act(s, alice, { t: 'stand' });
    const settled = act(s, bob, { t: 'stand' });
    expect(chatTexts(settled)).toEqual(['The dealer stands on 18.', 'Alice loses 10, Bob loses 10.', 'Round 2: place your bets!']);
    // One card drawn after the hole card: 1200 + 500 ms on top of the betting time.
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, bob], endsAt: s.now + 1700 + BET_MS });
    expect(nextDeadline(s.data)).toBe(s.now + 1700 + BET_MS);
    expect(view(s).dealer).toEqual({ cards: [], holeHidden: true, total: 0, soft: false, blackjack: false });
    expect(view(s).players[alice]).toMatchObject({ bet: 0, hands: [], inRound: true });
    expect(view(s).lastRound).toMatchObject({ round: 1, order: [alice, bob], dealer: { cards: cards('9D', '7S', '2C') }, revealEndsAt: s.now + 1700 });
    // A bet does not clear it; the deal does.
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    act(s, alice, { t: 'bet', amount: 10 });
    expect(view(s).lastRound?.round).toBe(1);
    act(s, bob, { t: 'bet', amount: 10 });
    expect(view(s)).toMatchObject({ phase: 'acting', round: 2, lastRound: null });
    tick(s, DEAL(2) + ACT_MS);
    const timedOut = tick(s, ACT_MS);
    expect(chatTexts(timedOut).slice(-1)).toEqual(['Round 3: place your bets!']);
    expect(view(s).round).toBe(3);
  });

  it('never runs out of rounds: a table plays on round after round while two stacks are left', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    for (let round = 1; round <= 60; round++) {
      expect(view(s)).toMatchObject({ phase: 'betting', round });
      betAll(s, [alice, bob], 1);
      for (let guard = 0; view(s).phase === 'acting' && guard < 20; guard++) {
        const turn = view(s).turn;
        if (turn) act(s, turn.playerId, { t: 'stand' });
      }
    }
    expect(s.data.phase).toBe('playing');
    expect(view(s).round).toBe(61);
  });

  it('puts a player with no chips left out of the game to watch, and a stack that is out counts for nothing in a hold', () => {
    const s = sim('blackjack');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { startingChips: 100 });
    rig(s, '10S', '10H', '10C', '10D', '6H', '9C', '9S', '7S');
    act(s, alice, { t: 'bet', amount: 100 });
    betAll(s, [bob, carol], 50);
    act(s, alice, { t: 'stand' });
    act(s, bob, { t: 'stand' });
    const stood = act(s, carol, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 17.', 'Alice loses 100, Bob wins 50, Carol wins 50.', 'Alice is out of chips.', 'Round 2: place your bets!']);
    expect(view(s).players[alice]).toEqual({ chips: 0, bet: 0, hands: [], inRound: false, bustedOut: true });
    expect([score(s, alice), score(s, bob), score(s, carol)]).toEqual([0, 150, 150]);
    expect(view(s)).toMatchObject({ round: 2, order: [bob, carol] });
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 50 }))).toEqual(['You cannot bet right now.']);
    expect(view(s, alice).actions).toEqual(NO_ACTIONS);

    // Alice keeps her socket but counts for nothing: with Bob and Carol away at the settle the next round holds.
    betAll(s, [bob, carol], 50);
    disconnect(s, bob, 'Bob');
    disconnect(s, carol, 'Carol');
    tick(s, DEAL(2) + ACT_MS);
    const held = tick(s, ACT_MS);
    expect(chatTexts(held)).toEqual(['Carol ran out of time and stands.', 'The dealer stands on 18.', 'Bob loses 50, Carol loses 50.', 'Waiting for Bob, Carol to reconnect…']);
    expect(waiting(s)).toEqual([bob, carol]);
    expect(view(s)).toMatchObject({ phase: 'held', endsAt: null, lastRound: { round: 2 } });
    expect(data(s).phase).toEqual({ kind: 'held', resumeAt: null });
    reconnect(s, bob, 'Bob');
    tick(s, RESUME_SETTLE_MS);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 3, order: [bob, carol] });
  });

  it('ends once everyone is out of chips', () => {
    const s = sim('blackjack');
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

  it('reshuffles the shoe straight after a settle once it runs low, and at once when it runs out mid-hand', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice']);
    rigExact(s, '10S', '6D', '8H', '10S', '3C', '4C', '5C', '6C', '7C', '8C', '9C', '2C');
    betAll(s, [alice]);
    const stood = act(s, alice, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 19.', 'Alice loses 10.', 'The shoe is running low. The shoe is reshuffled.', 'Round 2: place your bets!']);
    expect(view(s)).toMatchObject({ reshuffled: true, shoeRemaining: 52, shoeSize: 52, lastRound: { round: 1 } });

    const empties = sim('blackjack');
    const [bob] = startGame(empties, ['Bob']);
    rigExact(empties, 'AS', 'KD', '5S', '7H');
    betAll(empties, [bob]);
    expect(view(empties).shoeRemaining).toBe(0);
    const hit = act(empties, bob, { t: 'hit' });
    expect(chatTexts(hit)[0]).toBe('The shoe ran out. The shoe is reshuffled.');
    expect(handsOf(empties, bob)[0].cards).toHaveLength(3);
    expect(view(empties)).toMatchObject({ reshuffled: true, shoeRemaining: 52 - 5 });
    // The rebuilt shoe leaves out the cards on the table: the deck is whole and nothing is dealt twice.
    const table = [...data(empties).dealer, ...Object.values(data(empties).seats).flatMap((seat) => seat.hands.flatMap((h) => h.cards))];
    expect(table).toHaveLength(5);
    const whole = [...data(empties).shoe, ...table].map((c) => c.rank + c.suit);
    expect(whole).toHaveLength(52);
    expect(new Set(whole).size).toBe(52);
  });

  it('keeps a fifty-seat table in cards round after round: the shoe grows with the table and never runs dry mid-round', () => {
    // Driven through the module itself: fifty seats through the whole engine would project fifty views per move.
    const players = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `P${i + 1}`, joinOrder: i, connected: true, score: 0 }));
    let seed = 7;
    const rng = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const settings = { ...defaultPlatformSettings(gameById('blackjack')), ...blackjackModule.settings.defaults, decks: 1 };
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
    expect(game.shoeSize).toBe(shoeDecks(1, 50) * 52);
    for (let round = 1; round <= 20; round++) {
      expect(game.phase.kind).toBe('betting');
      // Every deal starts with a whole round's reserve in the shoe.
      expect(game.shoe.length).toBeGreaterThanOrEqual(roundReserve(50));
      for (const p of players) send(p.id, { t: 'bet', amount: 1 });
      // Every seat plays it out the long way: split whatever it can, hit to 17.
      for (let guard = 0; guard < 2000 && game.phase.kind === 'acting'; guard++) {
        const { playerId, handIndex } = game.phase;
        const hand = game.seats[playerId].hands[handIndex];
        const actions = blackjackModule.view(game, playerId, ctx).actions;
        send(playerId, actions.canSplit ? { t: 'split' } : actions.canHit && handTotal(hand.cards).total < 17 ? { t: 'hit' } : { t: 'stand' });
      }
    }
    expect(game.round).toBe(21);
    expect(lines.filter((line) => line.startsWith('The shoe ran out'))).toEqual([]);
    expect(lines.filter((line) => line.startsWith('The shoe is running low')).length).toBeGreaterThan(0);
    expect(lines.filter((line) => line.includes('splits')).length).toBeGreaterThan(0);
    expect(Object.values(game.seats).every((seat) => seat.chips > 0 && !seat.bustedOut)).toBe(true);
  }, 30_000);

  it('gives the first turn after a fifty-seat deal its whole clock once the cards have landed', () => {
    const players = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `P${i + 1}`, joinOrder: i, connected: true, score: 0 }));
    const settings = { ...defaultPlatformSettings(gameById('blackjack')), ...blackjackModule.settings.defaults, actSeconds: 10 };
    const ctx = { now: START, rng: () => 0.5, newId: () => 'x', settings, players, spectators: [], hostId: 'p0' };
    let game = blackjackModule.start(ctx).data;
    for (const p of players) game = blackjackModule.handle(ctx, game, { type: 'message', playerId: p.id, msg: { t: 'bet', amount: 1 } }).data;
    expect(game.phase.kind).toBe('acting');
    // The deal takes this long to show on a phone (the discards, then 102 cards one after another).
    const landed = START + dealAllowanceMs(50);
    expect(dealAllowanceMs(50)).toBeGreaterThan(BLACKJACK_DEAL.discard + 101 * MIN_DEAL_GAP_MS);
    expect(game.phase.kind === 'acting' && game.phase.endsAt).toBe(landed + 10_000);
    // The whole deal stays under the client's animation backlog, so a snapshot mid-deal never snaps it.
    expect(dealAllowanceMs(50)).toBeLessThan(3000);
  });
});

describe('Blackjack: the end', () => {
  it('plays on until one player is left with chips: the last one standing', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { startingChips: 100 });
    expect(chatTexts(s.effects)).toContain('Round 1: place your bets!');
    rig(s, '10S', '10H', '9D', '6H', '6C', '8S');
    betAll(s, [alice, bob], 50);
    act(s, alice, { t: 'stand' });
    const first = act(s, bob, { t: 'stand' });
    expect(chatTexts(first)).toEqual(['The dealer stands on 17.', 'Alice loses 50, Bob loses 50.', 'Round 2: place your bets!']);

    rig(s, '10S', '10H', '9D', '6H', 'KC', '8S');
    betAll(s, [alice, bob], 50);
    act(s, alice, { t: 'stand' });
    const second = act(s, bob, { t: 'stand' });
    expect(chatTexts(second)).toEqual(['The dealer stands on 17.', 'Alice loses 50, Bob wins 50.', 'Alice is out of chips.', 'Bob is the last one standing.']);
    expect(view(s)).toMatchObject({ phase: 'ending', endsAt: s.now + 1200 + RESULTS_MS });
    tick(s, 1200 + RESULTS_MS);
    expect(s.data.phase).toBe('ended');
    expect(s.data.podium).toEqual([
      { playerId: bob, score: 100, rank: 1 },
      { playerId: alice, score: 0, rank: 2 },
    ]);
  });

  it('plays a lone player (or one left alone by a leave) on until their chips are gone', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice'], { startingChips: 100 });
    rig(s, '10S', '9D', 'KH', '8S');
    const won = act(s, alice, { t: 'bet', amount: 50 });
    act(s, alice, { t: 'stand' });
    expect(chatTexts(won)).toEqual([]);
    expect(chatTexts(s.effects).slice(-2)).toEqual(['Alice wins 50.', 'Round 2: place your bets!']);
    rig(s, '10S', '9D', '6H', '8S');
    act(s, alice, { t: 'bet', amount: 100 });
    expect(chatTexts(act(s, alice, { t: 'stand' }))).toEqual(['The dealer stands on 17.', 'Alice loses 100.', 'Round 3: place your bets!']);
    rig(s, '10S', '9D', '6H', '8S');
    act(s, alice, { t: 'bet', amount: 50 });
    expect(chatTexts(act(s, alice, { t: 'stand' }))).toEqual(['The dealer stands on 17.', 'Alice loses 50.', 'Alice is out of chips.', 'Everyone is out of chips. The house wins.']);
    expect(view(s).phase).toBe('ending');

    const left = sim('blackjack');
    const [carol, dave] = startGame(left, ['Carol', 'Dave']);
    left.apply({ type: 'leave', playerId: dave });
    rig(left, '10S', '9D', 'KH', '8S');
    act(left, carol, { t: 'bet', amount: 10 });
    expect(chatTexts(act(left, carol, { t: 'stand' })).slice(-1)).toEqual(['Round 2: place your bets!']);
    expect(view(left)).toMatchObject({ phase: 'betting', round: 2, order: [carol] });
  });

  it('never names a newcomer without a seat the last one standing: they are dealt in, and only a seated stack can win', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice'], { startingChips: 100 });
    s.apply({ type: 'join', name: 'Bob', avatar: AVATAR, connectionId: 'b' });
    const bob = s.playerId('Bob');
    rig(s, '10S', '9D', '6H', '8S');
    act(s, alice, { t: 'bet', amount: 100 });
    const settled = act(s, alice, { t: 'stand' });
    expect(chatTexts(settled)).toEqual(['The dealer stands on 17.', 'Alice loses 100.', 'Alice is out of chips.', 'Round 2: place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [bob] });
    expect([chips(s, bob), score(s, bob)]).toEqual([100, 100]);

    rig(s, '10S', '9D', 'KH', '8S');
    act(s, bob, { t: 'bet', amount: 60 });
    expect(chatTexts(act(s, bob, { t: 'stand' }))).toEqual(['The dealer stands on 17.', 'Bob wins 60.', 'Bob is the last one standing.']);
    tick(s, 1200 + RESULTS_MS);
    expect(s.data.phase).toBe('ended');
    expect(s.data.podium?.[0]).toEqual({ playerId: bob, score: 160, rank: 1 });
  });
});

describe('Blackjack: the host ends the game', () => {
  it('ends at once during the betting, every stake back, straight to the podium; only the host may', () => {
    const s = sim('blackjack');
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

  it('ends at once while the table waits for a first bet', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice', 'Bob']);
    tick(s, BET_MS);
    expect(view(s)).toMatchObject({ phase: 'betting', endsAt: null });
    expect(chatTexts(act(s, alice, { t: 'endGame' }))).toEqual(['The host ended the game.', 'Game over! Alice and Bob tie with 1000 points.']);
    expect(s.data.phase).toBe('ended');
  });

  it('ends after the hand in play settles, through the final pause instead of the next betting, then the podium ranked by chips', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '9H', '5D', 'KH', '7C', '10S', '2S');
    betAll(s, [alice, bob]);
    const asked = act(s, alice, { t: 'endGame' });
    expect(chatTexts(asked)).toEqual(['The host ends the game after this hand.']);
    expect(view(s)).toMatchObject({ phase: 'acting', endRequested: true, turn: { playerId: bob, handIndex: 0 } });
    expect(errorsOf(act(s, alice, { t: 'endGame' }))).toEqual(['The game ends after this hand.']);
    const settled = act(s, bob, { t: 'stand' });
    expect(chatTexts(settled)).toEqual(['The dealer stands on 17.', 'Alice wins 15, Bob loses 10.']);
    expect(view(s)).toMatchObject({ phase: 'ending', endsAt: s.now + 1700 + RESULTS_MS, lastRound: { round: 1 } });
    expect(s.data.phase).toBe('playing');
    expect(errorsOf(act(s, alice, { t: 'endGame' }))).toEqual(['The game is ending already.']);
    expect(tick(s, 1700 + RESULTS_MS - 1)).toEqual([]);
    const effects = tick(s, 1);
    expect(s.data.phase).toBe('ended');
    expect(data(s).phase).toEqual({ kind: 'gameOver' });
    expect(view(s)).toMatchObject({ phase: 'gameOver', endsAt: null, turn: null, lastRound: { round: 1 } });
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 1015, rank: 1 },
      { playerId: bob, score: 990, rank: 2 },
    ]);
    expect(chatTexts(effects)).toEqual(['Game over! Alice wins with 1015 points.']);
    expect(nextDeadline(s.data)).toBeNull();
    expect(errorsOf(s.game(alice, { t: 'endGame' }))).toEqual(['The game is not running.']);
  });

  it('ends at once while the table is held, clearing the hold', () => {
    const s = sim('blackjack');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { startingChips: 100 });
    rig(s, '10S', '10H', '10C', '10D', '6H', '9C', '9S', '7S');
    act(s, alice, { t: 'bet', amount: 100 });
    betAll(s, [bob, carol], 50);
    act(s, alice, { t: 'stand' });
    // Alice is out of chips but still the host and connected; Bob and Carol, the stacks left, are away when their hands time out.
    disconnect(s, bob, 'Bob');
    disconnect(s, carol, 'Carol');
    tick(s, ACT_MS);
    tick(s, ACT_MS);
    expect(view(s).phase).toBe('held');
    expect(waiting(s)).toEqual([bob, carol]);
    const effects = act(s, alice, { t: 'endGame' });
    expect(chatTexts(effects)).toEqual(['The host ended the game.', 'Game over! Bob and Carol tie with 150 points.']);
    expect(waiting(s)).toBeNull();
    expect(s.data.phase).toBe('ended');
  });
});

describe('Blackjack: seats coming and going', () => {
  it('seats a late joiner with the starting stack only when the next round starts', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice']);
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expectScoresMatchChips(s);
    expect(score(s, carol)).toBe(0);
    expect(data(s).seats[carol]).toBeUndefined();
    expect(view(s).players[carol]).toEqual({ chips: 0, bet: 0, hands: [], inRound: false, bustedOut: false });
    expect(view(s).order).toEqual([alice]);
    expect(errorsOf(act(s, carol, { t: 'bet', amount: 10 }))).toEqual(['You cannot bet right now.']);
    rig(s, '10S', '6D', '8H', '10S', '3C');
    betAll(s, [alice]);
    act(s, alice, { t: 'stand' });
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, carol] });
    expect([chips(s, carol), score(s, carol)]).toEqual([1000, 1000]);
    act(s, carol, { t: 'bet', amount: 20 });
    expect(view(s).players[carol]).toMatchObject({ chips: 980, bet: 20, inRound: true });
  });

  it('has no seat limit: every newcomer is dealt in from the next round, and the shoe grows with the table', () => {
    const s = sim('blackjack');
    const ids = startGame(s, ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(gameById('blackjack').maxPlayers).toBeNull();
    const late = ['H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'].map((name) => {
      s.apply({ type: 'join', name, avatar: AVATAR, connectionId: name });
      return s.playerId(name);
    });
    betAll(s, view(s).order);
    for (let guard = 0; view(s).phase === 'acting' && guard < 50; guard++) {
      const turn = view(s).turn;
      if (turn) act(s, turn.playerId, { t: 'stand' });
    }
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [...ids, ...late] });
    expect(view(s).order).toHaveLength(20);
    expect(late.map((id) => chips(s, id))).toEqual(late.map(() => 1000));
    expect(data(s).shoe.length).toBeGreaterThanOrEqual(roundReserve(20));
    expect(view(s).shoeSize).toBeGreaterThanOrEqual(shoeDecks(1, 7) * 52);
  });

  it('ranks a newcomer who arrived during the final pause last, without a stack: nobody who never played decides the podium', () => {
    const s = sim('blackjack');
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
      { playerId: carol, score: 0, rank: 3 },
    ]);
  });

  it('deals when the last player still to bet leaves, passes the play when the acting player leaves, and drops leavers from the last table', () => {
    const s = sim('blackjack');
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
    expect(view(s).phase).toBe('betting');
    expect(results(s).every((r) => r.playerId === carol)).toBe(true);

    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' });
    const dave = s.playerId('Dave');
    s.apply({ type: 'leave', playerId: carol });
    expect(view(s)).toMatchObject({ phase: 'betting', order: [], lastRound: { order: [], hands: {} } });
    expect(Object.keys(view(s).players)).toEqual([dave]);
  });

  it('holds before the next round while nobody still in the game is connected, and seats everyone back after a settle', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    act(s, alice, { t: 'stand' });
    disconnect(s, alice, 'Alice');
    disconnect(s, bob, 'Bob');
    const held = tick(s, ACT_MS);
    expect(chatTexts(held)).toEqual(['Bob ran out of time and stands.', 'The dealer stands on 18.', 'Alice loses 10, Bob loses 10.', 'Waiting for Alice, Bob to reconnect…']);
    expect(waiting(s)).toEqual([alice, bob]);
    expect(view(s)).toMatchObject({ phase: 'held', endsAt: null, round: 1, lastRound: { round: 1 } });
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
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, bob], endsAt: s.now + BET_MS });
  });

  it('keeps going mid-round when a player drops: their bet or move waits for its clock, and they sit out a hand they never bet on', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    disconnect(s, alice, 'Alice');
    expect(waiting(s)).toBeNull();
    expect(view(s)).toMatchObject({ phase: 'acting', turn: { playerId: alice, handIndex: 0 } });
    reconnect(s, alice, 'Alice');
    act(s, alice, { t: 'stand' });
    disconnect(s, bob, 'Bob');
    const effects = tick(s, ACT_MS);
    // Alice alone is enough for the next round; Bob keeps his seat.
    expect(chatTexts(effects)).toEqual(['Bob ran out of time and stands.', 'The dealer stands on 18.', 'Alice loses 10, Bob loses 10.', 'Round 2: place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, bob] });
    act(s, alice, { t: 'bet', amount: 10 });
    const dealt = tick(s, 1700 + BET_MS);
    expect(chatTexts(dealt)).toEqual(['Bob sits this hand out.']);
    expect(view(s)).toMatchObject({ phase: 'acting', order: [alice], lastRound: null });
    expect(chips(s, bob)).toBe(990);
  });

  it('is a pure module: the same object comes back when nothing changed, and the view copies its cards', () => {
    const s = sim('blackjack');
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
