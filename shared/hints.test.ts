import { describe, expect, it } from 'vitest';
import { hintCountFor, hintRevealOrder, hintSchedule, maskWord, revealableIndices } from './hints';

describe('revealableIndices / maskWord', () => {
  it('hides letters and digits but keeps separators', () => {
    expect(revealableIndices('ice cream')).toEqual([0, 1, 2, 4, 5, 6, 7, 8]);
    expect(maskWord('ice cream')).toBe('___ _____');
    expect(maskWord('ice cream', [0])).toBe('i__ _____');
    expect(maskWord('t-rex', [1, 2])).toBe('_-r__');
    expect(maskWord("rock'n'roll")).toBe("____'_'____");
    expect(maskWord('r2d2', [1])).toBe('_2__');
    expect(maskWord('')).toBe('');
  });

  it('ignores revealed indices that are not letters', () => {
    expect(maskWord('ice cream', [3])).toBe('___ _____');
  });
});

describe('hintCountFor', () => {
  it('never reveals more than half of the letters', () => {
    expect(hintCountFor('apple', 2)).toBe(2);
    expect(hintCountFor('apple', 5)).toBe(2);
    expect(hintCountFor('ab', 5)).toBe(1);
    expect(hintCountFor('a', 5)).toBe(0);
    expect(hintCountFor('apple', 0)).toBe(0);
    expect(hintCountFor('ice cream', 5)).toBe(4);
  });
});

describe('hintRevealOrder', () => {
  it('returns distinct revealable indices, deterministic with an injected rng', () => {
    const order = hintRevealOrder('ice cream', 4, () => 0);
    expect(order).toHaveLength(4);
    expect(new Set(order).size).toBe(4);
    for (const i of order) expect(revealableIndices('ice cream')).toContain(i);
    expect(hintRevealOrder('ice cream', 4, () => 0)).toEqual(order);
    expect(hintRevealOrder('abc', 10)).toHaveLength(3);
    expect(hintRevealOrder('abc', 0)).toEqual([]);
  });

  it('covers every index over many random draws', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(hintRevealOrder('apple', 1)[0]);
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('hintSchedule', () => {
  it('spreads reveals evenly inside the turn', () => {
    expect(hintSchedule(60_000, 2)).toEqual([20_000, 40_000]);
    expect(hintSchedule(80_000, 3)).toEqual([20_000, 40_000, 60_000]);
    expect(hintSchedule(60_000, 0)).toEqual([]);
    const s = hintSchedule(45_000, 4);
    expect(s[0]).toBeGreaterThan(0);
    expect(s[s.length - 1]).toBeLessThan(45_000);
  });
});
