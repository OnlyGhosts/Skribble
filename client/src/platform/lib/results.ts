/**
 * When the end-of-game results show: once per finished game, over the lobby, to the players who
 * took part and to anyone who was watching when it ended (a late tab, a reconnect or a reload
 * included: `shownId` is the results this tab had up and not closed), never to a newcomer who
 * joins the lobby afterwards, and never again once closed.
 */
import type { GameResults, ResultEntry, RoomState } from '@shared/platform/protocol';
import { listNames, ordinal } from './party';

export function resultsToShow(next: RoomState, prev: RoomState | null, meId: string | null, showing: GameResults | null, seenId: string | null, shownId: string | null = null): GameResults | null {
  const results = next.phase === 'lobby' ? next.results : null;
  if (!results) return null;
  if (showing?.id === results.id) return showing;
  if (seenId === results.id) return null;
  const tookPart = meId !== null && results.entries.some((e) => e.playerId === meId);
  const watched = prev !== null && prev.code === next.code && prev.phase === 'playing';
  return tookPart || watched || shownId === results.id ? results : null;
}

/** Best first (ties share the rank). */
export function rankedEntries(results: GameResults): ResultEntry[] {
  return results.entries.slice().sort((a, b) => a.rank - b.rank || b.score - a.score);
}

export function topEntries(results: GameResults): ResultEntry[] {
  return rankedEntries(results).filter((e) => e.rank === 1);
}

/** Whether the results crown a winner: not when too few players were left to finish the game. */
export function crowned(results: GameResults): boolean {
  return results.reason !== 'players' && results.entries.length > 0;
}

/** "Alice wins!", "Alice and Bob tie!", or a plain line when nobody is crowned. */
export function resultsHeadline(results: GameResults): string {
  const top = topEntries(results);
  if (results.reason === 'players') return 'Game over';
  if (top.length === 0) return 'Thanks for playing!';
  if (top.length === 1) return `${top[0].name} wins!`;
  return `${listNames(top.map((e) => e.name))} tie!`;
}

/**
 * What the results say to this player: "You won!", "You came 2nd", or null for someone who
 * watched. A game cut short crowns nobody: it says where they stood, or that nobody was ahead.
 */
export function resultsPlace(results: GameResults, meId: string | null): string | null {
  const mine = meId === null ? undefined : results.entries.find((e) => e.playerId === meId);
  if (!mine) return null;
  if (!crowned(results)) {
    const level = results.entries.every((e) => e.score === mine.score);
    if (level && mine.score === 0) return 'Nobody scored';
    if (level && results.entries.length > 1) return 'All square';
    return mine.rank === 1 ? 'You were in the lead' : `You were ${ordinal(mine.rank)}`;
  }
  if (mine.rank === 1) return topEntries(results).length > 1 ? 'You tied for the win!' : 'You won!';
  return `You came ${ordinal(mine.rank)}`;
}

/** Why the game ended early, in a few words; null when it ran its course. */
export function endReasonLine(results: GameResults): string | null {
  switch (results.reason) {
    case 'host':
      return 'The host ended the game.';
    case 'players':
      return 'Too few players were left.';
    case 'finished':
      return null;
  }
}
