/**
 * Hangman's words: the shape a word must have (letters, spaces, hyphens, apostrophes; 3-24
 * letters, kept upper case), the pool a room draws from (Skribble's packs by content mode merged
 * with the host's custom words) and the mask built from the letters guessed so far.
 */
import type { ContentMode } from '../../platform/settings.js';
import { maskWord } from '../../platform/words.js';
import { pickWords, wordPoolForMode } from '../skribble/words/index.js';
import { HANGMAN_WORD_LETTERS, HANGMAN_WORD_MAX_CHARS } from './protocol.js';

/**
 * Trims, collapses spaces, upper-cases and folds the typographic apostrophes and dashes phone
 * keyboards insert (’ ‐ – —) to their ASCII forms; the caller checks the result with
 * isValidHangmanWord. Typed guesses go through the same function, so they compare to the word.
 */
export function normalizeHangmanWord(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/** Upper-case letters of a normalised word, in order, duplicates included. */
export function lettersOf(word: string): string[] {
  return word.split('').filter((ch) => /^[A-Z]$/.test(ch));
}

export function isValidHangmanWord(word: string): boolean {
  if (word.length > HANGMAN_WORD_MAX_CHARS || !/^[A-Z' -]+$/.test(word)) return false;
  const letters = lettersOf(word).length;
  return letters >= HANGMAN_WORD_LETTERS.min && letters <= HANGMAN_WORD_LETTERS.max;
}

/** Normalises a list and keeps the words Hangman can play, deduplicated. */
export function hangmanWords(words: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of words) {
    const word = normalizeHangmanWord(raw);
    if (isValidHangmanWord(word) && !out.includes(word)) out.push(word);
  }
  return out;
}

/**
 * The pool for a room: the custom words alone when the host asked for that (and typed any that
 * qualify), otherwise the pack for the content mode merged with them. Never empty.
 */
export function hangmanWordPool(mode: ContentMode, customWords: readonly string[], customOnly: boolean): string[] {
  const custom = hangmanWords(customWords);
  if (customOnly && custom.length > 0) return custom;
  return hangmanWords([...wordPoolForMode(mode), ...custom]);
}

/** `count` choices from the pool, avoiding the words already played while enough remain. */
export function pickHangmanWords(pool: readonly string[], count: number, used: readonly string[], rng: () => number): string[] {
  return pickWords(pool, count, used, rng);
}

/** The mask for `word` given the upper-case letters guessed so far. */
export function hangmanMask(word: string, guessed: readonly string[]): string {
  const revealed: number[] = [];
  for (let i = 0; i < word.length; i++) if (guessed.includes(word[i])) revealed.push(i);
  return maskWord(word, revealed);
}

/** How many letters of `word` are `letter`. */
export function countLetter(word: string, letter: string): number {
  return lettersOf(word).filter((ch) => ch === letter).length;
}

/** True once every letter of the word has been guessed. */
export function isFullyRevealed(word: string, guessed: readonly string[]): boolean {
  return lettersOf(word).every((ch) => guessed.includes(ch));
}
