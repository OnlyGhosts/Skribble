/** When each game's sounds play: the decisions, with the banks' play spied on (nothing reaches an AudioContext). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlackjackPlayerView, BlackjackView } from '@shared/games/blackjack/protocol';
import type { PokerView } from '@shared/games/poker/protocol';
import type { QuipgameMatchupResultView, QuipgameView } from '@shared/games/quipgame/protocol';
import type { RoomState } from '@shared/platform/protocol';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();

const { ONLOOKER_VOLUME } = await import('../platform/lib/sound');
const { PLATFORM_SOUNDS, platformRoomSounds } = await import('../platform/lib/platformSounds');
const PK = await import('./poker/lib/timeline');
const BJ = await import('./blackjack/lib/timeline');
const { player, room } = await import('../test/fixtures');
const { bigWin } = await import('./quipgame/sfx');
const { playPokerSounds } = await import('./poker/sfx');
const { pokerSounds } = await import('./poker/sounds');
const { playBlackjackSounds } = await import('./blackjack/sfx');
const { blackjackSounds } = await import('./blackjack/sounds');

/** A view with only the fields a decision reads; the rest never gets looked at. */
const partial = <T,>(v: Partial<T>): T => v as T;

/** The names a bank played, with the level scale each got. */
function spy(bank: { play: (name: never, opts?: { volume?: number }) => void }) {
  return vi.spyOn(bank, 'play');
}
const calls = (s: ReturnType<typeof spy>) => s.mock.calls.map(([name, opts]) => [name, opts?.volume ?? 1]);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('platform sounds', () => {
  const lobby = (ids: string[], phase: RoomState['phase'] = 'lobby') => room({ phase, players: ids.map((id) => player(id)) });

  it('pops when someone else joins between games, and plays the start sting when a game starts', () => {
    const play = spy(PLATFORM_SOUNDS);
    platformRoomSounds(lobby(['me', 'bob']), lobby(['me']), 'me');
    platformRoomSounds(lobby(['me', 'bob'], 'playing'), lobby(['me', 'bob']), 'me');
    expect(calls(play)).toEqual([
      ['join', 1],
      ['start', 1],
    ]);
  });

  it('stays quiet for my own arrival and for a snapshot of another room', () => {
    const play = spy(PLATFORM_SOUNDS);
    platformRoomSounds(lobby(['bob', 'me']), lobby(['bob']), 'me');
    platformRoomSounds({ ...lobby(['me', 'bob']), code: 'ZZZZ' }, lobby(['me']), 'me');
    platformRoomSounds(lobby(['me']), null, 'me');
    expect(play).not.toHaveBeenCalled();
  });
});

describe('Quip Game', () => {
  const side = (votes: number, flawless = false) => ({ text: 'x', authorId: 'a', authorName: 'A', votes, points: 0, flawless, fallback: false });
  const result = (a: number, b: number, outcome: QuipgameMatchupResultView['outcome'], flawless = false): QuipgameMatchupResultView => ({ index: 0, total: 1, prompt: 'p', a: side(a, flawless), b: side(b), outcome });

  it('applauds a flawless win, a win by three or more, and the final', () => {
    expect(bigWin(partial<QuipgameView>({ phase: 'result', result: result(3, 0, 'a', true) }))).toBe(true);
    expect(bigWin(partial<QuipgameView>({ phase: 'result', result: result(5, 2, 'a') }))).toBe(true);
    expect(bigWin(partial<QuipgameView>({ phase: 'finalResult', result: null }))).toBe(true);
    expect(bigWin(partial<QuipgameView>({ phase: 'result', result: result(3, 2, 'a') }))).toBe(false);
    expect(bigWin(partial<QuipgameView>({ phase: 'result', result: result(2, 2, 'tie') }))).toBe(false);
  });
});

describe('Poker', () => {
  const move = (kind: NonNullable<PokerView['lastMove']>['kind'], playerId: string, seq: number) => ({ kind, amount: 0, seq, playerId, street: 'flop' as const });
  const base = partial<PokerView>({ lastMove: move('call', 'bob', 1), results: null });
  const empty = PK.EMPTY_TIMELINE;

  it('knocks for a check and tosses my own fold at once; another seat’s fold waits for its cards to leave', () => {
    const play = spy(pokerSounds);
    playPokerSounds({ view: { ...base, lastMove: move('check', 'me', 2) }, prevView: base, before: empty, timeline: empty, me: 'me' });
    playPokerSounds({ view: { ...base, lastMove: move('fold', 'me', 3) }, prevView: base, before: empty, timeline: empty, me: 'me' });
    playPokerSounds({ view: { ...base, lastMove: move('fold', 'bob', 4) }, prevView: base, before: empty, timeline: empty, me: 'me' });
    expect(calls(play)).toEqual([
      ['check', 1],
      ['fold', 1],
    ]);
  });

  it('plays chips as a bet slides out, a big push for an all in, and the collect as the pot goes over', () => {
    const play = spy(pokerSounds);
    const now = Date.now();
    const timeline = {
      ...PK.snapTimeline(null, now),
      flights: [
        { id: '0:bet:me', from: 'seat:me', to: 'bet:me', amount: 50, at: now, ms: 300 },
        { id: '1:pay:bob', from: 'pot', to: 'seat:bob', amount: 90, at: now + 500, ms: 500 },
      ],
    };
    playPokerSounds({ view: { ...base, lastMove: move('allIn', 'me', 2) }, prevView: base, before: empty, timeline, me: 'me' });
    vi.advanceTimersByTime(600);
    expect(calls(play)).toEqual([
      ['allIn', 1],
      ['collect', ONLOOKER_VOLUME],
    ]);
  });
});

describe('Blackjack', () => {
  const seat = (bet: number): BlackjackPlayerView => ({ chips: 100, bet, hands: [], inRound: true, sittingOut: false, bustedOut: false });
  const view = (bets: Record<string, number>, extra: Partial<BlackjackView> = {}) =>
    partial<BlackjackView>({ round: 2, players: Object.fromEntries(Object.entries(bets).map(([id, b]) => [id, seat(b)])), ...extra });
  const tl = BJ.EMPTY_TIMELINE;

  it('lays chips once a snapshot however many bets went in (full when mine is one), quieter for other seats, and never shuffles (the deck is endless)', () => {
    const play = spy(blackjackSounds);
    const prevView = view({ me: 0, bob: 0, carol: 0 });
    playBlackjackSounds({ view: view({ me: 10, bob: 20, carol: 0 }), prevView, table: null, prevTable: null, before: tl, timeline: tl, me: 'me' });
    playBlackjackSounds({ view: view({ me: 10, bob: 20, carol: 5 }), prevView: view({ me: 10, bob: 20, carol: 0 }), table: null, prevTable: null, before: tl, timeline: tl, me: 'me' });
    expect(calls(play)).toEqual([
      ['bet', 1],
      ['bet', ONLOOKER_VOLUME],
    ]);
    expect(Object.keys(blackjackSounds)).not.toContain('shuffle');
  });

  it('thuds my bust once the busting card lands', () => {
    const play = spy(blackjackSounds);
    const hand = (status: 'acting' | 'bust', n: number) => ({
      cards: Array.from({ length: n }, () => ({ rank: 'K' as const, suit: 'S' as const })),
      bet: 10,
      status,
      doubled: false,
      fromSplit: false,
      splitAces: false,
      outcome: null,
      payout: null,
    });
    const table = (status: 'acting' | 'bust', n: number) => ({ round: 2, settled: false, peeked: false, order: ['me'], dealer: [], hands: { me: [hand(status, n)] } });
    playBlackjackSounds({ view: view({ me: 10 }), prevView: view({ me: 10 }), table: table('bust', 3), prevTable: table('acting', 2), before: tl, timeline: tl, me: 'me' });
    vi.advanceTimersByTime(10);
    expect(calls(play)).toEqual([['bust', 1]]);
  });
});
