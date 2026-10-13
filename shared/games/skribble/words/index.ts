import type { ContentMode } from '../../../platform/settings.js';
import type { Language } from '../protocol.js';
import { CHEEKY_WORDS } from './cheeky.js';
import { EN_WORDS } from './en.js';
import { UNHINGED_WORDS } from './unhinged.js';

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const w = raw.trim().replace(/\s+/g, ' ');
    const k = w.toLowerCase();
    if (!w || seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

export const WORD_LISTS: Record<Language, string[]> = {
  en: dedupe(EN_WORDS),
};

export function getWordList(lang: Language): string[] {
  return WORD_LISTS[lang] ?? WORD_LISTS.en;
}

/** The extra tiers a content mode adds on top of the language list (none for family). */
export const TIER_WORDS: Record<ContentMode, readonly string[]> = {
  family: [],
  cheeky: CHEEKY_WORDS,
  unhinged: [...CHEEKY_WORDS, ...UNHINGED_WORDS],
};

/**
 * The pack words a room draws from: the language list plus the tiers its content mode unlocks
 * (family = the language list alone; cheeky adds CHEEKY_WORDS; unhinged adds both tiers),
 * deduplicated case-insensitively so a tier word that also sits in the language list appears once.
 */
export function wordPoolForMode(mode: ContentMode, lang: Language = 'en'): string[] {
  return dedupe([...getWordList(lang), ...TIER_WORDS[mode]]);
}

/**
 * Picks `count` distinct words from `pool`, avoiding anything in `exclude` (case-insensitive)
 * when enough words remain. Deterministic when `rand` is injected (tests).
 */
export function pickWords(
  pool: readonly string[],
  count: number,
  exclude: Iterable<string> = [],
  rand: () => number = Math.random,
): string[] {
  const used = new Set(Array.from(exclude, (w) => w.toLowerCase()));
  let candidates = pool.filter((w) => !used.has(w.toLowerCase()));
  if (candidates.length < count) candidates = [...pool];
  const out: string[] = [];
  const chosen = new Set<string>();
  const n = Math.min(count, candidates.length);
  // partial Fisher–Yates
  const arr = [...candidates];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
    const k = arr[i].toLowerCase();
    if (chosen.has(k)) continue;
    chosen.add(k);
    out.push(arr[i]);
  }
  return out;
}

/** Builds the word pool for a room: custom words only, or the pack for the content mode merged with custom words. */
export function buildWordPool(lang: Language, customWords: readonly string[], customOnly: boolean, mode: ContentMode = 'family'): string[] {
  const custom = dedupe([...customWords]);
  if (customOnly && custom.length > 0) return custom;
  return dedupe([...wordPoolForMode(mode, lang), ...custom]);
}
