#!/usr/bin/env node
/**
 * Generates one placeholder tile per Spy Game location into
 * client/src/games/spygame/assets/locations/<id>.svg: a gradient from the location's hue, a
 * subtle dot pattern and the emoji, large and centred, no text. Re-run it after editing the pack
 * (`node scripts/spygame-location-images.mjs`); drop a <id>.jpg / .png / .webp next to a tile to
 * replace it with a real picture (the client prefers those over the SVG).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packFile = join(root, 'shared/games/spygame/locations.ts');
const outDir = join(root, 'client/src/games/spygame/assets/locations');

/** The pack is TypeScript without imports: strip the types and load it as a module from a data URL. */
async function loadPack() {
  const source = await readFile(packFile, 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return mod.SPY_LOCATIONS;
}

function tile({ id, emoji, hue }) {
  const from = `hsl(${hue} 72% 62%)`;
  const to = `hsl(${(hue + 40) % 360} 68% 38%)`;
  const dots = `hsl(${hue} 90% 96% / 0.22)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img" aria-label="${id}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
    <pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
      <circle cx="6" cy="6" r="2.2" fill="${dots}"/>
    </pattern>
    <radialGradient id="h" cx="0.5" cy="0.55" r="0.5">
      <stop offset="0" stop-color="#fff" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="400" height="300" fill="url(#g)"/>
  <rect width="400" height="300" fill="url(#p)"/>
  <circle cx="200" cy="165" r="120" fill="url(#h)"/>
  <text x="200" y="160" font-size="150" text-anchor="middle" dominant-baseline="central" font-family="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${emoji}</text>
</svg>
`;
}

const pack = await loadPack();
await mkdir(outDir, { recursive: true });
for (const location of pack) await writeFile(join(outDir, `${location.id}.svg`), tile(location));
console.log(`wrote ${pack.length} tiles to ${outDir}`);
