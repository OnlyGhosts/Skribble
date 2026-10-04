import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Vercel compiles api/, server/ and shared/ to ESM without rewriting import specifiers, and Node
 * refuses extensionless relative imports in ESM (ERR_MODULE_NOT_FOUND at cold start). The bundlers
 * used locally resolve them, so only this check catches a regression before a deploy.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RELATIVE_SPECIFIER = /\bfrom\s+['"](\.{1,2}\/[^'"]*)['"]|\bimport\s*\(\s*['"](\.{1,2}\/[^'"]*)['"]|\bimport\s+['"](\.{1,2}\/[^'"]*)['"]/g;

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('server-side modules', () => {
  it('spell out the .js extension on every relative import', () => {
    const offenders: string[] = [];
    for (const dir of ['api', 'server', 'shared']) {
      for (const file of tsFiles(join(ROOT, dir))) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
          const specifier = match[1] ?? match[2] ?? match[3] ?? '';
          if (!specifier.endsWith('.js')) offenders.push(`${file.slice(ROOT.length)}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
