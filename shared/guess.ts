/**
 * Guess matching. Everything is compared in a normalised form:
 * lower-cased, trimmed, diacritics stripped, whitespace collapsed.
 */
export function normalizeGuess(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCorrectGuess(guess: string, word: string): boolean {
  const g = normalizeGuess(guess);
  return g.length > 0 && g === normalizeGuess(word);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** "Close" = one edit away for short words, two edits away for long words (but never exact). */
export function isCloseGuess(guess: string, word: string): boolean {
  const g = normalizeGuess(guess);
  const w = normalizeGuess(word);
  if (!g || !w || g === w) return false;
  if (w.length < 4) return false;
  const maxDist = w.length >= 8 ? 2 : 1;
  if (Math.abs(g.length - w.length) > maxDist) return false;
  return levenshtein(g, w) <= maxDist;
}

/** True if the text contains the word as a whole word (used to stop the drawer leaking the answer). */
export function containsWord(text: string, word: string): boolean {
  const t = normalizeGuess(text);
  const w = normalizeGuess(word);
  if (!t || !w) return false;
  if (t === w) return true;
  const tokens = t.split(' ');
  const wTokens = w.split(' ');
  if (wTokens.length === 1) {
    if (tokens.includes(w)) return true;
    // "ap ple" / "a-p-p-l-e" style leaks of longer words
    return w.length >= 4 && t.replace(/[\s'-]/g, '').includes(w);
  }
  return t.includes(w);
}
