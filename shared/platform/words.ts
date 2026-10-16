/**
 * Word helpers any word game shares: the mask guessers see (Skribble's hints) and the parser for a
 * host-typed word list. Content packs stay with the games that own them.
 */

/** Indices of characters in `word` that are letters/digits and can therefore be hidden or revealed. */
export function revealableIndices(word: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (/[\p{L}\p{N}]/u.test(word[i])) out.push(i);
  }
  return out;
}

/**
 * Builds the mask shown to guessers: hidden letters become "_", spaces/hyphens/apostrophes stay.
 * Example: maskWord("ice cream", [0]) === "i__ _____"
 */
export function maskWord(word: string, revealed: Iterable<number> = []): string {
  const show = new Set(revealed);
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (/[\p{L}\p{N}]/u.test(ch)) out += show.has(i) ? ch : '_';
    else out += ch;
  }
  return out;
}

export interface WordListLimits {
  maxCount: number;
  maxLength: number;
}

/** The entries of a free-text word list as typed ("cat, dog, hot dog" or newline separated), blanks dropped. */
export function splitWordList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((raw) => raw.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/** Parses a free-text word list ("cat, dog, hot dog" or newline separated). Dedupes case-insensitively. */
export function parseWordList(text: string, limits: WordListLimits): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of splitWordList(text)) {
    if (w.length > limits.maxLength) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= limits.maxCount) break;
  }
  return out;
}
