import { describe, expect, it } from 'vitest';
import { gameById } from '@shared/platform/games';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { player, room } = await import('../../test/fixtures');
const { canStart, listNames, notReadyPlayers, ordinal, placeLine, playerCountLabel, readyLine, readyPlayers, winnerHeadline } = await import('./party');

const lobby = () =>
  room({
    players: [
      player('host', { participating: false }),
      player('bob', { joinOrder: 1, ready: true, participating: false }),
      player('carol', { joinOrder: 2, participating: false }),
      player('dan', { joinOrder: 3, sittingOut: true, participating: false }),
      player('eve', { joinOrder: 4, connected: false, participating: false }),
    ],
  });

describe('ready-up', () => {
  it('counts the host as ready (Start seats them), skips players sitting out or disconnected', () => {
    expect(readyPlayers(lobby()).map((p) => p.id)).toEqual(['host', 'bob']);
    expect(notReadyPlayers(lobby()).map((p) => p.id)).toEqual(['carol']);
    expect(readyLine(lobby())).toBe('2 of 3 ready');
  });

  it('lets the host start once the game has enough ready players', () => {
    expect(canStart(lobby(), gameById('skribble'))).toBe(true); // 2 ready, needs 2
    expect(canStart(lobby(), gameById('spygame'))).toBe(false); // needs 3
    const hostOut = room({ players: [player('host', { sittingOut: true }), player('bob', { joinOrder: 1 })] });
    expect(readyPlayers(hostOut)).toEqual([]);
    expect(canStart(hostOut, gameById('template'))).toBe(false);
  });

  it('labels a game by its seat range', () => {
    expect(playerCountLabel(gameById('skribble'))).toBe('2+ players');
    expect(playerCountLabel({ ...gameById('skribble'), maxPlayers: 6 })).toBe('2–6 players');
    expect(playerCountLabel({ ...gameById('skribble'), minPlayers: 4, maxPlayers: 4 })).toBe('4 players');
    expect(listNames(['Alice', 'Bob', 'Carol'])).toBe('Alice, Bob and Carol');
    expect(listNames(['Alice'])).toBe('Alice');
  });
});

describe('podium copy', () => {
  const ended = room({
    phase: 'ended',
    players: [player('host', { score: 10 }), player('bob', { score: 30, joinOrder: 1 }), player('carol', { score: 30, joinOrder: 2 }), player('dan', { joinOrder: 3, participating: false })],
    podium: [
      { playerId: 'bob', score: 30, rank: 1 },
      { playerId: 'carol', score: 30, rank: 1 },
      { playerId: 'host', score: 10, rank: 3 },
    ],
  });

  it('names a single winner, or every tied player', () => {
    expect(winnerHeadline(ended)).toBe('bob and carol tie!');
    expect(winnerHeadline({ ...ended, podium: ended.podium?.slice(0, 1).concat({ playerId: 'host', score: 10, rank: 2 }) ?? null })).toBe('bob wins!');
    expect(winnerHeadline({ ...ended, podium: [] })).toBe('Thanks for playing!');
  });

  it('tells each player where they came, and nothing to someone who sat it out', () => {
    expect(placeLine(ended, 'bob')).toBe('You tied for the win!');
    expect(placeLine(ended, 'host')).toBe('You came 3rd');
    expect(placeLine(ended, 'dan')).toBeNull();
    expect(placeLine(ended, null)).toBeNull();
    expect(placeLine({ ...ended, podium: [{ playerId: 'bob', score: 1, rank: 1 }] }, 'bob')).toBe('You won!');
    expect([ordinal(1), ordinal(2), ordinal(3), ordinal(4), ordinal(11), ordinal(12), ordinal(13), ordinal(21), ordinal(22)]).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});
