// Renders the Pocket Party app icon (client/public/icons/icon.svg, from
// branding/pocket-party/assets/brand/app-icon.svg) to the opaque PNGs that platforms mask
// themselves: the apple-touch-icon and the maskable manifest icons. The lime fills the whole
// square (no transparent corners) and the face already sits inside the 80% safe zone.
// The plain "any" icons (icon-192.png, icon-512.png, favicon-16/32.png) are the pack's PNGs as supplied.
// Run: node scripts/brand-icons.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(path.join(root, 'package.json'))('@playwright/test');
const svg = readFileSync(path.join(root, 'client/public/icons/icon.svg'), 'utf8');
const LIME = '#C7E976';
const sizes = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-maskable-192.png', size: 192 },
  { file: 'icon-maskable-512.png', size: 512 },
];
const browser = await chromium.launch();
for (const { file, size } of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:${LIME};overflow:hidden">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`);
  await page.screenshot({ path: path.join(root, 'client/public/icons', file), omitBackground: false, type: 'png' });
  await page.close();
}
await browser.close();
console.log('icons written');
