import { describe, expect, it } from 'vitest';
import { compactGuess, containsWord, isCloseGuess, isCorrectGuess, levenshtein, normalizeGuess } from './guess';

describe('normalizeGuess', () => {
  it('lower-cases, trims, strips diacritics and punctuation, collapses whitespace', () => {
    expect(normalizeGuess('  Ice   Cream! ')).toBe('ice cream');
    expect(normalizeGuess('Café')).toBe('cafe');
    expect(normalizeGuess("Rock'n-roll")).toBe("rock'n-roll");
    expect(normalizeGuess('')).toBe('');
  });
});

describe('compactGuess', () => {
  it('drops spaces, hyphens and apostrophes after normalising', () => {
    expect(compactGuess(" Ice-Cream's ")).toBe('icecreams');
    expect(compactGuess('')).toBe('');
  });
});

describe('isCorrectGuess', () => {
  it('matches ignoring case, spacing and accents but never matches empty input', () => {
    expect(isCorrectGuess('APPLE', 'apple')).toBe(true);
    expect(isCorrectGuess(' ice  cream ', 'ice cream')).toBe(true);
    expect(isCorrectGuess('cafe', 'café')).toBe(true);
    expect(isCorrectGuess('icecream', 'ice cream')).toBe(true); // typed into letter tiles without the space
    expect(isCorrectGuess('hot-dog', 'hot dog')).toBe(true);
    expect(isCorrectGuess('ice cream', 'icecream')).toBe(true);
    expect(isCorrectGuess('apples', 'apple')).toBe(false);
    expect(isCorrectGuess('', 'apple')).toBe(false);
    expect(isCorrectGuess('!!!', 'apple')).toBe(false);
  });
});

describe('levenshtein / isCloseGuess', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  it('is close within one edit for short words and two for long words, never exact', () => {
    expect(isCloseGuess('aple', 'apple')).toBe(true);
    expect(isCloseGuess('apple', 'apple')).toBe(false);
    expect(isCloseGuess('appel', 'apple')).toBe(false); // two edits on a 5-letter word
    expect(isCloseGuess('cat', 'car')).toBe(false); // too short to be "close"
    expect(isCloseGuess('elefant', 'elephant')).toBe(true);
    expect(isCloseGuess('elefunt', 'elephant')).toBe(false);
    expect(isCloseGuess('', 'apple')).toBe(false);
    expect(isCloseGuess('applesauce', 'apple')).toBe(false);
    expect(isCloseGuess('icecreem', 'ice cream')).toBe(true); // separators never count as edits
  });
});

describe('containsWord', () => {
  it('detects whole-word and split leaks of single words', () => {
    expect(containsWord('it is an Apple!', 'apple')).toBe(true);
    expect(containsWord('apple', 'apple')).toBe(true);
    expect(containsWord('a-p-p-l-e', 'apple')).toBe(true);
    expect(containsWord('ap ple', 'apple')).toBe(true);
    expect(containsWord('pineapple', 'apple')).toBe(true); // substring of a longer word still leaks
    expect(containsWord('cats are nice', 'cat')).toBe(false); // short words must match whole tokens
    expect(containsWord('nothing here', 'apple')).toBe(false);
    expect(containsWord('', 'apple')).toBe(false);
  });

  it('detects multi-word answers as a phrase', () => {
    expect(containsWord('I love ICE cream', 'ice cream')).toBe(true);
    expect(containsWord('ice and cream', 'ice cream')).toBe(false);
  });
});
