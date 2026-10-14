import { maskWord, revealableIndices } from '../../platform/words.js';

export { maskWord, revealableIndices };

/** How many letters may be revealed for this word given the room's hint setting (never more than half). */
export function hintCountFor(word: string, hintsSetting: number): number {
  const letters = revealableIndices(word).length;
  return Math.max(0, Math.min(hintsSetting, Math.floor(letters / 2)));
}

/** Returns the order in which letters get revealed (a random permutation of revealable indices). */
export function hintRevealOrder(word: string, count: number, rand: () => number = Math.random): number[] {
  const idx = revealableIndices(word);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, count);
}

/** Milliseconds (from turn start) at which each hint should be revealed, spread evenly over the turn. */
export function hintSchedule(drawTimeMs: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= count; i++) out.push(Math.round((drawTimeMs * i) / (count + 1)));
  return out;
}
