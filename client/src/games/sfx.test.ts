/** When each game's sounds play: the decisions, with the banks' play spied on (nothing reaches an AudioContext). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleshipsView, ShotEvent } from '@shared/games/battleships/protocol';
import type { BlackjackPlayerView, BlackjackView } from '@shared/games/blackjack/protocol';
import type { HangmanView } from '@shared/games/hangman/protocol';
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
const bs = await import('./battleships/sfx');
const { battleshipsSounds } = await import('./battleships/sounds');
const { playHangmanSounds } = await import('./hangman/sfx');
const { hangmanSounds } = await import('./hangman/sounds');
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

describe('Battleships', () => {
  const sides = [
    { id: 'red', memberIds: ['me', 'ally'] },
    { id: 'blue', memberIds: ['foe'] },
  ] as BattleshipsView['sides'];
  const base = partial<BattleshipsView>({ phase: 'playing', sides, mySideId: 'red', turnNumber: 4, turn: { sideId: 'red', shooterId: 'me', roll: null, canMove: false }, lastAction: null });
  const shot = (s: Partial<ShotEvent>): ShotEvent => ({ shooterId: 'me', targetId: 'blue', x: 0, y: 0, result: 'miss', length: null, dice: null, auto: false, ...s });
  const after = (action: BattleshipsView['lastAction'], extra: Partial<BattleshipsView> = {}) => ({ ...base, turnNumber: 5, lastAction: action, ...extra });

  it('rolls the die at the start of a turn, louder for the shooter', () => {
    const play = spy(battleshipsSounds);
    bs.playBattleshipsSounds({ ...base, turn: { sideId: 'blue', shooterId: 'foe', roll: 3, canMove: true } }, base, 'me');
    expect(calls(play)).toEqual([['dice', ONLOOKER_VOLUME]]);
  });

  it('fires, then lands the shot a beat later: a splash, an explosion, a sinking with the sting for the shooting side', () => {
    const play = spy(battleshipsSounds);
    bs.playBattleshipsSounds(after({ kind: 'fire', shot: shot({ result: 'miss' }) }), base, 'me');
    expect(calls(play)).toEqual([['fire', 1]]);
    vi.advanceTimersByTime(bs.SHOT_FLIGHT_MS);
    expect(calls(play)).toEqual([
      ['fire', 1],
      ['miss', 1],
    ]);
    play.mockClear();
    bs.playBattleshipsSounds(after({ kind: 'fire', shot: shot({ shooterId: 'ally', result: 'sunk', length: 3 }) }), base, 'me');
    vi.advanceTimersByTime(2000);
    expect(calls(play)).toEqual([
      ['fire', ONLOOKER_VOLUME],
      ['sink', ONLOOKER_VOLUME],
      ['sinkSting', 1],
    ]);
  });

  it('lands a hit on my fleet as a thud, and gives the enemy no sting for sinking mine', () => {
    const play = spy(battleshipsSounds);
    bs.playBattleshipsSounds(after({ kind: 'fire', shot: shot({ shooterId: 'foe', targetId: 'red', result: 'hit' }) }), base, 'me');
    bs.playBattleshipsSounds(after({ kind: 'fire', shot: shot({ shooterId: 'foe', targetId: 'red', result: 'sunk', length: 2 }) }, { turnNumber: 6 }), after(null), 'me');
    vi.advanceTimersByTime(2000);
    expect(calls(play).map(([n]) => n)).toEqual(['fire', 'fire', 'struck', 'sink', 'struck']);
  });

  it('whooshes a move only on the side that moved', () => {
    const play = spy(battleshipsSounds);
    bs.playBattleshipsSounds(after({ kind: 'move', playerId: 'ally', sideId: 'red', dice: 2 }), base, 'me');
    bs.playBattleshipsSounds(after({ kind: 'move', playerId: 'foe', sideId: 'blue', dice: 2 }), base, 'me');
    expect(calls(play)).toEqual([['moved', 1]]);
  });
});

describe('Hangman', () => {
  const base = partial<HangmanView>({ phase: 'guessing', round: 1, turn: 2, guesserId: 'me', wrong: 1, usedLetters: ['A'], outcome: null });

  it('chimes a right letter and buzzes a wrong one, quieter for everyone but the guesser', () => {
    const play = spy(hangmanSounds);
    playHangmanSounds({ ...base, usedLetters: ['A', 'E'] }, base, 'me');
    playHangmanSounds({ ...base, usedLetters: ['A', 'Z'], wrong: 2 }, base, 'bob');
    expect(calls(play)).toEqual([
      ['right', 1],
      ['wrong', ONLOOKER_VOLUME],
    ]);
  });

  it('scratches as a section goes up and stings the ending', () => {
    const play = spy(hangmanSounds);
    playHangmanSounds(base, { ...base, phase: 'drawing' }, 'me');
    playHangmanSounds({ ...base, phase: 'turnEnd', outcome: { kind: 'solved', solverId: 'me' } }, base, 'me');
    playHangmanSounds({ ...base, phase: 'turnEnd', outcome: { kind: 'hangmanWins' } }, { ...base, phase: 'drawing' }, 'me');
    expect(calls(play).map(([n]) => n)).toEqual(['section', 'solved', 'section', 'hanged']);
  });

  it('plays nothing across a change of word', () => {
    const play = spy(hangmanSounds);
    playHangmanSounds({ ...base, turn: 3, wrong: 0, usedLetters: [] }, { ...base, wrong: 5 }, 'me');
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

  it('knocks for a check and tosses for a fold, at the mover’s level', () => {
    const play = spy(pokerSounds);
    playPokerSounds({ view: { ...base, lastMove: move('check', 'me', 2) }, prevView: base, before: empty, timeline: empty, me: 'me' });
    playPokerSounds({ view: { ...base, lastMove: move('fold', 'bob', 3) }, prevView: base, before: empty, timeline: empty, me: 'me' });
    expect(calls(play)).toEqual([
      ['check', 1],
      ['fold', ONLOOKER_VOLUME],
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
  const seat = (bet: number): BlackjackPlayerView => ({ chips: 100, bet, hands: [], inRound: true, bustedOut: false });
  const view = (bets: Record<string, number>, extra: Partial<BlackjackView> = {}) =>
    partial<BlackjackView>({ round: 2, reshuffled: false, players: Object.fromEntries(Object.entries(bets).map(([id, b]) => [id, seat(b)])), ...extra });
  const tl = BJ.EMPTY_TIMELINE;

  it('lays chips once a snapshot however many bets went in (full when mine is one), quieter for other seats, and shuffles once for a fresh shoe', () => {
    const play = spy(blackjackSounds);
    const prevView = view({ me: 0, bob: 0, carol: 0 });
    playBlackjackSounds({ view: view({ me: 10, bob: 20, carol: 0 }, { reshuffled: true }), prevView, table: null, prevTable: null, before: tl, timeline: tl, me: 'me' });
    playBlackjackSounds({ view: view({ me: 10, bob: 20, carol: 5 }, { reshuffled: true }), prevView: view({ me: 10, bob: 20, carol: 0 }, { reshuffled: true }), table: null, prevTable: null, before: tl, timeline: tl, me: 'me' });
    expect(calls(play)).toEqual([
      ['shuffle', 1],
      ['bet', 1],
      ['bet', ONLOOKER_VOLUME],
    ]);
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
