import { describe, expect, it } from 'vitest';
import { maskWord } from '@shared/hints';
import { draftLetters, hintMatches, layoutGuess, letterCountFor, type GuessSlot } from './mask';

function letterSlots(groups: GuessSlot[][]): Extract<GuessSlot, { kind: 'letter' }>[] {
  return groups.flat().filter((s): s is Extract<GuessSlot, { kind: 'letter' }> => s.kind === 'letter');
}

describe('letterCountFor', () => {
  it('counts hidden and revealed letters but not separators', () => {
    expect(letterCountFor('_____')).toBe(5);
    expect(letterCountFor('i__ _____')).toBe(8);
    expect(letterCountFor("___-__ __'_")).toBe(8);
    expect(letterCountFor('')).toBe(0);
  });

  it('agrees with the server mask for real words', () => {
    expect(letterCountFor(maskWord('ice cream'))).toBe(8);
    expect(letterCountFor(maskWord("rock 'n' roll"))).toBe(9);
  });
});

describe('draftLetters', () => {
  it('keeps letters and digits only, by code point', () => {
    expect(draftLetters('ice cream')).toEqual(['i', 'c', 'e', 'c', 'r', 'e', 'a', 'm']);
    expect(draftLetters("rock-'n' roll 2")).toEqual(['r', 'o', 'c', 'k', 'n', 'r', 'o', 'l', 'l', '2']);
    expect(draftLetters('')).toEqual([]);
    expect(draftLetters('   ')).toEqual([]);
  });
});

describe('layoutGuess', () => {
  it('fills a single word in order and marks the next slot active', () => {
    const { groups, overflow } = layoutGuess('_____', 'ap');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual<GuessSlot[]>([
      { kind: 'letter', typed: 'a', active: false },
      { kind: 'letter', typed: 'p', active: false },
      { kind: 'letter', active: true },
      { kind: 'letter', active: false },
      { kind: 'letter', active: false },
    ]);
    expect(overflow).toEqual([]);
  });

  it('has the first slot active and nothing typed for an empty draft', () => {
    const { groups, overflow } = layoutGuess('___ __', '');
    const slots = letterSlots(groups);
    expect(slots).toHaveLength(5);
    expect(slots.map((s) => s.active)).toEqual([true, false, false, false, false]);
    expect(slots.every((s) => s.typed === undefined)).toBe(true);
    expect(overflow).toEqual([]);
  });

  it('skips the space between words, whether or not the player typed it', () => {
    const typedWithSpace = layoutGuess('___ _____', 'ice cream');
    const typedCompact = layoutGuess('___ _____', 'icecream');
    expect(typedWithSpace).toEqual(typedCompact);
    expect(typedWithSpace.groups).toHaveLength(2);
    expect(typedWithSpace.groups[0].map((s) => (s.kind === 'letter' ? s.typed : s.char))).toEqual(['i', 'c', 'e']);
    expect(typedWithSpace.groups[1].map((s) => (s.kind === 'letter' ? s.typed : s.char))).toEqual(['c', 'r', 'e', 'a', 'm']);
    expect(typedWithSpace.overflow).toEqual([]);
    // Everything is filled: no slot is active any more.
    expect(letterSlots(typedWithSpace.groups).some((s) => s.active)).toBe(false);
  });

  it('keeps a hyphen as a separator slot inside the group and types past it', () => {
    const { groups } = layoutGuess('___-__', 'hotd');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual<GuessSlot[]>([
      { kind: 'letter', typed: 'h', active: false },
      { kind: 'letter', typed: 'o', active: false },
      { kind: 'letter', typed: 't', active: false },
      { kind: 'sep', char: '-' },
      { kind: 'letter', typed: 'd', active: false },
      { kind: 'letter', active: true },
    ]);
  });

  it('places the next letter after a typed hyphen or apostrophe without consuming a slot', () => {
    const { groups } = layoutGuess("___'_", "don't");
    expect(letterSlots(groups).map((s) => s.typed)).toEqual(['d', 'o', 'n', 't']);
  });

  it('carries revealed hints in their slot and reports typed letters over them', () => {
    const mask = maskWord('apple', [0, 3]); // "a__l_"
    expect(mask).toBe('a__l_');
    const partial = layoutGuess(mask, 'ap');
    const slots = letterSlots(partial.groups);
    expect(slots[0]).toEqual({ kind: 'letter', hint: 'a', typed: 'a', active: false });
    expect(slots[1]).toEqual({ kind: 'letter', typed: 'p', active: false });
    expect(slots[2]).toEqual({ kind: 'letter', active: true });
    expect(slots[3]).toEqual({ kind: 'letter', hint: 'l', active: false });
    expect(slots[4]).toEqual({ kind: 'letter', active: false });
    expect(hintMatches(slots[0].typed ?? '', slots[0].hint ?? '')).toBe(true);

    const mismatch = letterSlots(layoutGuess(mask, 'Xpp').groups);
    expect(mismatch[0]).toEqual({ kind: 'letter', hint: 'a', typed: 'X', active: false });
    expect(hintMatches('X', 'a')).toBe(false);
  });

  it('matches hints ignoring case and accents', () => {
    expect(hintMatches('A', 'a')).toBe(true);
    expect(hintMatches('é', 'e')).toBe(true);
    expect(hintMatches('b', 'a')).toBe(false);
  });

  it('reports letters beyond the mask as overflow and keeps no slot active', () => {
    const { groups, overflow } = layoutGuess('___', 'is it a cat?');
    const slots = letterSlots(groups);
    expect(slots.map((s) => s.typed)).toEqual(['i', 's', 'i']);
    expect(slots.some((s) => s.active)).toBe(false);
    expect(overflow).toEqual(['t', 'a', 'c', 'a', 't']);
  });

  it('puts the active slot right after the last typed letter across groups', () => {
    const { groups } = layoutGuess('__ __', 'ab');
    expect(groups[0].every((s) => s.kind === 'letter' && !s.active)).toBe(true);
    expect(groups[1][0]).toEqual({ kind: 'letter', active: true });
    expect(groups[1][1]).toEqual({ kind: 'letter', active: false });
  });

  it('ignores stray double spaces in the mask', () => {
    const { groups } = layoutGuess('__  __', 'abcd');
    expect(groups).toHaveLength(2);
    expect(letterSlots(groups).map((s) => s.typed)).toEqual(['a', 'b', 'c', 'd']);
  });
});

import { describeMask, groupMetrics } from './mask';

describe('groupMetrics', () => {
  it('counts the letter tiles and separators of a group', () => {
    const { groups } = layoutGuess("___-__ __'_", '');
    expect(groupMetrics(groups[0])).toEqual({ letters: 5, seps: 1 });
    expect(groupMetrics(groups[1])).toEqual({ letters: 3, seps: 1 });
    expect(groupMetrics(layoutGuess('__________', '').groups[0])).toEqual({ letters: 10, seps: 0 });
  });
});

describe('describeMask', () => {
  it('describes the word shape when nothing is revealed', () => {
    expect(describeMask('_____')).toBe('5 letters.');
    expect(describeMask('___ _____')).toBe('8 letters in 2 words.');
    expect(describeMask('_')).toBe('1 letter.');
  });

  it('spells out revealed hint letters in place', () => {
    expect(describeMask(maskWord('apple', [0, 3]))).toBe('5 letters. Revealed: A blank blank L blank.');
    expect(describeMask('i__ __e__')).toBe('8 letters in 2 words. Revealed: I blank blank, blank blank E blank blank.');
  });
});
