import { describe, expect, it } from 'vitest';
import { maskWord, parseWordList, revealableIndices } from '../../platform/words.js';
import { UNHINGED_WORDS } from '../skribble/words/unhinged.js';
import { countLetter, hangmanMask, hangmanWordPool, hangmanWords, isFullyRevealed, isValidHangmanWord, lettersOf, normalizeHangmanWord, pickHangmanWords } from './words.js';

describe('shared word helpers', () => {
  it('masks letters and digits only, and parses a typed list within its limits', () => {
    expect(revealableIndices('ice-cream 2')).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 10]);
    expect(maskWord('ice cream', [0])).toBe('i__ _____');
    expect(parseWordList('cat, Dog\n dog ,  hot   dog , toolongword', { maxCount: 10, maxLength: 8 })).toEqual(['cat', 'Dog', 'hot dog']);
    expect(parseWordList('a,b,c', { maxCount: 2, maxLength: 8 })).toEqual(['a', 'b']);
  });
});

describe('hangman words', () => {
  it('normalises to upper case and accepts 3-24 letters of letters, spaces, hyphens and apostrophes', () => {
    expect(normalizeHangmanWord("  ice   cream ")).toBe('ICE CREAM');
    expect(isValidHangmanWord('ICE CREAM')).toBe(true);
    expect(isValidHangmanWord("T-SHIRT")).toBe(true);
    expect(isValidHangmanWord("PLUMBER'S CRACK")).toBe(true);
    expect(isValidHangmanWord('AB')).toBe(false);
    expect(isValidHangmanWord('A'.repeat(25))).toBe(false);
    expect(isValidHangmanWord('A'.repeat(24))).toBe(true);
    expect(isValidHangmanWord('3D PRINTER')).toBe(false);
    expect(isValidHangmanWord('CAFÉ')).toBe(false);
    expect(isValidHangmanWord('')).toBe(false);
    expect(lettersOf("DON'T-GO")).toEqual(['D', 'O', 'N', 'T', 'G', 'O']);
    expect(hangmanWords(['apple', 'Apple', '3d printer', 'hot dog', 'ab'])).toEqual(['APPLE', 'HOT DOG']);
  });

  it('folds the typographic apostrophes and dashes phone keyboards insert, so they validate and compare', () => {
    expect(normalizeHangmanWord('o\u2019clock')).toBe("O'CLOCK");
    expect(normalizeHangmanWord('rock \u2018n\u2019 roll')).toBe("ROCK 'N' ROLL");
    expect(normalizeHangmanWord('Hawai\u02BBi'.replace('\u02BB', '\u02BC'))).toBe("HAWAI'I");
    expect(normalizeHangmanWord('ice\u2010cream')).toBe('ICE-CREAM');
    expect(normalizeHangmanWord('ice\u2013cream')).toBe('ICE-CREAM');
    expect(normalizeHangmanWord('ice\u2014cream')).toBe('ICE-CREAM');
    expect(normalizeHangmanWord('ice\u2212cream')).toBe('ICE-CREAM');
    for (const typed of ['o\u2019clock', 'ice\u2013cream', 't\u2014shirt', 'don\u2018t go']) expect(isValidHangmanWord(normalizeHangmanWord(typed))).toBe(true);
    expect(hangmanWords(['o\u2019clock', "o'clock"])).toEqual(["O'CLOCK"]);
  });

  it('builds the mask from guessed letters and knows when the word is out', () => {
    expect(hangmanMask('ICE CREAM', [])).toBe('___ _____');
    expect(hangmanMask('ICE CREAM', ['C', 'E'])).toBe('_CE C_E__');
    expect(hangmanMask("T-SHIRT", ['T'])).toBe('T-____T');
    expect(countLetter('BANANA', 'A')).toBe(3);
    expect(countLetter('BANANA', 'Z')).toBe(0);
    expect(isFullyRevealed('BANANA', ['B', 'A', 'N'])).toBe(true);
    expect(isFullyRevealed('BANANA', ['B', 'A'])).toBe(false);
  });

  it('draws the pool from the content mode plus custom words, custom only when asked and possible', () => {
    const family = hangmanWordPool('family', [], false);
    expect(family.length).toBeGreaterThan(400);
    for (const w of family) expect(isValidHangmanWord(w)).toBe(true);
    const unhinged = hangmanWordPool('unhinged', [], false);
    expect(unhinged.length).toBeGreaterThan(family.length);
    expect(unhinged).toContain(normalizeHangmanWord(UNHINGED_WORDS[0]));
    expect(family).not.toContain(normalizeHangmanWord(UNHINGED_WORDS[0]));
    // Every unhinged pack word is playable, none is dropped from the pool.
    for (const w of UNHINGED_WORDS) expect(isValidHangmanWord(normalizeHangmanWord(w))).toBe(true);
    expect(hangmanWordPool('family', ['zebra crossing', 'zebra crossing', '42'], false)).toEqual([...family, 'ZEBRA CROSSING']);
    expect(hangmanWordPool('family', ['zebra crossing', '42'], true)).toEqual(['ZEBRA CROSSING']);
    // Custom only with nothing playable falls back to the pack.
    expect(hangmanWordPool('family', ['42', 'ab'], true)).toEqual(family);
    // Played words are avoided while enough remain; a pool too small for that is reused whole.
    expect(pickHangmanWords(['A B C', 'D E F', 'G H I', 'J K L'], 3, ['A B C'], () => 0)).toEqual(['D E F', 'G H I', 'J K L']);
    expect(pickHangmanWords(['A B C', 'D E F', 'G H I'], 3, ['A B C'], () => 0)).toEqual(['A B C', 'D E F', 'G H I']);
  });
});
