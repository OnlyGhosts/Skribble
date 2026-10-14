import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_SPY_LOCATIONS, locationsForMode } from '@shared/games/spygame/locations';
import { IMAGE_PREFERENCE, pickImages } from './images';

const assetDir = fileURLToPath(new URL('./assets/locations/', import.meta.url));

/** The `path -> url` map Vite's import.meta.glob would build for the assets folder. */
function globbed(): Record<string, string> {
  const files = readdirSync(assetDir).filter((f) => IMAGE_PREFERENCE.some((ext) => f.endsWith(`.${ext}`)));
  return Object.fromEntries(files.map((f) => [`./assets/locations/${f}`, `/assets/${f}`]));
}

describe('location tiles', () => {
  it('has a generated tile for every location of every content tier, cheeky and unhinged included', () => {
    const images = pickImages(globbed());
    const missing = ALL_SPY_LOCATIONS.filter((l) => !images[l.id]).map((l) => l.id);
    expect(missing).toEqual([]);
    for (const mode of ['family', 'unhinged'] as const) {
      expect(locationsForMode(mode).every((l) => images[l.id] !== undefined)).toBe(true);
    }
  });

  it('prefers a photo over the generated svg and reads ids with dashes', () => {
    const images = pickImages({
      './assets/locations/crematorium-after-party.svg': '/svg',
      './assets/locations/crematorium-after-party.jpg': '/jpg',
      './assets/locations/sex-shop-stockroom.webp': '/webp',
      './assets/locations/README.md': '/nope',
    });
    expect(images['crematorium-after-party']).toBe('/jpg');
    expect(images['sex-shop-stockroom']).toBe('/webp');
    expect(Object.keys(images)).toHaveLength(2);
  });

  it('keeps the spy choosing from 24 candidates whatever the pool size', () => {
    // The reference grid is laid out for 24 tiles; larger pools only change the decoys drawn, never the count.
    expect(locationsForMode('unhinged').length).toBeGreaterThan(locationsForMode('family').length);
    expect(locationsForMode('family').length).toBeGreaterThanOrEqual(24);
  });
});
