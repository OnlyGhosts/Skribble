/** Points a guesser earns: 50 (last second) to 400 (instant). */
export function guesserPoints(remainingMs: number, totalMs: number): number {
  const frac = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  return Math.round(50 + 350 * frac);
}

/**
 * Points the drawer earns: up to 300, scaled by how many of the guessers got the word.
 * Rewards drawing clearly for everyone rather than for one fast friend.
 */
export function drawerPoints(correctCount: number, guesserCount: number): number {
  if (correctCount <= 0 || guesserCount <= 0) return 0;
  return Math.round(300 * Math.min(1, correctCount / guesserCount));
}
