import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = path.dirname(new URL(import.meta.url).pathname);
const GAMES_DIR = path.resolve(ENGINE_DIR, '../../games');

/** Anything that would make the reducer depend on the process it runs in. */
const FORBIDDEN = [/\bDate\.now\b/, /\bnew Date\b/, /\bMath\.random\b/, /\bsetTimeout\b/, /\bsetInterval\b/, /\bprocess\./, /node:crypto/, /\brandomUUID\b/, /\brandomBytes\b/];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && entry.name !== 'testHarness.ts' ? [file] : [];
  });
}

describe('engine purity', () => {
  it('never reads the clock, randomness or timers directly', () => {
    const files = sources(ENGINE_DIR);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) expect(text, `${path.basename(file)} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it('only imports shared code, the platform contract, the registry and itself', () => {
    for (const file of sources(ENGINE_DIR)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/from '([^']+)'/g)) {
        expect(m[1], `${path.basename(file)} imports ${m[1]}`).toMatch(/^(\.\/|\.\.\/\.\.\/\.\.\/shared\/|\.\.\/game\.js|\.\.\/json\.js|\.\.\/drivers\/types\.js|\.\.\/\.\.\/games\/index\.js)/);
      }
    }
  });
});

describe('game module purity', () => {
  it('reducers never read the clock, randomness or timers directly (the canvas store may use timers)', () => {
    const files = sources(GAMES_DIR).filter((f) => !f.endsWith('canvas.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) expect(text, `${path.relative(GAMES_DIR, file)} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it('game modules never import the engine or the drivers', () => {
    for (const file of sources(GAMES_DIR)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/from '([^']+)'/g)) {
        expect(m[1], `${path.relative(GAMES_DIR, file)} imports ${m[1]}`).not.toMatch(/platform\/(engine|drivers\/(?!types\.js))/);
      }
    }
  });
});
