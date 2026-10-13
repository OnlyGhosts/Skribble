import { describe, expect, it } from 'vitest';
import { CONTENT_MODES } from '../../platform/settings.js';
import { FALLBACK_ANSWERS, PROMPTS, promptsForContentMode, tiersForContentMode } from './prompts.js';
import { QUIPGAME_ANSWER_MAX_LENGTH, QUIPGAME_SETTINGS_LIMITS } from './protocol.js';

describe('the prompt pack', () => {
  it('holds at least 300 prompts, unique across every tier, each 1 to 120 characters', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(300);
    expect(new Set(PROMPTS.map((p) => p.text.toLowerCase())).size).toBe(PROMPTS.length);
    for (const tier of ['clean', 'cheeky', 'unhinged'] as const) expect(PROMPTS.some((p) => p.tier === tier)).toBe(true);
    for (const p of PROMPTS) {
      expect(p.text.length).toBeGreaterThanOrEqual(1);
      expect(p.text.length).toBeLessThanOrEqual(QUIPGAME_SETTINGS_LIMITS.customPrompts.maxLength);
      expect(p.text).toBe(p.text.trim());
      expect(['clean', 'cheeky', 'unhinged']).toContain(p.tier);
    }
  });

  it('has enough clean prompts for a full game of eight without repeats, and at least 100 unhinged ones', () => {
    // Two regular rounds of eight prompts plus one for the final.
    expect(PROMPTS.filter((p) => p.tier === 'clean').length).toBeGreaterThanOrEqual(17);
    expect(PROMPTS.filter((p) => p.tier === 'unhinged').length).toBeGreaterThanOrEqual(100);
  });

  it('picks the tiers by content mode: family is clean only, cheeky adds cheeky, unhinged drops clean', () => {
    expect(tiersForContentMode('family')).toEqual(['clean']);
    expect(tiersForContentMode('cheeky')).toEqual(['clean', 'cheeky']);
    expect(tiersForContentMode('unhinged')).toEqual(['cheeky', 'unhinged']);
    for (const mode of CONTENT_MODES) {
      const tiers = tiersForContentMode(mode);
      const pool = promptsForContentMode(mode);
      expect(pool.length).toBe(PROMPTS.filter((p) => tiers.includes(p.tier)).length);
      for (const p of pool) expect(tiers).toContain(p.tier);
    }
    expect(promptsForContentMode('family').every((p) => p.tier === 'clean')).toBe(true);
    expect(promptsForContentMode('unhinged').some((p) => p.tier === 'clean')).toBe(false);
  });

  it('ships fallback answers that are valid answers themselves', () => {
    expect(FALLBACK_ANSWERS.length).toBeGreaterThan(0);
    for (const a of FALLBACK_ANSWERS) {
      expect(a.length).toBeGreaterThanOrEqual(1);
      expect(a.length).toBeLessThanOrEqual(QUIPGAME_ANSWER_MAX_LENGTH);
    }
  });
});
