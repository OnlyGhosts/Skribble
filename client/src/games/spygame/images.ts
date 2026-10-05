/**
 * Location tiles. Every file in assets/locations/ is bundled; a location's picture is the file
 * named after its id, and a photo (jpg, jpeg, png, webp) beats the generated svg placeholder, so
 * the owner replaces a tile by dropping `<id>.jpg` into that folder.
 */

const IMAGE_FILES = import.meta.glob<string>('./assets/locations/*.{jpg,jpeg,png,webp,svg}', { eager: true, query: '?url', import: 'default' });

/** Best first. */
export const IMAGE_PREFERENCE: readonly string[] = ['jpg', 'jpeg', 'png', 'webp', 'svg'];

/** One url per location id from a `path -> url` map, the preferred extension winning. */
export function pickImages(files: Readonly<Record<string, string>>): Record<string, string> {
  const rank = (ext: string): number => {
    const i = IMAGE_PREFERENCE.indexOf(ext);
    return i === -1 ? IMAGE_PREFERENCE.length : i;
  };
  const best: Record<string, { ext: string; url: string }> = {};
  for (const [path, url] of Object.entries(files)) {
    const match = /([a-z-]+)\.([a-z]+)$/.exec(path);
    if (!match) continue;
    const [, id, ext] = match;
    const current = best[id];
    if (!current || rank(ext) < rank(current.ext)) best[id] = { ext, url };
  }
  return Object.fromEntries(Object.entries(best).map(([id, { url }]) => [id, url]));
}

const IMAGES = pickImages(IMAGE_FILES);

export function locationImage(id: string): string | null {
  return IMAGES[id] ?? null;
}
