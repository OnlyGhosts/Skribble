import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUIPGAME_SETTINGS,
  QUIPGAME_ANSWER_MAX_LENGTH,
  QUIPGAME_SETTINGS_LIMITS,
  answerTextSchema,
  normalizeQuipgameSettings,
  parseCustomPrompts,
  quipgameClientMessageSchema,
  quipgameSettingsSchema,
} from './protocol.js';
import { scoreMatchup } from './scoring.js';

const patchSchema = quipgameSettingsSchema.partial();

describe('quipgame settings schema', () => {
  it('accepts the defaults and rejects out-of-range values', () => {
    expect(quipgameSettingsSchema.safeParse(DEFAULT_QUIPGAME_SETTINGS).success).toBe(true);
    expect(patchSchema.safeParse({}).success).toBe(true);
    expect(patchSchema.safeParse({ writeSeconds: 29 }).success).toBe(false);
    expect(patchSchema.safeParse({ writeSeconds: 181 }).success).toBe(false);
    expect(patchSchema.safeParse({ voteSeconds: 9 }).success).toBe(false);
    expect(patchSchema.safeParse({ resultsSeconds: 21 }).success).toBe(false);
    expect(patchSchema.safeParse({ resultsSeconds: 4.5 }).success).toBe(false);
    expect(patchSchema.safeParse({ cheeky: 'yes' }).success).toBe(false);
    expect(patchSchema.safeParse({ customPrompts: ['x'.repeat(QUIPGAME_SETTINGS_LIMITS.customPrompts.maxLength + 1)] }).success).toBe(false);
    expect(patchSchema.safeParse({ customPrompts: Array.from({ length: 201 }, (_, i) => `p${i}`) }).success).toBe(false);
    expect(patchSchema.safeParse({ maxPlayers: 3 })).toMatchObject({ success: true, data: {} });
  });
});

describe('parseCustomPrompts', () => {
  it('splits on newlines only, cleans each line, dedupes case-insensitively and caps the count', () => {
    expect(parseCustomPrompts('The worst thing to say, honestly\n  A   bad  name \nthe WORST thing to say, honestly\n\n \n')).toEqual([
      'The worst thing to say, honestly',
      'A bad name',
    ]);
    expect(parseCustomPrompts('')).toEqual([]);
    expect(parseCustomPrompts('x'.repeat(QUIPGAME_SETTINGS_LIMITS.customPrompts.maxLength + 1))).toEqual([]);
    expect(parseCustomPrompts('tab\there\u0007')).toEqual(['tab here']);
    const many = Array.from({ length: QUIPGAME_SETTINGS_LIMITS.customPrompts.maxCount + 50 }, (_, i) => `prompt ${i}`).join('\n');
    expect(parseCustomPrompts(many)).toHaveLength(QUIPGAME_SETTINGS_LIMITS.customPrompts.maxCount);
  });
});

describe('normalizeQuipgameSettings', () => {
  it('normalises custom prompts and only allows customPromptsOnly with enough of them', () => {
    const next = normalizeQuipgameSettings({ ...DEFAULT_QUIPGAME_SETTINGS, customPrompts: [' One ', 'two', 'ONE'], customPromptsOnly: true });
    expect(next.customPrompts).toEqual(['One', 'two']);
    expect(next.customPromptsOnly).toBe(false);
    expect(DEFAULT_QUIPGAME_SETTINGS.customPrompts).toEqual([]);
    const prompts = Array.from({ length: QUIPGAME_SETTINGS_LIMITS.customPrompts.minForOnly }, (_, i) => `prompt ${i}`);
    expect(normalizeQuipgameSettings({ ...DEFAULT_QUIPGAME_SETTINGS, customPrompts: prompts, customPromptsOnly: true }).customPromptsOnly).toBe(true);
  });
});

describe('client messages', () => {
  it('cleans answers before the 1-80 rule applies', () => {
    expect(answerTextSchema.parse('  a   fine \t answer\u0001 ')).toBe('a fine answer');
    expect(answerTextSchema.safeParse('   ').success).toBe(false);
    expect(answerTextSchema.safeParse('x'.repeat(QUIPGAME_ANSWER_MAX_LENGTH)).success).toBe(true);
    expect(answerTextSchema.safeParse('x'.repeat(QUIPGAME_ANSWER_MAX_LENGTH + 1)).success).toBe(false);
    expect(quipgameClientMessageSchema.safeParse({ t: 'answer', promptId: 'r1-p0', text: ' hi ' })).toMatchObject({ success: true, data: { text: 'hi' } });
  });

  it('bounds votes and rankings', () => {
    expect(quipgameClientMessageSchema.safeParse({ t: 'vote', choice: 'c' }).success).toBe(false);
    expect(quipgameClientMessageSchema.safeParse({ t: 'rank', answerIds: [] }).success).toBe(false);
    expect(quipgameClientMessageSchema.safeParse({ t: 'rank', answerIds: ['1', '2', '3', '4'] }).success).toBe(false);
    expect(quipgameClientMessageSchema.safeParse({ t: 'next' }).success).toBe(true);
  });
});

describe('scoreMatchup', () => {
  it('splits the pool by votes, times the multiplier', () => {
    expect(scoreMatchup(3, 1, 1)).toEqual({ a: 750, b: 250, flawless: null, outcome: 'a' });
    expect(scoreMatchup(3, 1, 2)).toEqual({ a: 1500, b: 500, flawless: null, outcome: 'a' });
    expect(scoreMatchup(1, 2, 1)).toEqual({ a: 333, b: 667, flawless: null, outcome: 'b' });
  });

  it('splits a tie evenly, scores nothing without votes and pays the flawless bonus only from two votes', () => {
    expect(scoreMatchup(2, 2, 1)).toEqual({ a: 500, b: 500, flawless: null, outcome: 'tie' });
    expect(scoreMatchup(0, 0, 2)).toEqual({ a: 0, b: 0, flawless: null, outcome: 'noVotes' });
    expect(scoreMatchup(1, 0, 1)).toEqual({ a: 1000, b: 0, flawless: null, outcome: 'a' });
    expect(scoreMatchup(0, 2, 1)).toEqual({ a: 0, b: 1250, flawless: 'b', outcome: 'b' });
    expect(scoreMatchup(3, 0, 2)).toEqual({ a: 2500, b: 0, flawless: 'a', outcome: 'a' });
  });
});
