import { describe, expect, it } from 'vitest';
import { maskWord, parseWordList, revealableIndices } from './words.js';

describe('shared word helpers', () => {
  it('masks letters and digits only, and parses a typed list within its limits', () => {
    expect(revealableIndices('ice-cream 2')).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 10]);
    expect(maskWord('ice cream', [0])).toBe('i__ _____');
    expect(parseWordList('cat, Dog\n dog ,  hot   dog , toolongword', { maxCount: 10, maxLength: 8 })).toEqual(['cat', 'Dog', 'hot dog']);
    expect(parseWordList('a,b,c', { maxCount: 2, maxLength: 8 })).toEqual(['a', 'b']);
  });
});
