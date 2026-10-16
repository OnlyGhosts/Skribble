/** Poker at a big party: 23 seats (one deck: 46 hole cards and a 5-card board), the extras ready at the start waiting for a free seat, and a full table played to a showdown with side pots. */
import { describe, expect, it } from 'vitest';
import type { PokerView } from '../../../shared/games/poker/protocol.js';
import { cardOf } from '../../../shared/platform/cards.js';
import { gameById } from '../../../shared/platform/games.js';
import { viewFor } from '../../platform/engine/view.js';
import { AVATAR, errorsOf, sim, startGame, type Sim } from '../../platform/engine/testHarness.js';
import type { PokerData } from './module.js';
import { TABLE_SEATS } from './state.js';

const data = (s: Sim): PokerData => s.data.game as PokerData;
const view = (s: Sim, viewer: string | null = null): PokerView => {
  const game = viewFor(s.data, viewer, s.now).game;
  if (!game) throw new Error('no game');
  return game as PokerView;
};
const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `P${i}`);
const totalChips = (s: Sim): number => Object.values(data(s).seats).reduce((sum, seat) => sum + seat.chips + seat.bet + seat.committed, 0);
const act = (s: Sim, id: string, msg: unknown): void => {
  expect(errorsOf(s.game(id, msg))).toEqual([]);
  for (const p of s.data.players) {
    const seat = data(s).seats[p.id];
    if (seat) expect(p.score, p.name).toBe(seat.chips);
  }
};
const tickResults = (s: Sim): void => {
  const { phase } = data(s);
  s.now = phase.kind === 'results' ? phase.endsAt : s.now;
  s.tick();
};
/** Everyone folds to the big blind. */
function foldAround(s: Sim): void {
  while (data(s).phase.kind === 'acting' && data(s).toAct.length > 1) act(s, data(s).toAct[0], { t: 'fold' });
}
function join(s: Sim, name: string): string {
  s.apply({ type: 'join', name, avatar: AVATAR, connectionId: `conn-${name}` });
  return s.playerId(name);
}

describe('Poker: a big table', () => {
  it('has 23 seats, as many as one deck can deal', () => {
    expect(TABLE_SEATS).toBe(23);
    expect(gameById('poker').maxPlayers).toBe(TABLE_SEATS);
    expect(TABLE_SEATS * 2 + 5).toBeLessThanOrEqual(52);
  });

  it('seats 23 players at the start; the extras wait their turn for a seat, and anyone who joins later only watches', () => {
    const s = sim('poker');
    const ids = startGame(s, names(25), { hands: 0 });
    expect(data(s).order).toEqual(ids.slice(0, 23));
    // The 24th and 25th are in the game, waiting for a seat (they watch the hand).
    for (const id of ids.slice(23)) {
      expect(s.data.players.find((p) => p.id === id)?.participating).toBe(true);
      expect(view(s).players[id]).toMatchObject({ status: 'out', chips: 0, waitingForSeat: true });
    }
    const late = join(s, 'Late');
    foldAround(s);
    tickResults(s);
    expect(data(s).seats[ids[23]]).toBeUndefined();
    // A seat frees up: the first of the extras takes it from the next hand, not the later joiner.
    s.apply({ type: 'leave', playerId: ids[5] });
    expect(view(s).players[ids[23]]).toMatchObject({ waitingForSeat: false });
    expect(view(s).players[ids[24]]).toMatchObject({ waitingForSeat: true });
    expect(view(s).players[late]).toBeUndefined();
    foldAround(s);
    tickResults(s);
    expect(data(s).order).toHaveLength(23);
    expect(data(s).order).toContain(ids[23]);
    expect(data(s).order).not.toContain(ids[24]);
    expect(data(s).order).not.toContain(late);
  });

  it('leaves a player who never got a seat out of the results', () => {
    const s = sim('poker');
    const ids = startGame(s, names(24), { hands: 0 });
    const late = join(s, 'Late');
    expect(errorsOf(s.platform(ids[0], { t: 'endGame' }))).toEqual([]);
    expect(s.data.phase).toBe('lobby');
    const ranked = s.data.results?.entries.map((e) => e.playerId) ?? [];
    expect(ranked).toHaveLength(23);
    expect(ranked).not.toContain(ids[23]);
    expect(ranked).not.toContain(late);
  });

  it('keeps a mid-game joiner watching the whole game, even once a seat frees up', () => {
    const s = sim('poker');
    const ids = startGame(s, names(23), { hands: 0 });
    const late = join(s, 'Late');
    expect(view(s).players[late]).toBeUndefined();
    expect(errorsOf(s.game(late, { t: 'call' }))).toEqual(['You are watching this game.']);
    foldAround(s);
    tickResults(s);
    expect(data(s)).toMatchObject({ hand: 2 });
    expect(data(s).order).toEqual(ids);
    expect(view(s, late).myCards).toEqual([]);

    // A player leaves: the seat stays empty, as nobody is queued for it.
    s.apply({ type: 'leave', playerId: ids[7] });
    foldAround(s);
    tickResults(s);
    expect(data(s).hand).toBe(3);
    expect(data(s).order).toHaveLength(22);
    expect(data(s).order).not.toContain(late);
    expect(data(s).seats[late]).toBeUndefined();
  });

  it('gives a busted player’s seat to the next one queued since the start', () => {
    const s = sim('poker');
    const ids = startGame(s, names(24), { hands: 0, startingChips: 100, smallBlind: 5 });
    const late = ids[23];
    // The first to act shoves aces, the big blind calls with seven-deuce, everyone else folds: the big blind busts.
    const [first] = data(s).toAct;
    const bb = ids[2];
    const game = structuredClone(data(s));
    game.seats[first].cards = [cardOf('AS'), cardOf('AD')];
    game.seats[bb].cards = [cardOf('7C'), cardOf('2H')];
    game.deck = ['4S', 'JC', '9H', '8D', '3C'].map(cardOf);
    s.data = { ...s.data, game };
    act(s, first, { t: 'allIn' });
    while (data(s).phase.kind === 'acting') {
      const turn = data(s).toAct[0];
      act(s, turn, turn === bb ? { t: 'call' } : { t: 'fold' });
    }
    expect(data(s).seats[bb].chips).toBe(0);
    expect(view(s).players[late].waitingForSeat).toBe(false);
    tickResults(s);
    expect(data(s).order).toHaveLength(23);
    expect(data(s).order).toContain(late);
    expect(data(s).order).not.toContain(bb);
  });

  it('plays a 23-seat hand to a showdown: one deck, the blinds left of the button, three side pots, every chip accounted for, then the button moves on', () => {
    const s = sim('poker');
    const ids = startGame(s, names(23), { hands: 0 });
    const d = data(s);
    // rng () => 0 gives the first seat the button; the blinds sit on the next two and the one after acts first.
    expect(d).toMatchObject({ dealerId: ids[0], highest: 10 });
    expect(d.seats[ids[1]].lastAction).toEqual({ kind: 'smallBlind', amount: 5 });
    expect(d.seats[ids[2]].lastAction).toEqual({ kind: 'bigBlind', amount: 10 });
    expect(d.toAct).toEqual([...ids.slice(3), ids[0], ids[1], ids[2]]);
    // 46 hole cards and 6 left in the deck, all different.
    const dealt = [...ids.flatMap((id) => d.seats[id].cards), ...d.deck];
    expect(dealt).toHaveLength(52);
    expect(new Set(dealt.map((c) => `${c.rank}${c.suit}`)).size).toBe(52);

    // Three short stacks shove for 100, 300 and 500; the other twenty call 500.
    const game = structuredClone(d);
    for (const [id, n] of [[ids[3], 100], [ids[4], 300], [ids[5], 500]] as const) game.seats[id].chips = n;
    s.data = { ...s.data, game, players: s.data.players.map((p, i) => (i >= 3 && i <= 5 ? { ...p, score: [100, 300, 500][i - 3] } : p)) };
    const before = totalChips(s);
    for (const id of ids.slice(3, 6)) act(s, id, { t: 'allIn' });
    while (data(s).street === 'preflop' && data(s).phase.kind === 'acting') act(s, data(s).toAct[0], { t: 'call' });
    expect(data(s).street).toBe('flop');
    // Check it down.
    while (data(s).phase.kind === 'acting') act(s, data(s).toAct[0], { t: 'check' });
    expect(view(s)).toMatchObject({ phase: 'results', street: 'river' });
    expect(data(s).community).toHaveLength(5);

    const results = view(s).results;
    if (!results) throw new Error('no results');
    expect(results.uncontested).toBe(false);
    expect(Object.keys(results.revealed)).toHaveLength(23);
    expect(results.pots.map((p) => p.amount)).toEqual([100 * 23, 200 * 22, 200 * 21]);
    for (const pot of results.pots) expect(pot.winners.reduce((sum, w) => sum + w.amount, 0)).toBe(pot.amount);
    // A short stack only wins the pots it covered.
    expect(results.pots.slice(1).flatMap((p) => p.winners.map((w) => w.playerId))).not.toContain(ids[3]);
    expect(results.pots[2].winners.map((w) => w.playerId)).not.toContain(ids[4]);
    expect(totalChips(s)).toBe(before);

    tickResults(s);
    const stacked = ids.filter((id) => (data(s).seats[id]?.chips ?? 0) + (data(s).seats[id]?.bet ?? 0) > 0);
    expect(data(s)).toMatchObject({ hand: 2, dealerId: ids[1] });
    expect(data(s).order).toEqual(stacked);
    const at = stacked.indexOf(ids[1]);
    expect(data(s).seats[stacked[(at + 1) % stacked.length]].lastAction?.kind).toBe('smallBlind');
    expect(data(s).seats[stacked[(at + 2) % stacked.length]].lastAction?.kind).toBe('bigBlind');
  });
});
