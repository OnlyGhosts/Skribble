// Renders the smile tile (client/public/favicon.svg, from branding/assets/favicon.svg) to the PNG
// app icons. Maskable icons must have no transparency, so the lime tile fills the whole square and
// the face stays inside the 80% safe zone. Run: node scripts/brand-icons.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(path.join(root, 'package.json'))('@playwright/test');
const svg = readFileSync(path.join(root, 'client/public/favicon.svg'), 'utf8');
const LIME = '#C7E976';
const sizes = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];
const browser = await chromium.launch();
for (const { file, size } of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  // The tile's own corners are cut off by the platform's mask; the face keeps the tile's proportions.
  const art = Math.round(size * 1.1);
  const offset = Math.round((size - art) / 2);
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:${LIME};overflow:hidden">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${art}" height="${art}" style="display:block;position:absolute;left:${offset}px;top:${offset}px"></body></html>`);
  await page.screenshot({ path: path.join(root, 'client/public/icons', file), omitBackground: false, type: 'png' });
  await page.close();
}
await browser.close();
console.log('icons written');
