import { describe, expect, it } from 'vitest';
import { parseCustomWords } from '@shared/games/skribble/protocol';
import { parseCustomPrompts, splitCustomPrompts } from '@shared/games/quipgame/protocol';
import { splitWordList } from '@shared/platform/words';
import { WORD_FILE_MAX_BYTES, looksLikeText, mergeWordFile, wordFileProblem, wordFileSummary } from './wordFile';

const WORDS = { one: 'word', many: 'words' };
const SKRIBBLE = { split: splitWordList, parse: parseCustomWords };
const QUIP = { split: splitCustomPrompts, parse: parseCustomPrompts };

describe('a word list from a .txt file', () => {
  it('takes plain text only, under 100 KB, and a .txt file a browser gave no type', () => {
    expect(wordFileProblem({ name: 'words.txt', type: 'text/plain', size: 120 })).toBeNull();
    expect(wordFileProblem({ name: 'WORDS.TXT', type: '', size: 120 })).toBeNull();
    expect(wordFileProblem({ name: 'words.csv', type: 'text/csv', size: 120 })).toBe('Pick a plain .txt file.');
    expect(wordFileProblem({ name: 'cat.png', type: 'image/png', size: 120 })).toBe('Pick a plain .txt file.');
    expect(wordFileProblem({ name: 'words', type: '', size: 120 })).toBe('Pick a plain .txt file.');
    expect(wordFileProblem({ name: 'big.txt', type: 'text/plain', size: WORD_FILE_MAX_BYTES })).toBeNull();
    expect(wordFileProblem({ name: 'big.txt', type: 'text/plain', size: WORD_FILE_MAX_BYTES + 1 })).toBe('That file is too big. Keep it under 100 KB.');
    expect(looksLikeText('cat\ndog')).toBe(true);
    expect(looksLikeText('PK\u0003\u0004\u0000')).toBe(false);
  });

  it('splits the file the way typed words are split and adds only what is new, after what is there', () => {
    const merged = mergeWordFile('cat, dog', 'Dog\nhot   dog, fish\n\n  bird  \r\n', SKRIBBLE);
    expect(merged.text).toBe('cat\ndog\nhot dog\nfish\nbird');
    expect(merged).toMatchObject({ added: 3, repeats: 1, tooLong: 0, overLimit: 0 });
    expect(wordFileSummary(merged, WORDS)).toBe('Added 3 words. Left out 1 repeat.');
  });

  it('counts repeats inside the file and too-long words among what it left out', () => {
    const long = 'x'.repeat(40);
    const merged = mergeWordFile('', `Dog, hot dog, fish, bird, bird\n${long}`, SKRIBBLE);
    expect(merged.text).toBe('Dog\nhot dog\nfish\nbird');
    expect(merged).toMatchObject({ added: 4, repeats: 1, tooLong: 1, overLimit: 0 });
    expect(wordFileSummary(merged, WORDS)).toBe('Added 4 words. Left out 1 repeat and 1 too long.');
  });

  it('applies the list limit and says how many did not fit', () => {
    const typed = 'a1, a2, a3, a4, a5';
    const many = Array.from({ length: 600 }, (_, i) => `word${i}`).join('\n');
    const merged = mergeWordFile(typed, many, SKRIBBLE);
    expect(merged.text.split('\n')).toHaveLength(500);
    expect(merged).toMatchObject({ added: 495, repeats: 0, tooLong: 0, overLimit: 105 });
    expect(wordFileSummary(merged, WORDS)).toBe('Added 495 words. Left out 105 over the limit.');
    // Every entry of the file is either added or counted as left out.
    expect(merged.added + merged.repeats + merged.tooLong + merged.overLimit).toBe(600);
  });

  it('says so when a file adds nothing', () => {
    const merged = mergeWordFile('cat', 'cat\nCAT', SKRIBBLE);
    expect(merged).toEqual({ text: 'cat', added: 0, repeats: 2, tooLong: 0, overLimit: 0 });
    expect(wordFileSummary(merged, WORDS)).toBe('No new words in that file. Left out 2 repeats.');
    expect(wordFileSummary(mergeWordFile('', '', SKRIBBLE), WORDS)).toBe('No new words in that file.');
    expect(wordFileSummary({ text: 'a', added: 1, repeats: 2, tooLong: 1, overLimit: 3 }, WORDS)).toBe('Added 1 word. Left out 2 repeats, 1 too long and 3 over the limit.');
  });

  it("reads a game's own list the same way: Quip Game's prompts are one per line", () => {
    const merged = mergeWordFile('', 'The worst gift, ever\nA bad name for a boat\nthe worst gift, ever', QUIP);
    expect(merged.text).toBe('The worst gift, ever\nA bad name for a boat');
    expect(wordFileSummary(merged, { one: 'prompt', many: 'prompts' })).toBe('Added 2 prompts. Left out 1 repeat.');
  });
});
