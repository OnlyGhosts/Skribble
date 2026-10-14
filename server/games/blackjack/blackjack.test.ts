/** Blackjack's rules through the pure engine: betting, dealing, every move, the dealer, payouts, chips as the score, rounds, holds and the edges. */
import { describe, expect, it } from 'vitest';
import { freshShoe, shuffle } from '../../../shared/games/blackjack/cards.js';
import type { BlackjackView, Card, CardRank } from '../../../shared/games/blackjack/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defaultPlatformSettings } from '../../../shared/platform/settings.js';
import type { Effect } from '../../platform/engine/effects.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { viewFor } from '../../platform/engine/view.js';
import { AVATAR, START, chatTexts, errorsOf, sim, startGame, type Sim } from '../../platform/engine/testHarness.js';
import { RESUME_SETTLE_MS } from '../waiting.js';
import { blackjackModule, type BlackjackData } from './module.js';

// The fixture: one round, one deck, bets 10-500 from 1000 chips, 10 s to bet, 10 s to act, 4 s of results.
const BET_MS = 10_000;
const ACT_MS = 10_000;
const RESULTS_MS = 4_000;

const card = (text: string): Card => ({ rank: text.slice(0, -1) as CardRank, suit: text.slice(-1) as Card['suit'] });
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

/** The platform score must equal the chips of every seated participant after every action. */
function expectScoresMatchChips(s: Sim): void {
  for (const p of s.data.players) {
    const seat = data(s).seats[p.id];
    if (seat) {
      expect(p.score, p.name).toBe(seat.chips);
      expect(seat.chips, p.name).toBeGreaterThanOrEqual(0);
    }
  }
}

/** Replaces the shoe with exactly these cards, coming out in the given order (first card first). */
function rigExact(s: Sim, ...texts: string[]): void {
  s.data = { ...s.data, game: { ...data(s), shoe: texts.map(card).reverse() } };
}

/** Cards under the rigged ones, so a rigged shoe never triggers the between-rounds reshuffle. */
const PAD = 30;

/** Replaces the shoe so the next cards come out in the given order, with twos underneath. */
function rig(s: Sim, ...texts: string[]): void {
  rigExact(s, ...texts, ...Array<string>(PAD).fill('2S'));
}

const act = (s: Sim, id: string, msg: unknown): Effect[] => {
  const effects = s.game(id, msg);
  expectScoresMatchChips(s);
  return effects;
};
const betAll = (s: Sim, ids: string[], amount = 10): void => {
  for (const id of ids) act(s, id, { t: 'bet', amount });
};
const tick = (s: Sim, ms: number): Effect[] => {
  s.now += ms;
  const effects = s.tick();
  expectScoresMatchChips(s);
  return effects;
};
const handsOf = (s: Sim, id: string) => view(s).players[id].hands;

describe('Blackjack: the table', () => {
  it('seats everyone with the starting stack as their score and opens the first round with betting', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    expect(s.data.phase).toBe('playing');
    expect(data(s)).toMatchObject({ round: 1, order: [alice, bob], dealer: [], holeHidden: true, reshuffled: false, results: [] });
    expect(data(s).phase).toEqual({ kind: 'betting', endsAt: START + BET_MS });
    expect(data(s).seats).toEqual({ [alice]: { chips: 1000, bet: 0, hands: [], bustedOut: false }, [bob]: { chips: 1000, bet: 0, hands: [], bustedOut: false } });
    expect([score(s, alice), score(s, bob)]).toEqual([1000, 1000]);
    // A single deck, shuffled with the injected rng.
    expect(data(s).shoe).toEqual(shuffle(freshShoe(1), () => 0));
    expect(chatTexts(s.effects)).toContain('Round 1 of 1 — place your bets!');
    expect(nextDeadline(s.data)).toBe(START + BET_MS);
    expect(view(s, alice)).toEqual({
      phase: 'betting',
      round: 1,
      totalRounds: 1,
      order: [alice, bob],
      turn: null,
      endsAt: START + BET_MS,
      paused: false,
      dealer: { cards: [], holeHidden: true, total: 0, soft: false, blackjack: false },
      players: {
        [alice]: { chips: 1000, bet: 0, hands: [], inRound: true, bustedOut: false },
        [bob]: { chips: 1000, bet: 0, hands: [], inRound: true, bustedOut: false },
      },
      actions: { canHit: false, canStand: false, canDouble: false, canSplit: false },
      results: [],
      shoeRemaining: 52,
      reshuffled: false,
    });
    expect(JSON.parse(JSON.stringify(data(s)))).toEqual(data(s));
  });

  it('normalises the bet window: the minimum never exceeds the starting stack and the maximum never sits below the minimum', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice']);
    expect(s.data.settings).toMatchObject({ minBet: 10, maxBet: 500 });
    const { settings } = blackjackModule;
    expect(settings.normalize?.({ ...settings.defaults, minBet: 800, maxBet: 500 })).toMatchObject({ minBet: 800, maxBet: 800 });
    expect(settings.normalize?.({ ...settings.defaults, startingChips: 100, minBet: 1000, maxBet: 50 })).toMatchObject({ minBet: 100, maxBet: 100 });
    expect(alice).toBe('id-1');
  });
});

describe('Blackjack: betting', () => {
  it('takes a stake between the minimum and the lesser of the maximum and the chips, lets it be changed, and deals once everyone has bet', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { maxBet: 2000 });
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S');
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 5 }))).toEqual(['Bet between 10 and 1000 chips.']);
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 1001 }))).toEqual(['Bet between 10 and 1000 chips.']);
    act(s, alice, { t: 'bet', amount: 100 });
    expect([chips(s, alice), view(s).players[alice].bet]).toEqual([900, 100]);
    // Changing the bet before the deal returns the earlier stake first; the cap counts it as available.
    act(s, alice, { t: 'bet', amount: 1000 });
    expect([chips(s, alice), view(s).players[alice].bet]).toEqual([0, 1000]);
    act(s, alice, { t: 'bet', amount: 50 });
    expect([chips(s, alice), view(s).players[alice].bet]).toEqual([950, 50]);
    expect(view(s).phase).toBe('betting');
    act(s, bob, { t: 'bet', amount: 10 });
    expect(view(s).phase).toBe('acting');
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 0 });
    expect(handsOf(s, alice)[0]).toMatchObject({ bet: 50, status: 'acting', cards: expect.arrayContaining([]) });
    expect(handsOf(s, alice)[0].cards).toHaveLength(2);
    expect(handsOf(s, bob)[0].cards).toHaveLength(2);
    expect(view(s).dealer.cards).toHaveLength(1);
    expect(view(s).shoeRemaining).toBe(PAD);
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 10 }))).toEqual(['You cannot bet right now.']);
  });

  it('refuses a stake above the maximum even with the chips for it', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice', 'Bob']);
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 501 }))).toEqual(['Bet between 10 and 500 chips.']);
    act(s, alice, { t: 'bet', amount: 500 });
    expect(chips(s, alice)).toBe(500);
    expect(view(s).phase).toBe('betting');
  });

  it('bets the minimum for every player still to bet at the deadline, connected or not', () => {
    const s = sim('blackjack');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S');
    act(s, alice, { t: 'bet', amount: 100 });
    disconnect(s, carol, 'Carol');
    expect(view(s).phase).toBe('betting');
    const effects = tick(s, BET_MS);
    expect(chatTexts(effects)).toEqual(['Bob bets the minimum (10).', 'Carol bets the minimum (10).']);
    expect(view(s)).toMatchObject({ phase: 'acting', order: [alice, bob, carol], turn: { playerId: alice, handIndex: 0 } });
    expect(view(s).players[carol]).toMatchObject({ chips: 990, bet: 10, inRound: true, bustedOut: false });
    expect(handsOf(s, carol)[0].cards).toHaveLength(2);
    expect(chips(s, bob)).toBe(990);
    expect(nextDeadline(s.data)).toBe(s.now + ACT_MS);
  });

  it('gives a sole player who dropped every round: the minimum is bet and stood for them, and the boundary holds until they are back', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice'], { rounds: 2 });
    rig(s, '10S', '6D', '8H', '10S', '3C');
    disconnect(s, alice, 'Alice');
    const dealt = tick(s, BET_MS);
    expect(chatTexts(dealt)).toEqual(['Alice bets the minimum (10).']);
    expect(view(s)).toMatchObject({ phase: 'acting', round: 1, order: [alice], turn: { playerId: alice, handIndex: 0 } });
    expect(chips(s, alice)).toBe(990);
    const stood = tick(s, ACT_MS);
    expect(chatTexts(stood)).toEqual(['Alice ran out of time — standing.', 'The dealer stands on 19.', 'Alice loses 10.']);
    expect(view(s)).toMatchObject({ phase: 'results', round: 1 });
    // Round 1 was played; round 2 waits for her rather than being burned.
    const held = tick(s, RESULTS_MS);
    expect(chatTexts(held)).toEqual(['Waiting for Alice to reconnect…']);
    expect(view(s)).toMatchObject({ phase: 'results', round: 1, paused: true });
    reconnect(s, alice, 'Alice');
    const resumed = tick(s, RESUME_SETTLE_MS);
    expect(chatTexts(resumed)).toEqual(['Round 2 of 2 — place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice], paused: false });
    expect(s.data.phase).toBe('playing');
  });

  it('does not spend a round when every seat left while the bets were open: the same round opens again for whoever is left', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice'], { rounds: 2 });
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    s.apply({ type: 'leave', playerId: alice });
    expectScoresMatchChips(s);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 1, order: [] });
    const effects = tick(s, BET_MS);
    expect(chatTexts(effects)).toEqual(['Round 1 of 2 — place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 1, order: [carol] });
    expect([chips(s, carol), score(s, carol)]).toEqual([1000, 1000]);
    expect(s.data.phase).toBe('playing');
  });
});

describe('Blackjack: dealing and the moves', () => {
  it('deals two cards each and the dealer an up card, calls out naturals and skips them when the play begins', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '9H', '5D', 'KH', '7C', '10S', '2S');
    act(s, alice, { t: 'bet', amount: 10 });
    const effects = act(s, bob, { t: 'bet', amount: 10 });
    expect(chatTexts(effects)).toEqual(['Alice has blackjack!']);
    expect(handsOf(s, alice)).toEqual([{ cards: [card('AS'), card('KH')], total: 21, soft: true, bet: 10, status: 'blackjack', doubled: false, fromSplit: false }]);
    expect(handsOf(s, bob)).toEqual([{ cards: [card('9H'), card('7C')], total: 16, soft: false, bet: 10, status: 'acting', doubled: false, fromSplit: false }]);
    expect(view(s)).toMatchObject({ phase: 'acting', turn: { playerId: bob, handIndex: 0 }, endsAt: s.now + ACT_MS, shoeRemaining: PAD + 1 });
    expect(view(s).dealer).toEqual({ cards: [card('5D')], holeHidden: true, total: 5, soft: false, blackjack: false });
    expect(data(s).dealer).toEqual([card('5D'), card('10S')]);
    expect(view(s, alice).actions).toEqual({ canHit: false, canStand: false, canDouble: false, canSplit: false });
    expect(view(s, bob).actions).toEqual({ canHit: true, canStand: true, canDouble: true, canSplit: false });
    expect(view(s, null).actions).toEqual({ canHit: false, canStand: false, canDouble: false, canSplit: false });
    expect(errorsOf(act(s, alice, { t: 'hit' }))).toEqual(['It is not your turn.']);

    // Bob stands on 16; the dealer turns 15 and draws a 2: the natural pays 3:2, the 16 loses.
    const stood = act(s, bob, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 17.', 'Alice wins 15, Bob loses 10.']);
    expect(view(s)).toMatchObject({ phase: 'results', turn: null, endsAt: s.now + RESULTS_MS, paused: false });
    expect(view(s).dealer).toEqual({ cards: [card('5D'), card('10S'), card('2S')], holeHidden: false, total: 17, soft: false, blackjack: false });
    expect(view(s).results).toEqual([
      { playerId: alice, handIndex: 0, outcome: 'blackjack', bet: 10, payout: 25 },
      { playerId: bob, handIndex: 0, outcome: 'loss', bet: 10, payout: 0 },
    ]);
    expect(handsOf(s, alice)[0].status).toBe('blackjack');
    expect(handsOf(s, bob)[0].status).toBe('lost');
    expect([chips(s, alice), chips(s, bob)]).toEqual([1015, 990]);
    expect([score(s, alice), score(s, bob)]).toEqual([1015, 990]);
    expect(nextDeadline(s.data)).toBe(s.now + RESULTS_MS);
  });

  it('hits for a card with a fresh clock, stands a 21 by itself and busts over it', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '5D', '9H', '5C', '2C');
    betAll(s, [alice, bob]);
    s.now += 3000;
    const hit = act(s, alice, { t: 'hit' });
    expect(chatTexts(hit)).toEqual([]);
    // 10 + 6 + 5 = 21: nothing left to do, the play passes to Bob.
    expect(handsOf(s, alice)[0]).toMatchObject({ total: 21, status: 'stood' });
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
    expect(view(s).endsAt).toBe(s.now + ACT_MS);
    s.now += 2000;
    act(s, bob, { t: 'hit' });
    expect(handsOf(s, bob)[0]).toMatchObject({ total: 20, status: 'acting', cards: [card('5H'), card('6C'), card('9H')] });
    expect(view(s).endsAt).toBe(s.now + ACT_MS);
    expect(view(s, bob).actions).toEqual({ canHit: true, canStand: true, canDouble: false, canSplit: false });
    const bust = act(s, bob, { t: 'hit' });
    expect(bust.some((e) => e.type === 'send' && e.msg.t === 'chat' && (e.msg as { message: { kind: string; text: string } }).message.text === 'Bob busts with 25.')).toBe(true);
    expect(handsOf(s, bob)[0]).toMatchObject({ total: 25, status: 'bust' });
    // The dealer draws 9 + 7 + 2 = 18: Alice's 21 wins even money.
    expect(chatTexts(bust).slice(1)).toEqual(['The dealer stands on 18.', 'Alice wins 10, Bob loses 10.']);
    expect(view(s).results).toEqual([
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
    expect(handsOf(s, alice)[0]).toEqual({ cards: [card('5S'), card('6H'), card('KS')], total: 21, soft: false, bet: 20, status: 'stood', doubled: true, fromSplit: false });
    expect(chips(s, alice)).toBe(980);
    expect(chatTexts(doubled)).toEqual([]);
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
    act(s, bob, { t: 'hit' });
    expect(errorsOf(act(s, bob, { t: 'double' }))).toEqual(['You cannot double this hand.']);
    expect(view(s, bob).actions.canDouble).toBe(false);
    act(s, bob, { t: 'stand' });
    // Dealer 6 + 10 + 5 = 21: the doubled 21 pushes its 20 back, Bob's 19 loses.
    expect(view(s).results).toEqual([
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
    const [bob] = startGame(broke, ['Bob'], { startingChips: 100, maxBet: 100 });
    rig(broke, '7S', '6D', '6H', '10S', 'KS', '5C');
    act(broke, bob, { t: 'bet', amount: 100 });
    expect(view(broke, bob).actions.canDouble).toBe(false);
    expect(errorsOf(act(broke, bob, { t: 'double' }))).toEqual(['You cannot double this hand.']);

    const bust = sim('blackjack');
    const [carol] = startGame(bust, ['Carol']);
    rig(bust, '7S', '6D', '6H', '10S', 'KS');
    betAll(bust, [carol]);
    const effects = act(bust, carol, { t: 'double' });
    expect(handsOf(bust, carol)[0]).toMatchObject({ total: 23, bet: 20, status: 'bust', doubled: true });
    expect(chatTexts(effects)).toEqual(['Carol busts with 23.', 'The dealer shows 16.', 'Carol loses 20.']);
    expect(chips(bust, carol)).toBe(980);
  });

  it('splits a pair (ten-value cards mixed) into two hands played in turn, once only, and a 21 after a split pays even money', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '8S', '10H', '6D', '8H', 'KC', '10S', '8D', '10C', 'AS', '9S', '4H');
    betAll(s, [alice, bob]);
    expect(view(s, alice).actions.canSplit).toBe(true);
    const split = act(s, alice, { t: 'split' });
    expect(chatTexts(split)).toEqual(['Alice splits a pair.']);
    expect(chips(s, alice)).toBe(980);
    expect(handsOf(s, alice)).toEqual([
      { cards: [card('8S'), card('8D')], total: 16, soft: false, bet: 10, status: 'acting', doubled: false, fromSplit: true },
      { cards: [card('8H'), card('10C')], total: 18, soft: false, bet: 10, status: 'waiting', doubled: false, fromSplit: true },
    ]);
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 0 });
    // A second pair may not be split again; doubling a split hand is fine.
    expect(view(s, alice).actions).toEqual({ canHit: true, canStand: true, canDouble: true, canSplit: false });
    expect(errorsOf(act(s, alice, { t: 'split' }))).toEqual(['You cannot split this hand.']);
    act(s, alice, { t: 'stand' });
    expect(view(s).turn).toEqual({ playerId: alice, handIndex: 1 });
    expect(handsOf(s, alice).map((h) => h.status)).toEqual(['stood', 'acting']);
    act(s, alice, { t: 'stand' });
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });

    // Bob's 10 and K count as a pair; the ace on his first split hand makes a plain 21, not a natural.
    expect(view(s, bob).actions.canSplit).toBe(true);
    act(s, bob, { t: 'split' });
    expect(handsOf(s, bob)).toEqual([
      { cards: [card('10H'), card('AS')], total: 21, soft: true, bet: 10, status: 'stood', doubled: false, fromSplit: true },
      { cards: [card('KC'), card('9S')], total: 19, soft: false, bet: 10, status: 'acting', doubled: false, fromSplit: true },
    ]);
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 1 });
    const stood = act(s, bob, { t: 'stand' });
    // Dealer 6 + 10 + 4 = 20.
    expect(chatTexts(stood)).toEqual(['The dealer stands on 20.', 'Alice loses 20, Bob pushes.']);
    expect(view(s).results).toEqual([
      { playerId: alice, handIndex: 0, outcome: 'loss', bet: 10, payout: 0 },
      { playerId: alice, handIndex: 1, outcome: 'loss', bet: 10, payout: 0 },
      { playerId: bob, handIndex: 0, outcome: 'win', bet: 10, payout: 20 },
      { playerId: bob, handIndex: 1, outcome: 'loss', bet: 10, payout: 0 },
    ]);
    expect(handsOf(s, bob).map((h) => h.status)).toEqual(['won', 'lost']);
    expect([chips(s, alice), chips(s, bob)]).toEqual([980, 1000]);
  });

  it('gives split aces one card each and moves on; the table can forbid splits and the chips must cover one', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '5H', '10D', 'AH', '6C', '7S', 'KD', '5D');
    betAll(s, [alice, bob]);
    const split = act(s, alice, { t: 'split' });
    expect(chatTexts(split)).toEqual(['Alice splits aces.']);
    expect(handsOf(s, alice)).toEqual([
      { cards: [card('AS'), card('KD')], total: 21, soft: true, bet: 10, status: 'stood', doubled: false, fromSplit: true },
      { cards: [card('AH'), card('5D')], total: 16, soft: true, bet: 10, status: 'stood', doubled: false, fromSplit: true },
    ]);
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
    act(s, bob, { t: 'stand' });
    // Dealer 10 + 7 stands: the split 21 wins even money, the 16 loses.
    expect(view(s).results).toEqual([
      { playerId: alice, handIndex: 0, outcome: 'win', bet: 10, payout: 20 },
      { playerId: alice, handIndex: 1, outcome: 'loss', bet: 10, payout: 0 },
      { playerId: bob, handIndex: 0, outcome: 'loss', bet: 10, payout: 0 },
    ]);
    expect(chips(s, alice)).toBe(1000);

    const off = sim('blackjack');
    const [carol] = startGame(off, ['Carol'], { allowSplit: false });
    rig(off, '8S', '6D', '8H', '10S', '2C');
    betAll(off, [carol]);
    expect(view(off, carol).actions.canSplit).toBe(false);
    expect(errorsOf(act(off, carol, { t: 'split' }))).toEqual(['You cannot split this hand.']);

    const broke = sim('blackjack');
    const [dave] = startGame(broke, ['Dave'], { startingChips: 100, maxBet: 100 });
    rig(broke, '8S', '6D', '8H', '10S', '2C');
    act(broke, dave, { t: 'bet', amount: 100 });
    expect(view(broke, dave).actions.canSplit).toBe(false);
    expect(errorsOf(act(broke, dave, { t: 'split' }))).toEqual(['You cannot split this hand.']);
  });

  it('stands a hand whose clock runs out', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    const effects = tick(s, ACT_MS);
    expect(chatTexts(effects)).toEqual(['Alice ran out of time — standing.']);
    expect(handsOf(s, alice)[0].status).toBe('stood');
    expect(view(s).turn).toEqual({ playerId: bob, handIndex: 0 });
    expect(nextDeadline(s.data)).toBe(s.now + ACT_MS);
  });
});

describe('Blackjack: the dealer', () => {
  it('stands on a soft 17 unless the table says to hit it', () => {
    const stands = sim('blackjack');
    const [alice] = startGame(stands, ['Alice']);
    rig(stands, '10S', 'AD', '8H', '6S', '4C');
    betAll(stands, [alice]);
    const stood = act(stands, alice, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 17.', 'Alice wins 10.']);
    expect(view(stands).dealer).toEqual({ cards: [card('AD'), card('6S')], holeHidden: false, total: 17, soft: true, blackjack: false });
    expect(chips(stands, alice)).toBe(1010);

    const hits = sim('blackjack');
    const [bob] = startGame(hits, ['Bob'], { dealerHitsSoft17: true });
    rig(hits, '10S', 'AD', '8H', '6S', '4C');
    betAll(hits, [bob]);
    const effects = act(hits, bob, { t: 'stand' });
    expect(chatTexts(effects)).toEqual(['The dealer stands on 21.', 'Bob loses 10.']);
    expect(view(hits).dealer).toMatchObject({ cards: [card('AD'), card('6S'), card('4C')], total: 21, soft: true });
    expect(chips(hits, bob)).toBe(990);
  });

  it('shows the hole card without drawing when no hand is left standing', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice']);
    rig(s, '10S', '6D', '6H', '10S', 'KD', '5C');
    betAll(s, [alice]);
    const effects = act(s, alice, { t: 'hit' });
    expect(chatTexts(effects)).toEqual(['Alice busts with 26.', 'The dealer shows 16.', 'Alice loses 10.']);
    expect(view(s).dealer).toEqual({ cards: [card('6D'), card('10S')], holeHidden: false, total: 16, soft: false, blackjack: false });
    expect(view(s).shoeRemaining).toBe(PAD + 1);
  });

  it('pushes a natural against a dealer natural and beats every other hand with it', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '10H', 'AD', 'KH', '9C', 'KS');
    betAll(s, [alice, bob]);
    const effects = act(s, bob, { t: 'stand' });
    expect(chatTexts(effects)).toEqual(['The dealer stands on 21.', 'Alice pushes, Bob loses 10.']);
    expect(view(s).dealer).toMatchObject({ holeHidden: false, total: 21, blackjack: true });
    expect(view(s).results).toEqual([
      { playerId: alice, handIndex: 0, outcome: 'push', bet: 10, payout: 10 },
      { playerId: bob, handIndex: 0, outcome: 'loss', bet: 10, payout: 0 },
    ]);
    expect(handsOf(s, alice)[0].status).toBe('push');
    expect([chips(s, alice), chips(s, bob)]).toEqual([1000, 990]);
  });

  it('pays a natural 6:5 when the table says so', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice'], { blackjackPayout: '6:5' });
    rig(s, 'AS', '9D', 'KH', '8S');
    const effects = betAll(s, [alice]);
    expect(effects).toBeUndefined();
    expect(chatTexts(s.effects).slice(-3)).toEqual(['Alice has blackjack!', 'The dealer shows 17.', 'Alice wins 12.']);
    expect(view(s).results).toEqual([{ playerId: alice, handIndex: 0, outcome: 'blackjack', bet: 10, payout: 22 }]);
    expect(chips(s, alice)).toBe(1012);
  });
});

describe('Blackjack: rounds, results and the end', () => {
  it('moves on after the results clock, or when the host skips; nobody else may', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { rounds: 3 });
    expect(errorsOf(act(s, alice, { t: 'next' }))).toEqual(['There is no result to skip.']);
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    act(s, alice, { t: 'stand' });
    act(s, bob, { t: 'stand' });
    expect(view(s).phase).toBe('results');
    expect(errorsOf(act(s, bob, { t: 'next' }))).toEqual(['Only the host can skip ahead.']);
    const skipped = act(s, alice, { t: 'next' });
    expect(chatTexts(skipped)).toEqual(['Round 2 of 3 — place your bets!']);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, endsAt: s.now + BET_MS, dealer: { cards: [], holeHidden: true } });
    // Last round's settled hands stay on show through the betting; the stakes and hands are fresh.
    expect(view(s).results).toHaveLength(2);
    expect(view(s).players[alice]).toMatchObject({ bet: 0, hands: [], inRound: true });
    betAll(s, [alice, bob]);
    tick(s, ACT_MS);
    tick(s, ACT_MS);
    expect(view(s).phase).toBe('results');
    const next = tick(s, RESULTS_MS);
    expect(chatTexts(next)).toEqual(['Round 3 of 3 — place your bets!']);
    expect(view(s).round).toBe(3);
  });

  it('ends after the last round with the podium ranked by chips', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '9H', '5D', 'KH', '7C', '10S', '2S');
    betAll(s, [alice, bob]);
    act(s, bob, { t: 'stand' });
    expect(s.data.phase).toBe('playing');
    const effects = tick(s, RESULTS_MS);
    expect(s.data.phase).toBe('ended');
    expect(data(s).phase).toEqual({ kind: 'gameOver' });
    expect(view(s)).toMatchObject({ phase: 'gameOver', endsAt: null, turn: null });
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 1015, rank: 1 },
      { playerId: bob, score: 990, rank: 2 },
    ]);
    expect(chatTexts(effects)).toEqual(['Game over! Alice wins with 1015 points.']);
    expect(nextDeadline(s.data)).toBeNull();
    expect(errorsOf(act(s, alice, { t: 'next' }))).toEqual(['The game is not running.']);
  });

  it('puts a player with fewer chips than the minimum bet out of the game, and ends it once everyone is out', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { rounds: 5, startingChips: 100, minBet: 50, maxBet: 100 });
    rig(s, '10S', '10H', '10D', '6H', '9C', '7S', 'KD');
    act(s, alice, { t: 'bet', amount: 100 });
    act(s, bob, { t: 'bet', amount: 50 });
    act(s, alice, { t: 'hit' });
    const stood = act(s, bob, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 17.', 'Alice loses 100, Bob wins 50.', 'Alice is out of chips.']);
    expect(view(s).players[alice]).toMatchObject({ chips: 0, bustedOut: true });
    expect([score(s, alice), score(s, bob)]).toEqual([0, 150]);
    tick(s, RESULTS_MS);
    expect(view(s)).toMatchObject({ round: 2, order: [bob] });
    expect(view(s).players[alice]).toMatchObject({ inRound: false, bustedOut: true, hands: [] });
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 50 }))).toEqual(['You cannot bet right now.']);

    // A busted-out player keeps their socket but counts for nothing: with Bob away the next round holds.
    rig(s, '10S', '10D', '6H', '7S');
    act(s, bob, { t: 'bet', amount: 100 });
    act(s, bob, { t: 'stand' });
    expect(chips(s, bob)).toBe(50);
    disconnect(s, bob, 'Bob');
    const held = tick(s, RESULTS_MS);
    expect(chatTexts(held)).toEqual(['Waiting for Bob to reconnect…']);
    expect(waiting(s)).toEqual([bob]);
    expect(view(s)).toMatchObject({ phase: 'results', paused: true, endsAt: null });
    expect(nextDeadline(s.data)).not.toBeNull(); // only Bob's seat expiry
    expect(data(s).phase).toMatchObject({ kind: 'results', held: true, resumeAt: null });
    reconnect(s, bob, 'Bob');
    expect(waiting(s)).toBeNull();
    tick(s, RESUME_SETTLE_MS);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 3, order: [bob] });

    rig(s, '10S', '10D', '6H', '7S');
    act(s, bob, { t: 'bet', amount: 50 });
    const last = act(s, bob, { t: 'stand' });
    expect(chatTexts(last)).toEqual(['The dealer stands on 17.', 'Bob loses 50.', 'Bob is out of chips.']);
    const over = tick(s, RESULTS_MS);
    expect(chatTexts(over)).toEqual(['Everyone is out of chips — the house wins.', 'Game over! Alice and Bob tie with 0 points.']);
    expect(s.data.phase).toBe('ended');
  });

  it('reshuffles the shoe between rounds once under a quarter remains, and at once when it runs out mid-hand', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice'], { rounds: 2 });
    rigExact(s, '10S', '6D', '8H', '10S', '3C', '4C', '5C', '6C', '7C', '8C', '9C', '2C');
    betAll(s, [alice]);
    const stood = act(s, alice, { t: 'stand' });
    expect(chatTexts(stood)).toEqual(['The dealer stands on 19.', 'Alice loses 10.']);
    expect(view(s).shoeRemaining).toBe(7);
    const next = tick(s, RESULTS_MS);
    expect(chatTexts(next)).toEqual(['Under a quarter of the shoe is left — the shoe is reshuffled.', 'Round 2 of 2 — place your bets!']);
    expect(view(s)).toMatchObject({ reshuffled: true, shoeRemaining: 52 });

    const empties = sim('blackjack');
    const [bob] = startGame(empties, ['Bob']);
    rigExact(empties, 'AS', 'KD', '5S', '7H');
    betAll(empties, [bob]);
    expect(view(empties).shoeRemaining).toBe(0);
    const hit = act(empties, bob, { t: 'hit' });
    expect(chatTexts(hit)[0]).toBe('The shoe ran out — the shoe is reshuffled.');
    expect(handsOf(empties, bob)[0].cards).toHaveLength(3);
    expect(view(empties)).toMatchObject({ reshuffled: true, shoeRemaining: 52 - 5 });
    // The rebuilt shoe leaves out the cards on the table: the deck is whole and nothing is dealt twice.
    const table = [...data(empties).dealer, ...Object.values(data(empties).seats).flatMap((seat) => seat.hands.flatMap((h) => h.cards))];
    expect(table).toHaveLength(5);
    const whole = [...data(empties).shoe, ...table].map((c) => c.rank + c.suit);
    expect(whole).toHaveLength(52);
    expect(new Set(whole).size).toBe(52);
  });
});

describe('Blackjack: seats coming and going', () => {
  it('seats a late joiner with the starting stack only when the next round starts', () => {
    const s = sim('blackjack');
    const [alice] = startGame(s, ['Alice'], { rounds: 2 });
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
    tick(s, RESULTS_MS);
    expect(view(s)).toMatchObject({ round: 2, order: [alice, carol] });
    expect([chips(s, carol), score(s, carol)]).toEqual([1000, 1000]);
    act(s, carol, { t: 'bet', amount: 20 });
    expect(view(s).players[carol]).toMatchObject({ chips: 980, bet: 20, inRound: true });
  });

  it('ranks a newcomer who arrived during the final results last, without a stack: nobody who never played decides the podium', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rig(s, 'AS', '9H', '5D', 'KH', '7C', '10S', '2S');
    betAll(s, [alice, bob]);
    act(s, bob, { t: 'stand' });
    expect(view(s).phase).toBe('results');
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expectScoresMatchChips(s);
    expect([score(s, carol), data(s).seats[carol]]).toEqual([0, undefined]);
    const over = tick(s, RESULTS_MS);
    expect(s.data.phase).toBe('ended');
    expect(chatTexts(over)).toEqual(['Game over! Alice wins with 1015 points.']);
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 1015, rank: 1 },
      { playerId: bob, score: 990, rank: 2 },
      { playerId: carol, score: 0, rank: 3 },
    ]);
  });

  it('deals when the last player still to bet leaves, and passes the play when the acting player leaves', () => {
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
    expect(view(s).phase).toBe('results');
    expect(view(s).results.every((r) => r.playerId === carol)).toBe(true);
  });

  it('holds between rounds while nobody still in the game is connected, and seats everyone back after a settle', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { rounds: 2 });
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    act(s, alice, { t: 'stand' });
    act(s, bob, { t: 'stand' });
    disconnect(s, alice, 'Alice');
    disconnect(s, bob, 'Bob');
    const held = tick(s, RESULTS_MS);
    expect(chatTexts(held)).toEqual(['Waiting for Alice, Bob to reconnect…']);
    expect(waiting(s)).toEqual([alice, bob]);
    expect(view(s)).toMatchObject({ phase: 'results', paused: true, endsAt: null, round: 1 });
    expect(nextDeadline(s.data)).toBeGreaterThan(s.now + RESUME_SETTLE_MS); // the seat expiries only
    // Nothing happens while the hold lasts.
    expect(tick(s, 60_000)).toEqual([]);

    reconnect(s, bob, 'Bob');
    expect(waiting(s)).toEqual([alice]);
    expect(data(s).phase).toMatchObject({ kind: 'results', held: true, resumeAt: s.now + RESUME_SETTLE_MS });
    // A further reconnect restarts the settle; then the round starts for everyone seated, Alice included.
    s.now += 1000;
    reconnect(s, alice, 'Alice');
    expect(data(s).phase).toMatchObject({ held: true, resumeAt: s.now + RESUME_SETTLE_MS });
    expect(tick(s, RESUME_SETTLE_MS - 1)).toEqual([]);
    const resumed = tick(s, 1);
    expect(chatTexts(resumed)).toEqual(['Round 2 of 2 — place your bets!']);
    expect(waiting(s)).toBeNull();
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, bob], paused: false });
  });

  it('keeps going mid-round when a player drops: their bet or move waits for its clock', () => {
    const s = sim('blackjack');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { rounds: 2 });
    rig(s, '10S', '5H', '9D', '6H', '6C', '7S', '2C');
    betAll(s, [alice, bob]);
    disconnect(s, alice, 'Alice');
    expect(waiting(s)).toBeNull();
    expect(view(s)).toMatchObject({ phase: 'acting', turn: { playerId: alice, handIndex: 0 } });
    reconnect(s, alice, 'Alice');
    act(s, alice, { t: 'stand' });
    disconnect(s, bob, 'Bob');
    const effects = tick(s, ACT_MS);
    expect(chatTexts(effects)).toEqual(['Bob ran out of time — standing.', 'The dealer stands on 18.', 'Alice loses 10, Bob loses 10.']);
    expect(view(s).phase).toBe('results');
    // Alice alone is enough for the next round; Bob keeps his seat and bets the minimum at the deadline.
    tick(s, RESULTS_MS);
    expect(view(s)).toMatchObject({ phase: 'betting', round: 2, order: [alice, bob] });
    const dealt = tick(s, BET_MS);
    expect(chatTexts(dealt)).toEqual(['Alice bets the minimum (10).', 'Bob bets the minimum (10).']);
    expect(view(s)).toMatchObject({ phase: 'acting', order: [alice, bob] });
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
    expect(projected.results).not.toBe(bet.data.results);
    expect(projected.dealer.cards).toEqual([]);
  });
});
