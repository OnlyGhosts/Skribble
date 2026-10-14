import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();
const fetched: string[] = [];
vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string) => {
    fetched.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  }),
);

const { GAMES } = await import('./index');
const { GAME_SOUND_BANKS, SOUND_BUDGET_BYTES, allSoundBanks, allSoundUrls } = await import('./sounds');
const { soundEngine } = await import('../platform/lib/sound');
const { PLATFORM_SOUNDS, loadPlatformSoundsAfterGesture } = await import('../platform/lib/platformSounds');

const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));
const SOUNDS = join(PUBLIC, 'sounds');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const mp3s = filesUnder(SOUNDS).filter((f) => f.endsWith('.mp3'));

describe('the sound catalogue', () => {
  it('points every sound at a file that exists', () => {
    const urls = allSoundUrls();
    expect(urls.length).toBeGreaterThan(30);
    for (const url of urls) expect(statSync(join(PUBLIC, url)).isFile(), url).toBe(true);
  });

  it('ships no file that nothing plays, and keeps the whole set within budget', () => {
    const used = new Set(allSoundUrls());
    const onDisk = mp3s.map((f) => `/${relative(PUBLIC, f)}`);
    expect(onDisk.filter((f) => !used.has(f))).toEqual([]);
    const total = mp3s.reduce((sum, f) => sum + statSync(f).size, 0);
    expect(total).toBeLessThanOrEqual(SOUND_BUDGET_BYTES);
  });

  it('credits every file with its pack, original file and licence', () => {
    const credits = readFileSync(join(SOUNDS, 'CREDITS.md'), 'utf8');
    for (const f of mp3s) {
      const row = credits.split('\n').find((line) => line.startsWith(`| \`${relative(SOUNDS, f)}\``));
      expect(row, f).toBeDefined();
      expect(row).toMatch(/\| CC0 \|$/);
    }
  });

  it('gives every live game a bank of its own, and keeps the groups apart', () => {
    for (const module of Object.values(GAMES)) {
      if (module.meta.status !== 'live') continue;
      expect(module.sounds, module.meta.id).toBeDefined();
      expect(GAME_SOUND_BANKS).toContain(module.sounds);
    }
    const groups = allSoundBanks().map((b) => b.group);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('keeps every level in range, with wins louder than cards and clicks', () => {
    for (const bank of allSoundBanks()) {
      for (const [name, def] of Object.entries(bank.sounds)) {
        expect(def.volume, `${bank.group}.${name}`).toBeGreaterThan(0);
        expect(def.volume, `${bank.group}.${name}`).toBeLessThanOrEqual(0.7);
      }
    }
    expect(PLATFORM_SOUNDS.sounds.fanfare.volume).toBeGreaterThan(PLATFORM_SOUNDS.sounds.ready.volume);
  });
});

describe('loading', () => {
  it('fetches nothing until a game screen asks, then only that game, and the platform after the first gesture', () => {
    expect(fetched).toEqual([]);
    const blackjack = GAMES.blackjack.sounds;
    blackjack?.load();
    expect(fetched.sort()).toEqual([...(blackjack?.urls ?? [])].sort());

    fetched.length = 0;
    loadPlatformSoundsAfterGesture();
    expect(fetched).toEqual([]);
    soundEngine.unlock();
    const expected = PLATFORM_SOUNDS.urls.filter((u) => !blackjack?.urls.includes(u));
    expect(fetched.sort()).toEqual([...expected].sort());
  });
});
