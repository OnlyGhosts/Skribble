import { describe, expect, it } from 'vitest';
import { gameById } from '@shared/platform/games';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { player, room } = await import('../../test/fixtures');
const { canStart, listNames, notReadyPlayers, ordinal, playerCountLabel, readyLine, readyPlayers } = await import('./party');

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
    expect(canStart(lobby(), gameById('scribble'))).toBe(true); // 2 ready, needs 2
    expect(canStart(lobby(), gameById('spygame'))).toBe(false); // needs 3
    const hostOut = room({ players: [player('host', { sittingOut: true }), player('bob', { joinOrder: 1 })] });
    expect(readyPlayers(hostOut)).toEqual([]);
    expect(canStart(hostOut, gameById('template'))).toBe(false);
  });

  it('labels a game by its seat range', () => {
    expect(playerCountLabel(gameById('scribble'))).toBe('2+ players');
    expect(playerCountLabel({ ...gameById('scribble'), maxPlayers: 6 })).toBe('2 to 6 players');
    expect(playerCountLabel(gameById('poker'))).toBe('2 to 23 players');
    // No seat cap for the big-party games: everyone in the room plays.
    expect(playerCountLabel(gameById('blackjack'))).toBe('1+ players');
    expect(playerCountLabel(gameById('quipgame'))).toBe('3+ players');
    expect(playerCountLabel({ ...gameById('scribble'), minPlayers: 4, maxPlayers: 4 })).toBe('4 players');
    expect(listNames(['Alice', 'Bob', 'Carol'])).toBe('Alice, Bob and Carol');
    expect(listNames(['Alice'])).toBe('Alice');
    expect([ordinal(1), ordinal(2), ordinal(3), ordinal(4), ordinal(11), ordinal(12), ordinal(13), ordinal(21), ordinal(22)]).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});
