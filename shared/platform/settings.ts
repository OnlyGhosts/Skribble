import { z } from 'zod';
import type { GameMeta } from './games.js';

/** Bounds every game shares; a room additionally clamps maxPlayers to its game's min/max players. */
export const PLATFORM_SETTINGS_LIMITS = {
  maxPlayers: { min: 1, max: 50 },
} as const;

export const platformSettingsSchema = z.object({
  maxPlayers: z.number().int().min(PLATFORM_SETTINGS_LIMITS.maxPlayers.min).max(PLATFORM_SETTINGS_LIMITS.maxPlayers.max),
  /** Let people join with the code while a game is running. */
  allowMidGameJoin: z.boolean(),
});

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const platformSettingsPatchSchema = platformSettingsSchema.partial();
export type PlatformSettingsPatch = z.infer<typeof platformSettingsPatchSchema>;

export const DEFAULT_MAX_PLAYERS = 12;

export function defaultPlatformSettings(meta: GameMeta): PlatformSettings {
  return { maxPlayers: Math.min(DEFAULT_MAX_PLAYERS, meta.maxPlayers), allowMidGameJoin: true };
}

/** Keeps maxPlayers inside the game's range and never below the people already seated. */
export function clampMaxPlayers(value: number, meta: GameMeta, seated: number): number {
  return Math.max(Math.min(Math.max(value, meta.minPlayers), meta.maxPlayers), seated);
}
