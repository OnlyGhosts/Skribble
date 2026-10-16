/** Poker's rules through the pure engine: blinds and the button, every move, the streets, side pots, the showdown, chips as the score, holds and the edges. */
import { describe, expect, it } from 'vitest';
import { POKER_ACT_SECONDS, POKER_RESULTS_SECONDS, type PokerView } from '../../../shared/games/poker/protocol.js';
import { settleRevealMs } from '../../../shared/games/poker/reveal.js';
import { cardOf, freshDeck, shuffle } from '../../../shared/platform/cards.js';
import { gameById } from '../../../shared/platform/games.js';
import { defaultPlatformSettings } from '../../../shared/platform/settings.js';
import type { Effect } from '../../platform/engine/effects.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { viewFor } from '../../platform/engine/view.js';
import { AVATAR, START, chatTexts, endGame, noticeTexts, errorsOf, sim, standings, startGame, type Sim } from '../../platform/engine/testHarness.js';
import { RESUME_SETTLE_MS } from '../waiting.js';
import { pokerModule, type PokerData } from './module.js';
import { buildPots, splitPot } from './pots.js';

// The fixture: one hand, blinds 5/10 from 1000 chips; the clocks are the fixed ones.
const ACT_MS = POKER_ACT_SECONDS * 1000;
const RESULTS_MS = POKER_RESULTS_SECONDS * 1000;

const data = (s: Sim): PokerData => s.data.game as PokerData;
const view = (s: Sim, viewer: string | null = null): PokerView => {
  const game = viewFor(s.data, viewer, s.now).game;
  if (!game) throw new Error('no game');
  return game as PokerView;
};
const score = (s: Sim, id: string): number => s.data.players.find((p) => p.id === id)?.score ?? -1;
const chips = (s: Sim, id: string): number => data(s).seats[id]?.chips ?? -1;
const token = (s: Sim, id: string): string => s.data.players.find((p) => p.id === id)?.token ?? '';
const waiting = (s: Sim): string[] | null => viewFor(s.data, null, s.now).waiting?.missing ?? null;
/** A lasting drop: the game hears of it at once. */
const disconnect = (s: Sim, id: string, name: string): Effect[] => s.drop(id, `conn-${name}`);
const reconnect = (s: Sim, id: string, name: string): Effect[] => s.apply({ type: 'rejoin', token: token(s, id), connectionId: `conn-${name}-2` });

/** The platform score must equal the chips of every seated participant after every action, and no stack may go negative. */
function expectScoresMatchChips(s: Sim): void {
  // A finished game is gone from the room (its results stay): there is no table left to check.
  if (s.data.game === null) return;
  for (const p of s.data.players) {
    const seat = data(s).seats[p.id];
    if (seat) {
      expect(p.score, p.name).toBe(seat.chips);
      expect(seat.chips, p.name).toBeGreaterThanOrEqual(0);
    }
  }
}

/** Every chip in the game is somewhere: in a stack, on the street or in the pots. */
function totalChips(s: Sim): number {
  return Object.values(data(s).seats).reduce((sum, seat) => sum + seat.chips + seat.bet + seat.committed, 0);
}

const act = (s: Sim, id: string, msg: unknown): Effect[] => {
  const effects = s.game(id, msg);
  expectScoresMatchChips(s);
  return effects;
};
const tick = (s: Sim, ms: number): Effect[] => {
  s.now += ms;
  const effects = s.tick();
  expectScoresMatchChips(s);
  return effects;
};
/** What is left of the results pause: the reveal allowance plus the results time from the settle. */
const resultsLeft = (s: Sim): number => {
  const { phase } = data(s);
  return phase.kind === 'results' ? phase.endsAt - s.now : RESULTS_MS;
};
const tickResults = (s: Sim): Effect[] => tick(s, resultsLeft(s));

/** Replaces the hole cards and the rest of the deck (the board comes out in the given order) for the hand in progress. */
function rigHand(s: Sim, holes: Record<string, [string, string]>, board: string[]): void {
  const game = structuredClone(data(s));
  for (const [id, cards] of Object.entries(holes)) game.seats[id].cards = cards.map(cardOf);
  // The next card is the last one: the board sits on top of twenty filler cards.
  game.deck = [...Array<string>(20).fill('2C').map(cardOf), ...board.map(cardOf).reverse()];
  s.data = { ...s.data, game };
}

/** Sets stacks (and the matching scores) for the hand in progress, blinds already posted. */
function rigChips(s: Sim, stacks: Record<string, number>): void {
  const game = structuredClone(data(s));
  for (const [id, n] of Object.entries(stacks)) game.seats[id].chips = n;
  s.data = { ...s.data, game, players: s.data.players.map((p) => (p.id in stacks ? { ...p, score: stacks[p.id] } : p)) };
}

const BOARD_DRY = ['2S', '7D', '9H', 'JC', '4S'];

describe('Poker: the table', () => {
  it('seats everyone with the starting stack as their score, posts the blinds left of the button and opens the preflop betting', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    expect(s.data.phase).toBe('playing');
    // rng () => 0 gives the host the button; the small blind sits left of it, the big blind next, and the button acts first three-handed.
    expect(data(s)).toMatchObject({ hand: 1, smallBlind: 5, order: [alice, bob, carol], dealerId: alice, dealerOrder: 0, street: 'preflop', community: [], highest: 10, minRaise: 10, toAct: [alice, bob, carol], results: null, acted: false, idleHands: 0 });
    expect(data(s).phase).toEqual({ kind: 'acting', endsAt: START + ACT_MS });
    expect(data(s).seats[alice]).toMatchObject({ chips: 1000, bet: 0, committed: 0, status: 'in', lastAction: null, gone: false });
    expect(data(s).seats[bob]).toMatchObject({ chips: 995, bet: 5, status: 'in', lastAction: { kind: 'smallBlind', amount: 5 } });
    expect(data(s).seats[carol]).toMatchObject({ chips: 990, bet: 10, status: 'in', lastAction: { kind: 'bigBlind', amount: 10 } });
    expect([alice, bob, carol].map((id) => score(s, id))).toEqual([1000, 995, 990]);
    expect(totalChips(s)).toBe(3000);
    // Two private cards each off a deck shuffled with the injected rng.
    for (const id of [alice, bob, carol]) expect(data(s).seats[id].cards).toHaveLength(2);
    expect(data(s).deck).toHaveLength(46);
    expect([...data(s).deck, ...data(s).seats[carol].cards.reverse(), ...data(s).seats[bob].cards.reverse(), ...data(s).seats[alice].cards.reverse()].length).toBe(52);
    expect(data(s).deck).toEqual(shuffle(freshDeck(), () => 0).slice(0, 46));
    expect(chatTexts(s.effects)).toContain('Hand 1 (blinds 5/10): Alice has the button, Bob posts 5, Carol posts 10.');
    expect(nextDeadline(s.data)).toBe(START + ACT_MS);
    expect(view(s, alice)).toEqual({
      phase: 'acting',
      street: 'preflop',
      hand: 1,
      totalHands: 1,
      blinds: { small: 5, big: 10 },
      dealerId: alice,
      community: [],
      pot: 15,
      pots: [],
      order: [alice, bob, carol],
      turn: alice,
      endsAt: START + ACT_MS,
      paused: false,
      players: {
        [alice]: { chips: 1000, bet: 0, committed: 0, status: 'acting', isDealer: true, isTurn: true, lastAction: null, busted: false, waitingForSeat: false },
        [bob]: { chips: 995, bet: 5, committed: 5, status: 'waiting', isDealer: false, isTurn: false, lastAction: { kind: 'smallBlind', amount: 5 }, busted: false, waitingForSeat: false },
        [carol]: { chips: 990, bet: 10, committed: 10, status: 'waiting', isDealer: false, isTurn: false, lastAction: { kind: 'bigBlind', amount: 10 }, busted: false, waitingForSeat: false },
      },
      myCards: data(s).seats[alice].cards,
      actions: { canFold: true, canCheck: false, canCall: true, callAmount: 10, canBet: false, minBet: 10, maxBet: 1000, canRaise: true, minRaiseTo: 20, maxRaiseTo: 1000, canAllIn: true },
      results: null,
      lastMove: { kind: 'bigBlind', amount: 10, seq: 2, playerId: carol, street: 'preflop' },
    });
    expect(JSON.parse(JSON.stringify(data(s)))).toEqual(data(s));
  });

  it('shows hole cards to their owner only: never in another view, a spectator view or a chat line', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rigHand(s, { [alice]: ['AS', 'AD'], [bob]: ['KS', 'KD'], [carol]: ['QS', 'QD'] }, BOARD_DRY);
    s.apply({ type: 'join', name: 'Dave', avatar: AVATAR, connectionId: 'd' });
    const dave = s.playerId('Dave');
    expect(view(s, alice).myCards.map((c) => c.rank + c.suit)).toEqual(['AS', 'AD']);
    expect(view(s, bob).myCards.map((c) => c.rank + c.suit)).toEqual(['KS', 'KD']);
    expect(view(s, dave).myCards).toEqual([]);
    expect(view(s, null).myCards).toEqual([]);
    for (const viewer of [alice, bob, carol, dave, null]) {
      const v = view(s, viewer);
      for (const p of Object.values(v.players)) expect(Object.keys(p)).not.toContain('cards');
      const text = JSON.stringify({ ...v, myCards: [] });
      for (const card of ['AS', 'AD', 'KS', 'KD', 'QS', 'QD']) expect(text).not.toContain(`"rank":"${card.slice(0, -1)}","suit":"${card.slice(-1)}"`);
    }
    // The whole hand plays out to a showdown without a card name ever reaching the chat.
    act(s, alice, { t: 'call' });
    act(s, bob, { t: 'call' });
    act(s, carol, { t: 'check' });
    for (let street = 0; street < 3; street++) for (const id of [bob, carol, alice]) act(s, id, { t: 'check' });
    expect(view(s).phase).toBe('results');
    for (const line of chatTexts(s.effects)) expect(line).not.toMatch(/\b(AS|AD|KS|KD|QS|QD)\b/);
    // At the showdown the contenders' cards are public, through the results only.
    expect(Object.keys(view(s, dave).results?.revealed ?? {}).sort()).toEqual([alice, bob, carol].sort());
    expect(view(s, dave).myCards).toEqual([]);
  });

  it('keeps the small blind affordable from the starting stack', () => {
    const { settings } = pokerModule;
    expect(settings.normalize?.({ ...settings.defaults, startingChips: 100, smallBlind: 80 })).toMatchObject({ startingChips: 100, smallBlind: 50 });
    expect(settings.normalize?.({ ...settings.defaults, startingChips: 1000, smallBlind: 80 })).toMatchObject({ smallBlind: 80 });
    expect(settings.schema.safeParse({ ...settings.defaults, hands: 0, blindsIncreaseEvery: 0 }).success).toBe(true);
    expect(settings.schema.safeParse({ ...settings.defaults, hands: 101 }).success).toBe(false);
  });
});

describe('Poker: settings', () => {
  it('has no clocks to set: 25 s to act and 8 s of results, the old defaults, and old clock keys are dropped from a patch', () => {
    const { settings } = pokerModule;
    expect(POKER_ACT_SECONDS).toBe(25);
    expect(POKER_RESULTS_SECONDS).toBe(8);
    expect(Object.keys(settings.defaults).sort()).toEqual(['blindsIncreaseEvery', 'hands', 'smallBlind', 'startingChips']);
    const patch = settings.patchSchema.safeParse({ actSeconds: 9, resultsSeconds: 99, hands: 3 });
    expect(patch.success && patch.data).toEqual({ hands: 3 });
  });

  it('plays a room stored with short clocks on the fixed ones', () => {
    const s = sim('poker');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { actSeconds: 10, resultsSeconds: 4 });
    s.data = { ...s.data, settings: { ...s.data.settings, actSeconds: 10, resultsSeconds: 4 } };
    expect(data(s).phase).toEqual({ kind: 'acting', endsAt: START + 25_000 });
    act(s, alice, { t: 'call' });
    expect(data(s).phase).toEqual({ kind: 'acting', endsAt: s.now + 25_000 });
    act(s, bob, { t: 'fold' });
    expect(data(s).phase).toMatchObject({ kind: 'results', endsAt: s.now + settleRevealMs({ holeCards: 0, boardFrom: 0, boardTo: 0, contested: false }) + 8_000 });
  });
});

describe('Poker: heads-up', () => {
  it('has the dealer post the small blind and act first preflop, and the big blind act first after the flop', () => {
    const s = sim('poker');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    expect(data(s)).toMatchObject({ order: [alice, bob], dealerId: alice, toAct: [alice, bob], highest: 10 });
    expect(data(s).seats[alice]).toMatchObject({ chips: 995, bet: 5, lastAction: { kind: 'smallBlind', amount: 5 } });
    expect(data(s).seats[bob]).toMatchObject({ chips: 990, bet: 10, lastAction: { kind: 'bigBlind', amount: 10 } });
    expect(chatTexts(s.effects)).toContain('Hand 1 (blinds 5/10): Alice has the button, Alice posts 5, Bob posts 10.');
    expect(view(s, alice).actions).toMatchObject({ canCheck: false, canCall: true, callAmount: 5, canBet: false, canRaise: true, minRaiseTo: 20, maxRaiseTo: 1000 });
    expect(view(s, bob).actions.canFold).toBe(false);
    act(s, alice, { t: 'call' });
    expect(data(s).toAct).toEqual([bob]);
    // The big blind has the option: a check closes the street, nobody owes anything.
    expect(view(s, bob).actions).toMatchObject({ canCheck: true, canCall: false, callAmount: 0, canRaise: true, minRaiseTo: 20 });
    act(s, bob, { t: 'check' });
    expect(data(s)).toMatchObject({ street: 'flop', toAct: [bob, alice], highest: 0, minRaise: 10 });
    expect(data(s).community).toHaveLength(3);
    expect(view(s).pots).toEqual([{ amount: 20, playerIds: [alice, bob] }]);
    expect(view(s).pot).toBe(20);
    expect(view(s, bob).actions).toMatchObject({ canCheck: true, canBet: true, minBet: 10, maxBet: 990, canRaise: false });
    expect(data(s).seats[alice].lastAction).toBeNull();
  });
});

describe('Poker: betting', () => {
  it('refuses moves out of turn and moves that do not fit the street', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    expect(errorsOf(act(s, bob, { t: 'call' }))).toEqual(['It is not your turn.']);
    expect(errorsOf(act(s, alice, { t: 'check' }))).toEqual(['You cannot check: 10 to call.']);
    expect(errorsOf(act(s, alice, { t: 'bet', amount: 50 }))).toEqual(['There is a bet already: raise instead.']);
    expect(errorsOf(act(s, alice, { t: 'raise', to: 19 }))).toEqual(['Raise to between 20 and 1000 chips.']);
    expect(errorsOf(act(s, alice, { t: 'raise', to: 1001 }))).toEqual(['Raise to between 20 and 1000 chips.']);
    act(s, alice, { t: 'raise', to: 30 });
    expect(data(s)).toMatchObject({ highest: 30, minRaise: 20, toAct: [bob, carol] });
    expect(chatTexts(s.effects).at(-1)).toBe('Alice raises to 30.');
    expect(view(s, bob).actions).toMatchObject({ callAmount: 25, minRaiseTo: 50, maxRaiseTo: 1000 });
    act(s, bob, { t: 'call' });
    act(s, carol, { t: 'call' });
    expect(data(s)).toMatchObject({ street: 'flop', highest: 0, toAct: [bob, carol, alice] });
    expect(errorsOf(act(s, bob, { t: 'raise', to: 50 }))).toEqual(['There is no bet to raise: bet instead.']);
    expect(errorsOf(act(s, bob, { t: 'call' }))).toEqual(['There is nothing to call.']);
    expect(errorsOf(act(s, bob, { t: 'bet', amount: 9 }))).toEqual(['Bet between 10 and 970 chips.']);
    act(s, bob, { t: 'bet', amount: 40 });
    expect(data(s)).toMatchObject({ highest: 40, minRaise: 40, toAct: [carol, alice] });
  });

  it('closes a betting round once everyone still in has matched the highest bet, with the big blind option preflop', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    act(s, alice, { t: 'call' });
    act(s, bob, { t: 'call' });
    expect(data(s).street).toBe('preflop');
    expect(data(s).toAct).toEqual([carol]);
    // The big blind raises rather than checking: everyone has to answer again.
    act(s, carol, { t: 'raise', to: 40 });
    expect(data(s).toAct).toEqual([alice, bob]);
    act(s, alice, { t: 'fold' });
    expect(data(s).seats[alice].status).toBe('folded');
    act(s, bob, { t: 'call' });
    expect(data(s)).toMatchObject({ street: 'flop', toAct: [bob, carol] });
    expect(view(s).pots).toEqual([{ amount: 90, playerIds: [bob, carol] }]);
    for (const id of [bob, carol]) act(s, id, { t: 'check' });
    expect(data(s).street).toBe('turn');
    for (const id of [bob, carol]) act(s, id, { t: 'check' });
    expect(data(s).street).toBe('river');
    for (const id of [bob, carol]) act(s, id, { t: 'check' });
    expect(view(s).phase).toBe('results');
    expect(data(s).community).toHaveLength(5);
  });

  it('keeps the latest move in the view after the street that it closed, counting every move', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    act(s, alice, { t: 'call' });
    expect(view(s).lastMove).toEqual({ kind: 'call', amount: 10, seq: 3, playerId: alice, street: 'preflop' });
    act(s, bob, { t: 'call' });
    act(s, carol, { t: 'check' });
    // The check closed the preflop: every seat's last action is cleared for the flop, the table's latest move is not.
    expect(data(s).street).toBe('flop');
    expect(Object.values(view(s).players).every((p) => p.lastAction === null)).toBe(true);
    expect(view(s, bob).lastMove).toEqual({ kind: 'check', amount: 0, seq: 5, playerId: carol, street: 'preflop' });
    act(s, bob, { t: 'bet', amount: 20 });
    expect(view(s).lastMove).toMatchObject({ kind: 'bet', amount: 20, seq: 6, playerId: bob, street: 'flop' });
    // A room stored before the field existed shows no latest move until somebody moves.
    const game = structuredClone(data(s));
    delete game.lastMove;
    s.data = { ...s.data, game };
    expect(view(s).lastMove).toBeNull();
    act(s, carol, { t: 'call' });
    expect(view(s).lastMove).toMatchObject({ kind: 'call', seq: 1, playerId: carol });
  });

  it('sets the minimum raise to the last raise size and lets a raise go all in for less than it', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rigChips(s, { [alice]: 1000, [bob]: 995, [carol]: 60 });
    act(s, alice, { t: 'raise', to: 50 });
    expect(data(s).minRaise).toBe(40);
    expect(view(s, bob).actions).toMatchObject({ minRaiseTo: 90, maxRaiseTo: 1000 });
    act(s, bob, { t: 'raise', to: 150 });
    expect(data(s).minRaise).toBe(100);
    // Carol cannot cover a full raise: her all in is a short raise and leaves the minimum alone.
    expect(view(s, carol).actions).toMatchObject({ canRaise: false, callAmount: 60, canAllIn: true });
    expect(errorsOf(act(s, carol, { t: 'raise', to: 70 }))).toEqual(['You cannot raise: you can only call or fold.']);
    act(s, carol, { t: 'allIn' });
    expect(data(s).seats[carol]).toMatchObject({ chips: 0, bet: 70, status: 'allIn', lastAction: { kind: 'allIn', amount: 70 } });
    expect(chatTexts(s.effects).at(-1)).toBe('Carol calls all in for 70.');
    expect(data(s)).toMatchObject({ highest: 150, minRaise: 100, toAct: [alice] });
    expect(view(s, alice).actions).toMatchObject({ callAmount: 100, minRaiseTo: 250 });
    act(s, alice, { t: 'raise', to: 250 });
    expect(data(s).toAct).toEqual([bob]);
    expect(errorsOf(act(s, bob, { t: 'raise', to: 349 }))).toEqual(['Raise to between 350 and 1000 chips.']);
    act(s, bob, { t: 'call' });
    expect(data(s).street).toBe('flop');
    // Carol's 70 built the main pot; the rest is between Alice and Bob.
    expect(view(s).pots).toEqual([
      { amount: 210, playerIds: [alice, bob, carol] },
      { amount: 360, playerIds: [alice, bob] },
    ]);
    expect(totalChips(s)).toBe(2070);
  });

  it('re-queues the players who acted on a short all-in raise to call or fold only, without lowering the minimum raise', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rigChips(s, { [alice]: 1000, [bob]: 995, [carol]: 60 });
    act(s, alice, { t: 'raise', to: 50 });
    act(s, bob, { t: 'call' });
    // Carol's 70 tops the 50 by less than the 40 minimum: Alice and Bob must answer, but only by calling or folding.
    act(s, carol, { t: 'allIn' });
    expect(chatTexts(s.effects).at(-1)).toBe('Carol is all in for 70!');
    expect(data(s)).toMatchObject({ highest: 70, minRaise: 40, toAct: [alice, bob] });
    expect(view(s, alice).actions).toMatchObject({ canCall: true, callAmount: 20, canRaise: false, canAllIn: false, canFold: true });
    expect(errorsOf(act(s, alice, { t: 'raise', to: 110 }))).toEqual(['You cannot raise: you can only call or fold.']);
    expect(errorsOf(act(s, alice, { t: 'allIn' }))).toEqual(['You cannot raise: you can only call or fold.']);
    expect(data(s).highest).toBe(70);
    act(s, alice, { t: 'call' });
    act(s, bob, { t: 'call' });
    expect(data(s).street).toBe('flop');
    expect(view(s).pots).toEqual([{ amount: 210, playerIds: [alice, bob, carol] }]);
    // Carol is all in and the other two check it down: three streets, one pot, a showdown with three hands shown.
    for (let street = 0; street < 3; street++) for (const id of [bob, alice]) act(s, id, { t: 'check' });
    expect(view(s)).toMatchObject({ phase: 'results', results: { uncontested: false } });
    expect(Object.keys(view(s).results?.revealed ?? {})).toHaveLength(3);
    expect(totalChips(s)).toBe(2070);
  });

  it('lets nobody who already acted re-raise a short all in, as the bug report played it', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    // Carol, the big blind, has 120 in all.
    rigChips(s, { [carol]: 110 });
    act(s, alice, { t: 'raise', to: 100 });
    act(s, bob, { t: 'call' });
    act(s, carol, { t: 'allIn' });
    expect(data(s)).toMatchObject({ highest: 120, minRaise: 90, toAct: [alice, bob] });
    expect(view(s, alice).actions).toMatchObject({ canCall: true, callAmount: 20, canRaise: false, canAllIn: false });
    expect(errorsOf(act(s, alice, { t: 'raise', to: 300 }))).toEqual(['You cannot raise: you can only call or fold.']);
    expect(data(s).highest).toBe(120);
    act(s, alice, { t: 'call' });
    expect(view(s, bob).actions).toMatchObject({ canRaise: false, callAmount: 20 });
    act(s, bob, { t: 'call' });
    expect(data(s).street).toBe('flop');
  });

  it('keeps raising open for players yet to act after a short all in, and reopens it once short all-ins add up to a full raise', () => {
    const s = sim('poker');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    // Alice has the button, Bob 5 and Carol 10 posted, Dave acts first. Stacks in all: Alice 120, Bob 150, Carol 200.
    rigChips(s, { [alice]: 120, [bob]: 145, [carol]: 190 });
    expect(data(s).toAct).toEqual([dave, alice, bob, carol]);
    act(s, dave, { t: 'raise', to: 100 });
    act(s, alice, { t: 'allIn' });
    expect(data(s)).toMatchObject({ highest: 120, minRaise: 90, toAct: [bob, carol, dave] });
    // Bob only posted a blind: he has not acted, so he may still raise.
    expect(view(s, bob).actions).toMatchObject({ canRaise: true, minRaiseTo: 150, maxRaiseTo: 150, canAllIn: true });
    act(s, bob, { t: 'allIn' });
    expect(view(s, carol).actions).toMatchObject({ canRaise: true, minRaiseTo: 200, maxRaiseTo: 200 });
    act(s, carol, { t: 'allIn' });
    // 100 → 200 is a full raise over Dave's 100 in all, though no single all in was one.
    expect(data(s)).toMatchObject({ highest: 200, minRaise: 90, toAct: [dave] });
    expect(view(s, dave).actions).toMatchObject({ canRaise: true, minRaiseTo: 290, callAmount: 100 });
  });

  it('lets the others call the full big blind when the big blind is all in for less', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    act(s, alice, { t: 'fold' });
    act(s, bob, { t: 'fold' });
    rigChips(s, { [alice]: 3 });
    tickResults(s);
    // Hand 2: Bob has the button, Carol posts 5, Alice is all in for a 3-chip big blind.
    expect(data(s)).toMatchObject({ hand: 2, dealerId: bob, highest: 10, minRaise: 10, toAct: [bob, carol] });
    expect(data(s).seats[alice]).toMatchObject({ bet: 3, status: 'allIn', lastAction: { kind: 'bigBlind', amount: 3 } });
    expect(view(s, bob).actions).toMatchObject({ callAmount: 10, minRaiseTo: 20 });
    act(s, bob, { t: 'call' });
    expect(view(s, carol).actions).toMatchObject({ callAmount: 5, canCheck: false });
    act(s, carol, { t: 'call' });
    expect(data(s).street).toBe('flop');
    expect(view(s).pots).toEqual([
      { amount: 9, playerIds: [alice, bob, carol] },
      { amount: 14, playerIds: [bob, carol] },
    ]);
  });

  it('keeps the full big blind to call when the small blind is all in for less', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    act(s, alice, { t: 'fold' });
    act(s, bob, { t: 'fold' });
    rigChips(s, { [carol]: 3 });
    tickResults(s);
    // Hand 2: Bob has the button, Carol is all in for a 3-chip small blind, Alice posts 10.
    expect(data(s)).toMatchObject({ hand: 2, highest: 10, toAct: [bob, alice] });
    expect(view(s, bob).actions).toMatchObject({ callAmount: 10, minRaiseTo: 20 });
    act(s, bob, { t: 'call' });
    expect(view(s, alice).actions).toMatchObject({ canCheck: true });
    act(s, alice, { t: 'check' });
    expect(data(s).street).toBe('flop');
    expect(view(s).pots).toEqual([
      { amount: 9, playerIds: [alice, bob, carol] },
      { amount: 14, playerIds: [alice, bob] },
    ]);
  });

  it('closes the street without a pointless turn when the one player left able to act already matches the bet', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rigHand(s, { [alice]: ['AS', 'AD'], [bob]: ['KS', 'KD'], [carol]: ['QS', 'QD'] }, BOARD_DRY);
    rigChips(s, { [alice]: 7 });
    act(s, alice, { t: 'call' });
    expect(data(s).seats[alice].status).toBe('allIn');
    act(s, bob, { t: 'fold' });
    // Carol's 10 covers Alice's 7: nobody is left to bet against, so the board runs out and her 3 extra come back.
    expect(view(s)).toMatchObject({ phase: 'results', street: 'river', turn: null });
    expect(data(s).community).toHaveLength(5);
    expect(view(s).results?.pots).toEqual([{ amount: 19, winners: [{ playerId: alice, amount: 19 }], handName: 'Pair of aces' }]);
    expect(chips(s, carol)).toBe(993);
  });

  it('makes a short call an all in, refunds the uncalled part of a bet and runs the board out when nobody can act', () => {
    const s = sim('poker');
    const [alice, bob] = startGame(s, ['Alice', 'Bob']);
    rigHand(s, { [alice]: ['AS', 'AD'], [bob]: ['KS', 'KD'] }, BOARD_DRY);
    rigChips(s, { [alice]: 995, [bob]: 90 });
    act(s, alice, { t: 'raise', to: 500 });
    expect(chatTexts(s.effects).at(-1)).toBe('Alice raises to 500.');
    expect(view(s, bob).actions).toMatchObject({ canCall: true, callAmount: 90, canRaise: false });
    const effects = act(s, bob, { t: 'call' });
    expect(chatTexts(effects)).toEqual(['Bob calls all in for 100.', 'Alice wins the pot (200) with pair of aces.', 'Bob is out of chips.']);
    // 400 of Alice's raise went uncalled and came straight back; the board was run out at once.
    expect(view(s)).toMatchObject({ phase: 'results', street: 'river' });
    expect(data(s).community).toHaveLength(5);
    expect(chips(s, alice)).toBe(1100);
    expect(chips(s, bob)).toBe(0);
    expect(view(s).results).toEqual({
      pots: [{ amount: 200, winners: [{ playerId: alice, amount: 200 }], handName: 'Pair of aces' }],
      revealed: {
        [alice]: { cards: [cardOf('AS'), cardOf('AD')], category: 'pair', name: 'Pair of aces', best: [cardOf('AS'), cardOf('AD'), cardOf('JC'), cardOf('9H'), cardOf('7D')] },
        [bob]: { cards: [cardOf('KS'), cardOf('KD')], category: 'pair', name: 'Pair of kings', best: [cardOf('KS'), cardOf('KD'), cardOf('JC'), cardOf('9H'), cardOf('7D')] },
      },
      uncontested: false,
      net: { [alice]: 100, [bob]: -100 },
    });
    expect(view(s).players[bob]).toMatchObject({ busted: true, status: 'allIn' });
    expect(chatTexts(s.effects)).toContain('Bob is out of chips.');
    // The run-out (the whole board, the flip, the pot) plays on the clients before the results pause counts.
    const reveal = settleRevealMs({ holeCards: 0, boardFrom: 0, boardTo: 5, contested: true });
    expect(reveal).toBeGreaterThan(4000);
    expect(nextDeadline(s.data)).toBe(s.now + reveal + RESULTS_MS);
  });

  it('allows for a hand dealt and settled in one snapshot: the hole cards come out first', () => {
    const fresh = settleRevealMs({ holeCards: 4, boardFrom: 0, boardTo: 5, contested: true });
    expect(fresh - settleRevealMs({ holeCards: 0, boardFrom: 0, boardTo: 5, contested: true })).toBe(300 + 3 * 150 + 250);
    expect(settleRevealMs({ holeCards: 0, boardFrom: 5, boardTo: 5, contested: true })).toBeLessThan(settleRevealMs({ holeCards: 0, boardFrom: 3, boardTo: 5, contested: true }));
  });

  it('bets and raises with the whole stack through allIn, and treats a bet of the whole stack as all in', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    act(s, alice, { t: 'allIn' });
    expect(data(s).seats[alice]).toMatchObject({ chips: 0, bet: 1000, status: 'allIn', lastAction: { kind: 'allIn', amount: 1000 } });
    expect(chatTexts(s.effects).at(-1)).toBe('Alice is all in for 1000!');
    expect(data(s)).toMatchObject({ highest: 1000, minRaise: 990, toAct: [bob, carol] });
    act(s, bob, { t: 'fold' });
    act(s, carol, { t: 'fold' });
    // Her uncalled 990 came back; the pot is the blinds plus the 10 she matched.
    expect(view(s)).toMatchObject({ phase: 'results', results: { uncontested: true, revealed: {}, pots: [{ amount: 25, winners: [{ playerId: alice, amount: 25 }], handName: null }] } });
    expect(chips(s, alice)).toBe(1015);
    expect(data(s).seats[alice].status).toBe('in');
    expect(chatTexts(s.effects).at(-1)).toBe('Alice takes the pot (25).');
  });
});

describe('Poker: timeouts', () => {
  it('checks for a player whose clock ran out when a check is free, folds them otherwise', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    act(s, alice, { t: 'call' });
    act(s, bob, { t: 'call' });
    expect(nextDeadline(s.data)).toBe(s.now + ACT_MS);
    const checked = tick(s, ACT_MS);
    expect(chatTexts(checked)).toEqual(['Carol ran out of time and checks.']);
    expect(noticeTexts(checked)).toEqual(['Carol ran out of time and checks.']);
    expect(data(s)).toMatchObject({ street: 'flop', toAct: [bob, carol, alice] });
    act(s, bob, { t: 'bet', amount: 20 });
    const folded = tick(s, ACT_MS);
    expect(chatTexts(folded)).toEqual(['Carol ran out of time and folds.']);
    expect(data(s).seats[carol].status).toBe('folded');
    expect(data(s).toAct).toEqual([alice]);
    expect(nextDeadline(s.data)).toBe(s.now + ACT_MS);
    const won = tick(s, ACT_MS);
    expect(chatTexts(won)).toEqual(['Alice ran out of time and folds.', 'Bob takes the pot (30).']);
    expect(chips(s, bob)).toBe(1020);
    // The pause starts once the clients have swept the bets and paid the pot.
    expect(nextDeadline(s.data)).toBe(s.now + settleRevealMs({ holeCards: 0, boardFrom: 3, boardTo: 3, contested: false }) + RESULTS_MS);
  });

  it('ends a game nobody plays after three idle hands', () => {
    const s = sim('poker');
    startGame(s, ['Alice', 'Bob'], { hands: 0 });
    for (let hand = 1; hand <= 3; hand++) {
      expect(view(s)).toMatchObject({ phase: 'acting', hand });
      tick(s, ACT_MS);
      expect(view(s).phase).toBe('results');
      expect(data(s).idleHands).toBe(hand);
      tickResults(s);
    }
    expect(s.data.phase).toBe('lobby');
    expect(s.data.results?.reason).toBe('finished');
    expect(chatTexts(s.effects)).toContain('Nobody played for 3 hands. The game is over.');
  });

  it('counts a hand with a real move as played', () => {
    const s = sim('poker');
    const [alice] = startGame(s, ['Alice', 'Bob'], { hands: 0 });
    tick(s, ACT_MS);
    tickResults(s);
    expect(data(s).idleHands).toBe(1);
    expect(data(s).toAct[0]).not.toBe(alice);
    act(s, data(s).toAct[0], { t: 'fold' });
    expect(data(s).idleHands).toBe(0);
  });
});

describe('Poker: the showdown', () => {
  it('shows every contender, names the hands, pays the best and hides folded cards', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rigHand(s, { [alice]: ['2H', '3H'], [bob]: ['KS', 'KD'], [carol]: ['5S', '5D'] }, ['5H', '7D', '9H', 'JC', '4S']);
    act(s, alice, { t: 'fold' });
    act(s, bob, { t: 'call' });
    act(s, carol, { t: 'check' });
    for (let street = 0; street < 3; street++) for (const id of [bob, carol]) act(s, id, { t: 'check' });
    const results = view(s).results;
    expect(results).toMatchObject({ uncontested: false, pots: [{ amount: 20, winners: [{ playerId: carol, amount: 20 }], handName: 'Three of a kind, fives' }], net: { [alice]: 0, [bob]: -10, [carol]: 10 } });
    expect(Object.keys(results?.revealed ?? {}).sort()).toEqual([bob, carol].sort());
    expect(results?.revealed[bob].name).toBe('Pair of kings');
    expect(chatTexts(s.effects).at(-1)).toBe('Carol wins the pot (20) with three of a kind, fives.');
    expect([chips(s, alice), chips(s, bob), chips(s, carol)]).toEqual([1000, 990, 1010]);
    expect(view(s, alice).results?.revealed[alice]).toBeUndefined();
  });

  it('splits a pot between equal hands and gives the odd chip to the first winner left of the dealer', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    // Everyone plays the board: a straight on it, nobody improves.
    rigHand(s, { [alice]: ['2H', '3H'], [bob]: ['2D', '3D'], [carol]: ['2C', '3C'] }, ['5S', '6D', '7H', '8C', '9S']);
    act(s, alice, { t: 'raise', to: 25 });
    act(s, bob, { t: 'call' });
    act(s, carol, { t: 'call' });
    for (let street = 0; street < 3; street++) for (const id of [bob, carol, alice]) act(s, id, { t: 'check' });
    expect(view(s).results?.pots).toEqual([{ amount: 75, winners: [{ playerId: bob, amount: 25 }, { playerId: carol, amount: 25 }, { playerId: alice, amount: 25 }], handName: 'Straight, nine high' }]);
    expect(chatTexts(s.effects).at(-1)).toBe('Bob and Carol and Alice split the pot (75) with straight, nine high.');
    expect([alice, bob, carol].map((id) => chips(s, id))).toEqual([1000, 1000, 1000]);
    // The same board with Alice out: 50 chips between Bob and Carol... make it odd with a bet nobody matches evenly.
    expect(splitPot(75, [bob, carol])).toEqual([{ playerId: bob, amount: 38 }, { playerId: carol, amount: 37 }]);
    expect(splitPot(7, [alice, bob, carol])).toEqual([{ playerId: alice, amount: 3 }, { playerId: bob, amount: 2 }, { playerId: carol, amount: 2 }]);
  });

  it('builds side pots from three all-ins of different sizes and pays each to the best hand eligible for it', () => {
    const s = sim('poker');
    const [alice, bob, carol, dave] = startGame(s, ['Alice', 'Bob', 'Carol', 'Dave']);
    // Alice has the button, Bob the small blind, Carol the big blind; Dave acts first.
    expect(data(s).toAct).toEqual([dave, alice, bob, carol]);
    rigChips(s, { [alice]: 100, [bob]: 295, [carol]: 490, [dave]: 1000 });
    rigHand(s, { [alice]: ['AS', 'AD'], [bob]: ['KS', 'KD'], [carol]: ['QS', 'QD'], [dave]: ['3S', '5D'] }, BOARD_DRY);
    act(s, dave, { t: 'allIn' });
    expect(data(s)).toMatchObject({ highest: 1000, toAct: [alice, bob, carol] });
    act(s, alice, { t: 'allIn' });
    expect(data(s).seats[alice]).toMatchObject({ chips: 0, bet: 100, status: 'allIn' });
    act(s, bob, { t: 'allIn' });
    expect(data(s).seats[bob]).toMatchObject({ chips: 0, bet: 300, status: 'allIn' });
    const effects = act(s, carol, { t: 'allIn' });
    // Her call closed the betting: the board ran out and the pots were paid in the same move.
    expect(data(s).seats[carol]).toMatchObject({ bet: 0, committed: 0, status: 'allIn' });
    expect(view(s)).toMatchObject({ phase: 'results', street: 'river' });
    expect(chatTexts(effects)).toEqual([
      'Carol calls all in for 500.',
      'Alice wins the main pot (400) with pair of aces.',
      'Bob wins side pot 1 (600) with pair of kings.',
      'Carol wins side pot 2 (400) with pair of queens.',
    ]);
    expect(view(s).results?.pots).toEqual([
      { amount: 400, winners: [{ playerId: alice, amount: 400 }], handName: 'Pair of aces' },
      { amount: 600, winners: [{ playerId: bob, amount: 600 }], handName: 'Pair of kings' },
      { amount: 400, winners: [{ playerId: carol, amount: 400 }], handName: 'Pair of queens' },
    ]);
    // Dave's uncalled 500 came back before the showdown.
    expect([alice, bob, carol, dave].map((id) => chips(s, id))).toEqual([400, 600, 400, 500]);
    expect(view(s).results?.net).toEqual({ [alice]: 300, [bob]: 300, [carol]: -100, [dave]: -500 });
    expect(totalChips(s)).toBe(1900);
    expect(view(s).results?.revealed[dave].name).toBe('Jack high');
  });

  it('hands the whole pot, side pots included, to the one player left when everyone else folds', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    rigChips(s, { [alice]: 50, [bob]: 995, [carol]: 990 });
    act(s, alice, { t: 'allIn' });
    act(s, bob, { t: 'raise', to: 200 });
    act(s, carol, { t: 'call' });
    expect(data(s)).toMatchObject({ street: 'flop', toAct: [bob, carol] });
    expect(view(s).pots).toEqual([
      { amount: 150, playerIds: [alice, bob, carol] },
      { amount: 300, playerIds: [bob, carol] },
    ]);
    act(s, bob, { t: 'bet', amount: 100 });
    act(s, carol, { t: 'fold' });
    // Bob and Alice are still in: the board runs out for the main pot, the side pot is Bob's alone.
    expect(view(s).phase).toBe('results');
    expect(view(s).results?.uncontested).toBe(false);
    expect(view(s).results?.pots[1]).toMatchObject({ amount: 300, winners: [{ playerId: bob, amount: 300 }] });
    expect(totalChips(s)).toBe(2050);
    expect(chips(s, carol)).toBe(800);
    expect(chatTexts(s.effects).at(-1)).toMatch(/^Bob wins side pot 1 \(300\) with /);
  });
});

describe('Poker: pots', () => {
  it('layers side pots by the amounts contenders committed and lets folded chips feed every pot', () => {
    expect(buildPots([
      { id: 'a', committed: 100, contender: true },
      { id: 'b', committed: 300, contender: true },
      { id: 'c', committed: 300, contender: true },
      { id: 'd', committed: 50, contender: false },
    ])).toEqual([
      { amount: 350, eligible: ['a', 'b', 'c'] },
      { amount: 400, eligible: ['b', 'c'] },
    ]);
    // Chips a folded player put in above every contender land in the last pot rather than vanishing.
    expect(buildPots([
      { id: 'a', committed: 100, contender: true },
      { id: 'b', committed: 100, contender: true },
      { id: 'c', committed: 150, contender: false },
    ])).toEqual([{ amount: 350, eligible: ['a', 'b'] }]);
    expect(buildPots([{ id: 'a', committed: 0, contender: true }])).toEqual([]);
  });
});

describe('Poker: hands and the game', () => {
  it('moves the button, rotates the blinds and skips a busted dealer', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    act(s, alice, { t: 'fold' });
    act(s, bob, { t: 'fold' });
    tickResults(s);
    expect(data(s)).toMatchObject({ hand: 2, dealerId: bob, dealerOrder: 1, order: [alice, bob, carol], toAct: [bob, carol, alice] });
    expect(data(s).seats[carol].lastAction).toEqual({ kind: 'smallBlind', amount: 5 });
    expect(data(s).seats[alice].lastAction).toEqual({ kind: 'bigBlind', amount: 10 });
    // Bob loses everything to Alice this hand; the button then skips him.
    rigHand(s, { [alice]: ['AS', 'AD'], [bob]: ['KS', 'KD'], [carol]: ['2H', '3H'] }, BOARD_DRY);
    act(s, bob, { t: 'allIn' });
    act(s, carol, { t: 'fold' });
    act(s, alice, { t: 'call' });
    expect(chips(s, bob)).toBe(0);
    expect(view(s).players[bob]).toMatchObject({ busted: true });
    tickResults(s);
    expect(data(s)).toMatchObject({ hand: 3, dealerId: carol, order: [alice, carol] });
    expect(view(s).players[bob]).toMatchObject({ status: 'out', busted: true, chips: 0 });
    expect(data(s).seats[bob].cards).toEqual([]);
    // Heads-up now: Carol, the dealer, posts the small blind and acts first.
    expect(data(s).toAct).toEqual([carol, alice]);
    expect(data(s).seats[carol].lastAction).toEqual({ kind: 'smallBlind', amount: 5 });
  });

  it('doubles the blinds every N hands, posting them all in when a stack is short', () => {
    const s = sim('poker');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { hands: 0, blindsIncreaseEvery: 2 });
    expect(view(s).blinds).toEqual({ small: 5, big: 10 });
    for (let hand = 1; hand <= 2; hand++) {
      act(s, data(s).toAct[0], { t: 'fold' });
      tickResults(s);
    }
    expect(view(s)).toMatchObject({ hand: 3, blinds: { small: 10, big: 20 } });
    expect(chatTexts(s.effects)).toContain('Blinds up: 10/20.');
    expect(data(s).minRaise).toBe(20);
    act(s, data(s).toAct[0], { t: 'fold' });
    tickResults(s);
    act(s, data(s).toAct[0], { t: 'fold' });
    tickResults(s);
    expect(view(s)).toMatchObject({ hand: 5, blinds: { small: 20, big: 40 } });
    // A short stack posts what it has and is all in from the blind.
    act(s, data(s).toAct[0], { t: 'fold' });
    rigChips(s, { [alice]: 7, [bob]: 1000 });
    tickResults(s);
    // Alice is all in from the big blind, so there is nothing to bet: the board runs out at once and the pot is twice her 7.
    expect(data(s).seats[alice].lastAction).toEqual({ kind: 'bigBlind', amount: 7 });
    expect(view(s)).toMatchObject({ phase: 'results', hand: 6 });
    expect(view(s).results?.pots).toEqual([expect.objectContaining({ amount: 14 })]);
    expect(totalChips(s)).toBe(1007);
  });

  it('ends after the hands cap with the results ranked by chips', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 2 });
    act(s, alice, { t: 'fold' });
    act(s, bob, { t: 'fold' });
    tickResults(s);
    expect(view(s)).toMatchObject({ hand: 2, totalHands: 2 });
    act(s, bob, { t: 'fold' });
    act(s, carol, { t: 'fold' });
    expect(chips(s, alice)).toBe(1005);
    const over = tickResults(s);
    expect(s.data.phase).toBe('lobby');
    expect(chatTexts(over)).toEqual(['Game over! Alice wins with 1005 points.']);
    expect(standings(s)).toEqual([
      { playerId: alice, score: 1005, rank: 1 },
      { playerId: carol, score: 1000, rank: 2 },
      { playerId: bob, score: 995, rank: 3 },
    ]);
    expect(s.data.game).toBeNull();
    expect(nextDeadline(s.data)).toBeNull();
  });

  it('ends once one player holds every chip, with the busted players ranked below', () => {
    const s = sim('poker');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { hands: 0 });
    rigHand(s, { [alice]: ['AS', 'AD'], [bob]: ['KS', 'KD'] }, BOARD_DRY);
    act(s, alice, { t: 'allIn' });
    act(s, bob, { t: 'call' });
    expect([chips(s, alice), chips(s, bob)]).toEqual([2000, 0]);
    const over = tickResults(s);
    expect(chatTexts(over)).toEqual(['Alice has all the chips!', 'Game over! Alice wins with 2000 points.']);
    expect(standings(s)).toEqual([
      { playerId: alice, score: 2000, rank: 1 },
      { playerId: bob, score: 0, rank: 2 },
    ]);
  });

  it('lets the host skip the results and end the game, voiding a hand in progress', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    expect(errorsOf(act(s, alice, { t: 'next' }))).toEqual(['There is no result to skip.']);
    act(s, alice, { t: 'fold' });
    act(s, bob, { t: 'fold' });
    expect(view(s).phase).toBe('results');
    expect(errorsOf(act(s, bob, { t: 'next' }))).toEqual(['Only the host can skip ahead.']);
    act(s, alice, { t: 'next' });
    expect(view(s)).toMatchObject({ phase: 'acting', hand: 2 });
    act(s, bob, { t: 'raise', to: 100 });
    act(s, carol, { t: 'call' });
    expect(errorsOf(endGame(s, bob))).toEqual(['Only the host can do that.']);
    expect(view(s).phase).toBe('acting');
    const ended = endGame(s, alice);
    expect(chatTexts(ended)).toEqual(['Alice ended the game. The hand is void and every stake goes back.', 'Game over! Carol wins with 1005 points.']);
    expect(standings(s)).toEqual([
      { playerId: carol, score: 1005, rank: 1 },
      { playerId: alice, score: 1000, rank: 2 },
      { playerId: bob, score: 995, rank: 3 },
    ]);
    expect(s.data.phase).toBe('lobby');
    expect(s.data.results?.reason).toBe('host');
  });

  it('lets a sitting-out host skip the results and end the game', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    s.apply({ type: 'leave', playerId: alice });
    // Bob is host now and plays.
    expect(s.data.hostId).toBe(bob);
    act(s, bob, { t: 'fold' });
    expect(view(s).phase).toBe('results');
    expect(chips(s, carol)).toBe(1005);
    endGame(s, bob);
    expect(s.data.phase).toBe('lobby');
  });
});

describe('Poker: seats coming and going', () => {
  it('lets a mid-game joiner watch the whole game: no seat, no stack, no cards, hand after hand', () => {
    const s = sim('poker');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { hands: 0 });
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expect(view(s).players[carol]).toBeUndefined();
    expect(errorsOf(act(s, carol, { t: 'call' }))).toEqual(['You are watching this game.']);
    act(s, alice, { t: 'fold' });
    tickResults(s);
    expect(data(s)).toMatchObject({ hand: 2, order: [alice, bob], dealerId: bob });
    expect(data(s).seats[carol]).toBeUndefined();
    expect(score(s, carol)).toBe(0);
    expect(view(s, carol).myCards).toEqual([]);
  });

  it('folds a player who leaves mid-hand, leaves their chips in the pot and moves the action on', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    act(s, alice, { t: 'raise', to: 100 });
    act(s, bob, { t: 'call' });
    // Carol leaves on her turn: she is folded, her blind stays, and the flop is dealt between Alice and Bob.
    s.apply({ type: 'leave', playerId: carol });
    expectScoresMatchChips(s);
    expect(s.data.phase).toBe('playing');
    expect(data(s).seats[carol]).toMatchObject({ status: 'folded', gone: true, committed: 10, bet: 0 });
    expect(data(s)).toMatchObject({ street: 'flop', toAct: [bob, alice] });
    expect(view(s).pot).toBe(210);
    expect(view(s).players[carol]).toBeUndefined();
    act(s, bob, { t: 'fold' });
    expect(chips(s, alice)).toBe(1110);
    // At the next hand the seat is gone for good.
    tickResults(s);
    expect(data(s).seats[carol]).toBeUndefined();
    expect(data(s).order).toEqual([alice, bob]);
  });

  it('lets a player leave during the results and deals the next hand without them', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    act(s, alice, { t: 'fold' });
    act(s, bob, { t: 'fold' });
    expect(view(s).phase).toBe('results');
    s.apply({ type: 'leave', playerId: carol });
    expect(data(s).seats[carol]).toBeUndefined();
    expect(data(s).order).toEqual([alice, bob]);
    expect(view(s)).toMatchObject({ phase: 'results', pot: 0, pots: [] });
    tickResults(s);
    expect(view(s)).toMatchObject({ phase: 'acting', hand: 2, order: [alice, bob] });
  });

  it('ends the game after a last hand somebody left in the middle of', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 1 });
    s.apply({ type: 'leave', playerId: carol });
    act(s, alice, { t: 'fold' });
    expect(view(s).phase).toBe('results');
    tickResults(s);
    expect(s.data.phase).toBe('lobby');
    expect(standings(s)?.map((p) => p.playerId)).toEqual([bob, alice]);
  });

  it('aborts rather than crowning anyone when a player walks off with their chips and leaves one stack', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    rigHand(s, { [alice]: ['2H', '3D'], [bob]: ['AS', 'AD'], [carol]: ['7C', '8C'] }, BOARD_DRY);
    act(s, alice, { t: 'allIn' });
    act(s, bob, { t: 'call' });
    act(s, carol, { t: 'fold' });
    expect(chips(s, alice)).toBe(0);
    tickResults(s);
    expect(data(s)).toMatchObject({ hand: 2, order: [bob, carol] });
    // Bob leaves mid-hand with his stack: Carol takes the pot, but she does not have all the chips.
    s.apply({ type: 'leave', playerId: bob });
    expect(view(s).phase).toBe('results');
    s.advance(resultsLeft(s));
    const ended = s.tick();
    expect(s.data.phase).toBe('lobby');
    expect(chatTexts(ended)).toContain('Not enough players with chips to go on.');
    // The standings show where it stopped, but nobody is crowned.
    expect(s.data.results?.reason).toBe('players');
    expect(chatTexts(s.effects).join('\n')).not.toMatch(/has all the chips|wins with/);
  });

  it('aborts a held boundary when a player with chips leaves it', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    rigHand(s, { [alice]: ['2H', '3D'], [bob]: ['AS', 'AD'], [carol]: ['7C', '8C'] }, BOARD_DRY);
    act(s, alice, { t: 'allIn' });
    act(s, bob, { t: 'call' });
    act(s, carol, { t: 'fold' });
    tickResults(s);
    act(s, data(s).toAct[0], { t: 'fold' });
    disconnect(s, carol, 'Carol');
    tickResults(s);
    expect(view(s).paused).toBe(true);
    s.apply({ type: 'leave', playerId: carol });
    expect(s.data.phase).toBe('lobby');
    expect(chatTexts(s.effects)).toContain('Not enough players with chips to go on.');
  });

  it('hands the pot to the last player left when the others leave, and aborts when a seat loss drops below two', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    s.apply({ type: 'leave', playerId: bob });
    expect(data(s)).toMatchObject({ toAct: [alice, carol] });
    s.apply({ type: 'leave', playerId: alice });
    expect(s.data.phase).toBe('lobby');
    expect(chatTexts(s.effects).slice(-2)).toEqual(['Not enough players to go on.', 'Game over!']);
    expect(standings(s)?.map((p) => p.playerId)).toEqual([carol]);
  });

  it('plays a disconnected player by the clock mid-hand and holds the next hand until they are back', () => {
    const s = sim('poker');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { hands: 0 });
    disconnect(s, bob, 'Bob');
    act(s, alice, { t: 'call' });
    expect(view(s)).toMatchObject({ phase: 'acting', turn: bob, paused: false });
    const checked = tick(s, ACT_MS);
    expect(chatTexts(checked)).toEqual(['Bob ran out of time and checks.']);
    expect(data(s).street).toBe('flop');
    tick(s, ACT_MS);
    act(s, alice, { t: 'bet', amount: 20 });
    const won = tick(s, ACT_MS);
    expect(chatTexts(won)).toEqual(['Bob ran out of time and folds.', 'Alice takes the pot (20).']);
    const held = tickResults(s);
    expect(chatTexts(held)).toEqual(['Waiting for Bob to reconnect…']);
    expect(view(s)).toMatchObject({ phase: 'results', hand: 1, paused: true, endsAt: null });
    expect(waiting(s)).toEqual([bob]);
    expect(nextDeadline(s.data)).toBeGreaterThan(s.now + 60_000); // only the seat expiry
    reconnect(s, bob, 'Bob');
    expect(data(s).phase).toMatchObject({ kind: 'results', held: true, resumeAt: s.now + RESUME_SETTLE_MS });
    const resumed = tick(s, RESUME_SETTLE_MS);
    expect(chatTexts(resumed)).toEqual(['Hand 2 (blinds 5/10): Bob has the button, Bob posts 5, Alice posts 10.']);
    expect(view(s)).toMatchObject({ phase: 'acting', hand: 2, paused: false });
    expect(waiting(s)).toBeNull();
  });

  it('holds while only one stacked player is connected, whoever else is seated', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    act(s, alice, { t: 'fold' });
    act(s, bob, { t: 'fold' });
    disconnect(s, bob, 'Bob');
    disconnect(s, carol, 'Carol');
    tickResults(s);
    expect(view(s).paused).toBe(true);
    expect(waiting(s)).toEqual([bob, carol]);
    reconnect(s, carol, 'Carol');
    tick(s, RESUME_SETTLE_MS);
    // Two connected: the hand starts; Bob is dealt in and plays by the clock.
    expect(view(s)).toMatchObject({ phase: 'acting', hand: 2, order: [alice, bob, carol] });
  });
});

describe('Poker: purity', () => {
  it('returns the very same object when nothing changed and never shares objects with the view', () => {
    const s = sim('poker');
    const [alice] = startGame(s, ['Alice', 'Bob']);
    const game = data(s);
    const ctx = { now: s.now, rng: () => 0, newId: () => 'x', settings: s.data.settings as typeof pokerModule.settings.defaults & ReturnType<typeof defaultPlatformSettings>, players: s.data.players.map((p) => ({ id: p.id, name: p.name, joinOrder: p.joinOrder, connected: true, score: p.score })), spectators: [], hostId: alice };
    expect(pokerModule.handle(ctx, game, { type: 'tick' }).data).toBe(game);
    expect(pokerModule.handle(ctx, game, { type: 'chat', playerId: alice, text: 'hi' }).data).toBe(game);
    expect(pokerModule.handle(ctx, game, { type: 'message', playerId: alice, msg: { t: 'next' } }).data).toBe(game);
    const moved = pokerModule.handle(ctx, game, { type: 'message', playerId: alice, msg: { t: 'call' } });
    expect(moved.data).not.toBe(game);
    expect(game.toAct[0]).toBe(alice);
    const v = pokerModule.view(game, alice, ctx);
    expect(v.myCards).toEqual(game.seats[alice].cards);
    expect(v.myCards).not.toBe(game.seats[alice].cards);
    expect(v.community).not.toBe(game.community);
    expect(gameById('poker').minPlayers).toBe(2);
  });
});

describe('Poker: a second tap', () => {
  /** What the player's screen aims a move at: the hand and the latest move on the table. */
  const aim = (s: Sim) => ({ hand: view(s).hand, move: view(s).lastMove?.seq ?? 0 });

  it('never plays a second move: a tap aimed at a turn that is over is ignored without a word', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const tap = aim(s);
    act(s, alice, { t: 'call', ...tap });
    expect(data(s).toAct[0]).toBe(bob);
    const again = act(s, alice, { t: 'call', ...tap });
    expect(again).toEqual([]);
    expect(chips(s, alice)).toBe(990);
    // Bob's double tap of Call: the second one would have been Carol's turn's move had it gone through.
    const bobs = aim(s);
    act(s, bob, { t: 'call', ...bobs });
    expect(act(s, bob, { t: 'call', ...bobs })).toEqual([]);
    expect(data(s).toAct[0]).toBe(carol);
    // A move without an aim (an older phone) is still refused out loud.
    expect(errorsOf(act(s, bob, { t: 'call' }))).toEqual(['It is not your turn.']);
  });

  it('ignores a tap the clock beat to it', () => {
    const s = sim('poker');
    const [alice, bob] = startGame(s, ['Alice', 'Bob', 'Carol']);
    const tap = aim(s);
    tick(s, ACT_MS);
    expect(data(s).seats[alice].status).toBe('folded');
    expect(data(s).toAct[0]).toBe(bob);
    expect(act(s, alice, { t: 'call', ...tap })).toEqual([]);
    expect(data(s).seats[alice].status).toBe('folded');
  });

  it('deals one next hand on a double tap of the host\'s Next', () => {
    const s = sim('poker');
    const [alice, bob, carol] = startGame(s, ['Alice', 'Bob', 'Carol'], { hands: 0 });
    act(s, alice, { t: 'fold' });
    act(s, bob, { t: 'fold' });
    expect(view(s).phase).toBe('results');
    const hand = view(s).hand;
    act(s, alice, { t: 'next', hand });
    expect(view(s)).toMatchObject({ phase: 'acting', hand: hand + 1 });
    expect(act(s, alice, { t: 'next', hand })).toEqual([]);
    expect(view(s).hand).toBe(hand + 1);
    expect(data(s).seats[carol]).toBeDefined();
  });
});
