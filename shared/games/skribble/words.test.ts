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

describe('wordPoolForMode', () => {
  const lower = (list: readonly string[]): Set<string> => new Set(list.map((w) => w.toLowerCase()));

  it('is the language list for family and grows by tier, deduplicated across lists', () => {
    const family = wordPoolForMode('family');
    expect(family).toEqual(getWordList('en'));
    const cheeky = wordPoolForMode('cheeky');
    const unhinged = wordPoolForMode('unhinged');
    expect(cheeky.length).toBeGreaterThan(family.length);
    expect(unhinged.length).toBeGreaterThan(cheeky.length);
    for (const pool of [cheeky, unhinged]) expect(lower(pool).size).toBe(pool.length);
    // Every family word stays in; every tier word is reachable in its mode (a duplicate of the language list once).
    for (const w of family) expect(lower(cheeky).has(w.toLowerCase())).toBe(true);
    for (const w of CHEEKY_WORDS) expect(lower(cheeky).has(w.toLowerCase())).toBe(true);
    for (const w of [...CHEEKY_WORDS, ...UNHINGED_WORDS]) expect(lower(unhinged).has(w.toLowerCase())).toBe(true);
    // Family never leaks a tier word that is not also in the language list.
    const tierOnly = TIER_WORDS.unhinged.filter((w) => !lower(family).has(w.toLowerCase()));
    expect(tierOnly.length).toBeGreaterThan(100);
    for (const w of tierOnly) expect(lower(family).has(w.toLowerCase())).toBe(false);
    expect(lower(cheeky).has('porn')).toBe(false);
    expect(lower(unhinged).has('porn')).toBe(true);
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
    // The content mode widens the pack, custom words still merge in once.
    const unhinged = buildWordPool('en', ['zzyzx', 'porn'], false, 'unhinged');
    expect(unhinged.length).toBe(wordPoolForMode('unhinged').length + 1);
    expect(buildWordPool('en', ['one', 'two'], true, 'unhinged')).toEqual(['one', 'two']);
  });
});
