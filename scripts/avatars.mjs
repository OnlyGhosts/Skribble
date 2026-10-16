#!/usr/bin/env node
/**
 * Makes the avatar pictures in client/public/avatars from Microsoft Fluent Emoji (MIT): each face
 * in shared/platform/avatarFaces.ts, in the "Color" style, drawn by Chromium (the SVGs use blur
 * filters, which only a browser draws exactly) at 104px and saved as WebP.
 *
 * Run: node scripts/avatars.mjs [path to a clone of github.com/microsoft/fluentui-emoji]
 * Without a path the SVGs are downloaded from the pinned commit below.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'client/public/avatars');
const COMMIT = '1ffb34c752ecf5d402f04cfb4b392c77f57c54bc';
/** Twice the largest avatar picture on screen (the 80px circle shows a 52px face). */
const SIZE = 104;
const QUALITY = 0.88;

async function loadFaces() {
  const source = await readFile(join(root, 'shared/platform/avatarFaces.ts'), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return mod.AVATAR_FACES;
}

/** assets/<Name>/Color/<name>_color.svg in the Fluent repository. */
function assetPath(name) {
  return `assets/${name}/Color/${name.toLowerCase().replace(/ /g, '_')}_color.svg`;
}

async function readSvg(name, clone) {
  if (clone) return readFile(join(clone, assetPath(name)), 'utf8');
  const url = `https://raw.githubusercontent.com/microsoft/fluentui-emoji/${COMMIT}/${encodeURI(assetPath(name))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

const faces = await loadFaces();
const { chromium } = createRequire(join(root, 'package.json'))('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage();
let total = 0;
for (const { name, file } of faces) {
  const svg = await readSvg(name, process.argv[2]);
  const webp = await page.evaluate(
    async ({ svg, size, quality }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      return canvas.toDataURL('image/webp', quality).split(',')[1];
    },
    { svg, size: SIZE, quality: QUALITY },
  );
  const bytes = Buffer.from(webp, 'base64');
  total += bytes.length;
  await writeFile(join(outDir, `${file}.webp`), bytes);
}
await browser.close();
console.log(`${faces.length} avatars written, ${total} bytes`);
