import { describe, expect, it } from 'vitest';
import { FALLBACK_ANSWERS, PROMPTS } from './prompts.js';
import { QUIPGAME_ANSWER_MAX_LENGTH, QUIPGAME_SETTINGS_LIMITS } from './protocol.js';

describe('the prompt pack', () => {
  it('holds at least 300 unique prompts in both tiers, each 1 to 120 characters', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(300);
    expect(new Set(PROMPTS.map((p) => p.text.toLowerCase())).size).toBe(PROMPTS.length);
    expect(PROMPTS.some((p) => p.tier === 'clean')).toBe(true);
    expect(PROMPTS.some((p) => p.tier === 'cheeky')).toBe(true);
    for (const p of PROMPTS) {
      expect(p.text.length).toBeGreaterThanOrEqual(1);
      expect(p.text.length).toBeLessThanOrEqual(QUIPGAME_SETTINGS_LIMITS.customPrompts.maxLength);
      expect(p.text).toBe(p.text.trim());
      expect(['clean', 'cheeky']).toContain(p.tier);
    }
  });

  it('has enough clean prompts for a full game of eight without repeats', () => {
    // Two regular rounds of eight prompts plus one for the final.
    expect(PROMPTS.filter((p) => p.tier === 'clean').length).toBeGreaterThanOrEqual(17);
  });

  it('ships fallback answers that are valid answers themselves', () => {
    expect(FALLBACK_ANSWERS.length).toBeGreaterThan(0);
    for (const a of FALLBACK_ANSWERS) {
      expect(a.length).toBeGreaterThanOrEqual(1);
      expect(a.length).toBeLessThanOrEqual(QUIPGAME_ANSWER_MAX_LENGTH);
    }
  });
});
