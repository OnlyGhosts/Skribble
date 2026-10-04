import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = path.dirname(new URL(import.meta.url).pathname);

/** Anything that would make the reducer depend on the process it runs in. */
const FORBIDDEN = [/\bDate\.now\b/, /\bnew Date\b/, /\bMath\.random\b/, /\bsetTimeout\b/, /\bsetInterval\b/, /\bprocess\./, /node:crypto/, /\brandomUUID\b/, /\brandomBytes\b/];

describe('engine purity', () => {
  it('never reads the clock, randomness or timers directly', () => {
    const sources = readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'testHarness.ts');
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const text = readFileSync(path.join(ENGINE_DIR, file), 'utf8');
      for (const pattern of FORBIDDEN) expect(text, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it('only imports shared code and itself', () => {
    const sources = readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'testHarness.ts');
    for (const file of sources) {
      const text = readFileSync(path.join(ENGINE_DIR, file), 'utf8');
      for (const m of text.matchAll(/from '([^']+)'/g)) {
        expect(m[1], `${file} imports ${m[1]}`).toMatch(/^(\.\/|\.\.\/\.\.\/shared\/)/);
      }
    }
  });
});
