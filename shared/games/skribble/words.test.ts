import { describe, expect, it } from 'vitest';
import { WORD_LISTS, buildWordPool, getWordList, pickWords } from './words/index.js';

describe('word lists', () => {
  it('ships a sizeable, deduplicated English list', () => {
    const en = getWordList('en');
    expect(en.length).toBeGreaterThan(500);
    expect(new Set(en.map((w) => w.toLowerCase())).size).toBe(en.length);
    for (const w of en) expect(w).toBe(w.trim());
    expect(WORD_LISTS.en).toBe(en);
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
  });
});
