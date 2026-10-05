/** Which prompts a game draws from, and drawing without repeats while the pool lasts. */
import { PROMPTS } from '../../../shared/games/quipgame/prompts.js';
import type { QuipgameSettings } from '../../../shared/games/quipgame/protocol.js';
import type { Gx } from './state.js';

/** The pack (clean, plus cheeky when enabled) merged with the host's prompts, or the host's alone; deduped case-insensitively. */
export function promptPool(settings: QuipgameSettings): string[] {
  const pack = PROMPTS.filter((p) => p.tier === 'clean' || settings.cheeky).map((p) => p.text);
  const source = settings.customPromptsOnly && settings.customPrompts.length > 0 ? settings.customPrompts : [...pack, ...settings.customPrompts];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of source) {
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * Draws `count` prompts nobody has seen this game. When the pool runs dry the used list is
 * cleared and prompts may come back, but never twice in the same draw while the pool allows it.
 */
export function drawPrompts(gx: Gx, count: number): string[] {
  const { data, ctx } = gx;
  const pool = promptPool(ctx.settings);
  const picked: string[] = [];
  let available = pool.filter((t) => !data.usedPrompts.includes(t.toLowerCase()));
  while (picked.length < count) {
    if (available.length === 0) {
      data.usedPrompts = [];
      available = pool.filter((t) => !picked.includes(t));
      if (available.length === 0) available = [...pool];
    }
    const i = Math.min(available.length - 1, Math.floor(ctx.rng() * available.length));
    const [text] = available.splice(i, 1);
    picked.push(text);
    data.usedPrompts.push(text.toLowerCase());
  }
  return picked;
}
