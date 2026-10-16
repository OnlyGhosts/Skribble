import { describe, expect, it } from 'vitest';
import type { GameResults, ResultEntry } from '@shared/platform/protocol';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { player, room } = await import('../../test/fixtures');
const { crowned, endReasonLine, rankedEntries, resultsHeadline, resultsPlace, resultsToShow } = await import('./results');

const AVATAR = { color: 0, emoji: 0 };
const entry = (playerId: string, score: number, rank: number): ResultEntry => ({ playerId, name: playerId, avatar: AVATAR, score, rank });

const results = (overrides: Partial<GameResults> = {}): GameResults => ({
  id: 'r1',
  gameId: 'scribble',
  reason: 'finished',
  entries: [entry('bob', 30, 1), entry('carol', 30, 1), entry('host', 10, 3)],
  ...overrides,
});

describe('the results copy', () => {
  it('names a single winner, or every tied player, and crowns nobody when too few were left', () => {
    expect(resultsHeadline(results())).toBe('bob and carol tie!');
    expect(resultsHeadline(results({ entries: [entry('bob', 30, 1), entry('host', 10, 2)] }))).toBe('bob wins!');
    expect(resultsHeadline(results({ entries: [] }))).toBe('Thanks for playing!');
    expect(resultsHeadline(results({ reason: 'players' }))).toBe('Game over');
    expect(crowned(results({ reason: 'players' }))).toBe(false);
    expect(crowned(results({ reason: 'host' }))).toBe(true);
  });

  it('tells each player where they came, and nothing to someone who only watched', () => {
    expect(resultsPlace(results(), 'bob')).toBe('You tied for the win!');
    expect(resultsPlace(results(), 'host')).toBe('You came 3rd');
    expect(resultsPlace(results(), 'dan')).toBeNull();
    expect(resultsPlace(results(), null)).toBeNull();
    expect(resultsPlace(results({ entries: [entry('bob', 1, 1)] }), 'bob')).toBe('You won!');
    expect(resultsPlace(results({ reason: 'players' }), 'bob')).toBe('You were in the lead');
    expect(resultsPlace(results({ reason: 'players' }), 'host')).toBe('You were 3rd');
    // Cut short with nobody ahead: no lead to claim.
    expect(resultsPlace(results({ reason: 'players', entries: [entry('bob', 0, 1), entry('carol', 0, 1)] }), 'bob')).toBe('Nobody scored');
    expect(resultsPlace(results({ reason: 'players', entries: [entry('bob', 4, 1), entry('carol', 4, 1)] }), 'carol')).toBe('All square');
    expect(resultsPlace(results({ reason: 'players', entries: [entry('bob', 4, 1)] }), 'bob')).toBe('You were in the lead');
  });

  it('says why a game ended early, in a few words', () => {
    expect(endReasonLine(results())).toBeNull();
    expect(endReasonLine(results({ reason: 'host' }))).toBe('The host ended the game.');
    expect(endReasonLine(results({ reason: 'players' }))).toBe('Too few players were left.');
  });

  it('ranks best first, ties by score', () => {
    const shuffled = results({ entries: [entry('host', 10, 3), entry('carol', 30, 1), entry('bob', 30, 1)] });
    expect(rankedEntries(shuffled).map((e) => e.rank)).toEqual([1, 1, 3]);
  });
});

describe('when the results show', () => {
  const playing = room({ phase: 'playing', players: [player('host'), player('bob', { joinOrder: 1 })] });
  const lobby = room({ phase: 'lobby', results: results({ entries: [entry('bob', 5, 1), entry('host', 2, 2)] }) });

  it('shows them to a player in them, and to a watcher who saw the game end', () => {
    expect(resultsToShow(lobby, playing, 'host', null, null)?.id).toBe('r1');
    expect(resultsToShow(lobby, playing, 'dave', null, null)?.id).toBe('r1');
  });

  it('shows them once a reconnect or a reload brings the lobby, to the players in them only', () => {
    // A welcome on a fresh page has no previous room.
    expect(resultsToShow(lobby, null, 'bob', null, null)?.id).toBe('r1');
    // A newcomer who joins the lobby after the game never sees a game they had nothing to do with.
    expect(resultsToShow(lobby, null, 'newt', null, null)).toBeNull();
    // Someone who only watched: this tab had them up and not closed when it reloaded.
    expect(resultsToShow(lobby, null, 'dave', null, null, 'r1')?.id).toBe('r1');
    expect(resultsToShow(lobby, null, 'dave', null, 'r1', 'r1')).toBeNull();
  });

  it('keeps them up across snapshots, and never shows them again once closed', () => {
    const showing = resultsToShow(lobby, playing, 'host', null, null);
    expect(resultsToShow({ ...lobby, serverTime: 2 }, lobby, 'host', showing, null)).toBe(showing);
    expect(resultsToShow(lobby, playing, 'host', null, 'r1')).toBeNull();
    expect(resultsToShow(lobby, null, 'host', null, 'r1')).toBeNull();
    // The next game's results are new.
    expect(resultsToShow({ ...lobby, results: results({ id: 'r2' }) }, playing, 'host', null, 'r1')?.id).toBe('r2');
  });

  it('takes them down once the next game starts', () => {
    const showing = resultsToShow(lobby, playing, 'host', null, null);
    expect(resultsToShow({ ...playing, results: null }, lobby, 'host', showing, null)).toBeNull();
    expect(resultsToShow(room({ phase: 'lobby', results: null }), lobby, 'host', showing, null)).toBeNull();
  });
});
