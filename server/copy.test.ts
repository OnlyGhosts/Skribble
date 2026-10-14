import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const EM_DASH = '—';

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}

/** Every string and JSX text a source file ships; comments and regex literals are not copy. */
function copyIn(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const isSource = (name: string) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts');

describe('copy', () => {
  it('ships no em dash in any string or JSX text', () => {
    const files = ['client/src', 'server', 'shared', 'api'].flatMap((dir) => walk(join(ROOT, dir), isSource));
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) => copyIn(file).filter((text) => text.includes(EM_DASH)).map((text) => `${relative(ROOT, file)}: ${text}`));
    expect(offenders).toEqual([]);
  });

  it('ships no em dash in the page shell, public files, stylesheets or README', () => {
    const files = [
      join(ROOT, 'client/index.html'),
      join(ROOT, 'README.md'),
      ...walk(join(ROOT, 'client/public'), (name) => /\.(webmanifest|json|svg|html|txt|md)$/.test(name)),
      ...walk(join(ROOT, 'client/src'), (name) => name.endsWith('.css')),
    ];
    const offenders = files.filter((file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').includes(EM_DASH));
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });
});
