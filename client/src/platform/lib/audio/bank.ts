/**
 * Sound banks: a game (or the platform) declares its sounds by name once, with their files and
 * levels, and plays them by name. Every bank lands in one registry, which the tests read to check
 * that every file exists and the whole set stays small.
 */
import { browserEnv, SoundEngine } from './engine';
import { soundUrls, type PlayOptions, type SoundDef } from './types';

export interface SoundBank<K extends string = string> {
  /** Names the bank in the registry and prefixes its cooldown keys. */
  readonly group: string;
  readonly sounds: Readonly<Record<K, SoundDef>>;
  /** Every file the bank may play, as URL paths. */
  readonly urls: readonly string[];
  /** Starts fetching the bank's files (decoded once a gesture allows); idempotent. */
  load(): void;
  play(name: K, opts?: PlayOptions): void;
}

/** A bank with its names erased, as the platform holds it. */
export type AnySoundBank = Pick<SoundBank, 'group' | 'urls' | 'load'> & { readonly sounds: Readonly<Record<string, SoundDef>> };

/** The one engine the app plays through. */
export const soundEngine = new SoundEngine(browserEnv);

const registry = new Map<string, AnySoundBank>();

export function defineSounds<K extends string>(group: string, sounds: Record<K, SoundDef>, engine: SoundEngine = soundEngine): SoundBank<K> {
  const defs: Readonly<Record<string, SoundDef>> = sounds;
  const urls = [...new Set(Object.values(defs).flatMap(soundUrls))];
  const bank: SoundBank<K> = {
    group,
    sounds,
    urls,
    load: () => engine.load(urls),
    play: (name, opts) => engine.play(`${group}.${name}`, sounds[name], opts),
  };
  registry.set(group, bank);
  return bank;
}

/** Every bank defined so far, in definition order. */
export function soundBanks(): AnySoundBank[] {
  return [...registry.values()];
}
