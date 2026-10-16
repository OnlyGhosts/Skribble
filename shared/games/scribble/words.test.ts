import { describe, expect, it } from 'vitest';
import { CHEEKY_WORDS } from './words/cheeky.js';
import { TIER_WORDS, WORD_LISTS, buildWordPool, getWordList, pickWords, wordPoolForMode } from './words/index.js';
import { UNHINGED_WORDS } from './words/unhinged.js';

describe('word lists', () => {
  it('ships a sizeable, deduplicated English list', () => {
    const en = getWordList('en');
    expect(en.length).toBeGreaterThan(500);
    expect(new Set(en.map((w) => w.toLowerCase())).size).toBe(en.length);
    for (const w of en) expect(w).toBe(w.trim());
    expect(WORD_LISTS.en).toBe(en);
  });
});

describe('the adult tiers', () => {
  const lower = (list: readonly string[]): string[] => list.map((w) => w.toLowerCase());

  it('ship distinct, trimmed, drawable-length words and phrases', () => {
    for (const tier of [CHEEKY_WORDS, UNHINGED_WORDS]) {
      expect(new Set(lower(tier)).size).toBe(tier.length);
      for (const w of tier) {
        expect(w).toBe(w.trim().replace(/\s+/g, ' '));
        // One to four words: a drawer has about 80 seconds.
        expect(w.split(' ').length, w).toBeLessThanOrEqual(4);
      }
    }
    expect(UNHINGED_WORDS.length).toBeGreaterThanOrEqual(300);
    expect(CHEEKY_WORDS.length).toBeGreaterThanOrEqual(150);
  });

  it('never repeat a word across the language list and the tiers', () => {
    const all = lower([...getWordList('en'), ...CHEEKY_WORDS, ...UNHINGED_WORDS]);
    expect(all.filter((w, i) => all.indexOf(w) !== i)).toEqual([]);
  });

  it('never near-repeat one either: a plural, or the same letters spaced or hyphenated differently', () => {
    // 'crabs' against the family 'crab': a guesser types the family word.
    const squash = (w: string): string => w.toLowerCase().replace(/[\s-]+/g, '');
    const forms = (w: string): string[] => {
      const k = squash(w);
      return [k, `${k}s`, k.replace(/s$/, '')];
    };
    const seen = new Map<string, string>();
    for (const w of getWordList('en')) for (const k of forms(w)) seen.set(k, w);
    const clashes: string[] = [];
    for (const w of [...CHEEKY_WORDS, ...UNHINGED_WORDS]) {
      for (const k of forms(w)) {
        const other = seen.get(k);
        if (other !== undefined && other !== w) clashes.push(`${w} ~ ${other}`);
      }
      for (const k of forms(w)) seen.set(k, w);
    }
    expect(clashes).toEqual([]);
  });
});

describe('wordPoolForMode', () => {
  const lower = (list: readonly string[]): Set<string> => new Set(list.map((w) => w.toLowerCase()));

  it('is the language list for family', () => {
    const family = wordPoolForMode('family');
    expect(family).toEqual(getWordList('en'));
    const adult = lower([...CHEEKY_WORDS, ...UNHINGED_WORDS]);
    expect(family.filter((w) => adult.has(w.toLowerCase()))).toEqual([]);
    expect(lower(family).has('dildo')).toBe(false);
  });

  it('is the cheeky and unhinged tiers alone for unhinged, big enough for a long game without repeats', () => {
    const unhinged = wordPoolForMode('unhinged');
    expect(unhinged).toEqual(TIER_WORDS.unhinged);
    expect(lower(unhinged)).toEqual(lower([...CHEEKY_WORDS, ...UNHINGED_WORDS]));
    expect(lower(unhinged).size).toBe(unhinged.length);
    // No family word dilutes an adult room.
    const family = lower(getWordList('en'));
    expect(unhinged.filter((w) => family.has(w.toLowerCase()))).toEqual([]);
    // Big enough that a long game keeps offering fresh choices (only chosen words are excluded).
    expect(unhinged.length).toBeGreaterThanOrEqual(480);
    expect(TIER_WORDS.family).toEqual([]);
  });

  it('returns a fresh array, so a caller cannot change the pack', () => {
    wordPoolForMode('family').push('zzyzx');
    wordPoolForMode('unhinged').push('zzyzx');
    expect(wordPoolForMode('family')).not.toContain('zzyzx');
    expect(wordPoolForMode('unhinged')).not.toContain('zzyzx');
  });
});

describe('pickWords', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];

  it('picks distinct words, deterministic with an injected rng', () => {
    expect(pickWords(pool, 3, [], () => 0)).toEqual(['a', 'b', 'c']);
    const picked = pickWords(pool, 3);
    expect(new Set(picked).size).toBe(3);
    for (const w of picked) expect(pool).toContain(w);
  });

  it('avoids excluded words while enough remain, then falls back to the whole pool', () => {
    expect(pickWords(pool, 3, ['A', 'b'], () => 0)).toEqual(['c', 'd', 'e']);
    expect(pickWords(pool, 3, ['a', 'b', 'c'], () => 0)).toEqual(['a', 'b', 'c']);
    expect(pickWords(['x'], 3, [], () => 0)).toEqual(['x']);
    expect(pickWords([], 3)).toEqual([]);
  });
});

describe('buildWordPool', () => {
  it('merges custom words into the language list or uses them exclusively', () => {
    const merged = buildWordPool('en', ['zzyzx', 'cat', ' Zzyzx '], false);
    expect(merged).toContain('zzyzx');
    expect(merged.filter((w) => w.toLowerCase() === 'zzyzx')).toHaveLength(1);
    expect(merged.filter((w) => w === 'cat')).toHaveLength(1);
    expect(buildWordPool('en', ['one', 'two'], true)).toEqual(['one', 'two']);
    // customOnly with no custom words falls back to the language list.
    expect(buildWordPool('en', [], true).length).toBe(getWordList('en').length);
    // The content mode picks the pack (Unhinged: the adult tiers only), custom words still merge in once.
    const unhinged = buildWordPool('en', ['zzyzx', 'dildo', 'cat'], false, 'unhinged');
    expect(unhinged.length).toBe(wordPoolForMode('unhinged').length + 2);
    expect(unhinged).toContain('cat');
    expect(unhinged.filter((w) => w.toLowerCase() === 'dildo')).toHaveLength(1);
    expect(unhinged).not.toContain('elephant');
    // Custom-only still wins over the content mode.
    expect(buildWordPool('en', ['one', 'two'], true, 'unhinged')).toEqual(['one', 'two']);
    expect(buildWordPool('en', [], true, 'unhinged')).toEqual(wordPoolForMode('unhinged'));
  });
});
