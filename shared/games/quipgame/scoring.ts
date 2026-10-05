/** Quip Game's points: a matchup splits a pool by votes, the final pays per pick. */
import { QUIPGAME_POINTS, type QuipgameOutcome } from './protocol.js';

export interface MatchupScore {
  a: number;
  b: number;
  /** The side that took every vote (with at least QUIPGAME_POINTS.flawlessMinVotes cast), bonus included in its points. */
  flawless: 'a' | 'b' | null;
  outcome: QuipgameOutcome;
}

/** The pool for one matchup at `multiplier`, before the flawless bonus. */
export function matchupPool(multiplier: number): number {
  return QUIPGAME_POINTS.pool * multiplier;
}

/** Each author's share of `pool x multiplier` by votes; nothing when nobody voted; a sweep of 2+ votes adds the flawless bonus. */
export function scoreMatchup(votesA: number, votesB: number, multiplier: number): MatchupScore {
  const total = votesA + votesB;
  if (total === 0) return { a: 0, b: 0, flawless: null, outcome: 'noVotes' };
  const pool = matchupPool(multiplier);
  let a = Math.round((pool * votesA) / total);
  let b = Math.round((pool * votesB) / total);
  let flawless: 'a' | 'b' | null = null;
  if (total >= QUIPGAME_POINTS.flawlessMinVotes) {
    if (votesB === 0) {
      flawless = 'a';
      a += QUIPGAME_POINTS.flawless * multiplier;
    } else if (votesA === 0) {
      flawless = 'b';
      b += QUIPGAME_POINTS.flawless * multiplier;
    }
  }
  const outcome: QuipgameOutcome = votesA === votesB ? 'tie' : votesA > votesB ? 'a' : 'b';
  return { a, b, flawless, outcome };
}

/** What one voter's ranking pays each picked answer, by position. */
export function pickPoints(position: number): number {
  return QUIPGAME_POINTS.finalPicks[position] ?? 0;
}
