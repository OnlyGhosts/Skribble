import { z } from 'zod';

export const SETTINGS_LIMITS = {
  rounds: { min: 1, max: 10 },
  drawTime: { min: 20, max: 180, step: 10 },
  maxPlayers: { min: 2, max: 20 },
  hints: { min: 0, max: 5 },
  wordChoices: { min: 2, max: 5 },
  customWords: { maxCount: 500, maxLength: 32, minForOnly: 10 },
} as const;

export const LANGUAGES = ['en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const roomSettingsSchema = z.object({
  /** Number of rounds; every player draws once per round. */
  rounds: z.number().int().min(SETTINGS_LIMITS.rounds.min).max(SETTINGS_LIMITS.rounds.max),
  /** Seconds each drawing turn lasts. */
  drawTime: z.number().int().min(SETTINGS_LIMITS.drawTime.min).max(SETTINGS_LIMITS.drawTime.max),
  maxPlayers: z.number().int().min(SETTINGS_LIMITS.maxPlayers.min).max(SETTINGS_LIMITS.maxPlayers.max),
  /** How many letters are revealed (spread over the turn) as hints. */
  hints: z.number().int().min(SETTINGS_LIMITS.hints.min).max(SETTINGS_LIMITS.hints.max),
  /** How many words the drawer picks from. */
  wordChoices: z.number().int().min(SETTINGS_LIMITS.wordChoices.min).max(SETTINGS_LIMITS.wordChoices.max),
  language: z.enum(LANGUAGES),
  /** Extra words supplied by the host. */
  customWords: z
    .array(z.string().trim().min(1).max(SETTINGS_LIMITS.customWords.maxLength))
    .max(SETTINGS_LIMITS.customWords.maxCount),
  /** Use only custom words (requires at least SETTINGS_LIMITS.customWords.minForOnly of them). */
  customWordsOnly: z.boolean(),
  /** Let people join with the code while a game is running. */
  allowMidGameJoin: z.boolean(),
});

export type RoomSettings = z.infer<typeof roomSettingsSchema>;

export const roomSettingsPatchSchema = roomSettingsSchema.partial();
export type RoomSettingsPatch = z.infer<typeof roomSettingsPatchSchema>;

export const DEFAULT_SETTINGS: RoomSettings = {
  rounds: 3,
  drawTime: 80,
  maxPlayers: 12,
  hints: 2,
  wordChoices: 3,
  language: 'en',
  customWords: [],
  customWordsOnly: false,
  allowMidGameJoin: true,
};

/** Parses a free-text custom word list ("cat, dog, hot dog" or newline separated). Dedupes case-insensitively. */
export function parseCustomWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const w = raw.trim().replace(/\s+/g, ' ');
    if (!w || w.length > SETTINGS_LIMITS.customWords.maxLength) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= SETTINGS_LIMITS.customWords.maxCount) break;
  }
  return out;
}

/** Applies a validated patch onto existing settings and fixes up invariants. */
export function applySettingsPatch(current: RoomSettings, patch: RoomSettingsPatch): RoomSettings {
  const next: RoomSettings = { ...current, ...patch };
  if (patch.customWords) next.customWords = parseCustomWords(patch.customWords.join('\n'));
  if (next.customWordsOnly && next.customWords.length < SETTINGS_LIMITS.customWords.minForOnly) {
    next.customWordsOnly = false;
  }
  return next;
}
