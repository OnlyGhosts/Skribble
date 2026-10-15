/**
 * The drawer's colour row: one row that always fits its width (the board's quick colours and a
 * More colours swatch), the rest of the palette and the custom picker behind More, never hidden
 * off the edge of a sideways-scrolling row.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '@shared/games/skribble/constants';
import { MORE_COLOURS, Palette, QUICK_COLOURS } from './Palette';

const css = readFileSync(fileURLToPath(new URL('./canvas.css', import.meta.url)), 'utf8');
const swatches = (html: string) => html.match(/class="swatch[^"]*"/g) ?? [];

describe('colour row', () => {
  it('shows the board colours and More colours in one row; every other colour and the custom picker are behind More', () => {
    expect(QUICK_COLOURS).toEqual(['#000000', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#3f48cc', '#a349a4']);
    expect([...QUICK_COLOURS, ...MORE_COLOURS]).toEqual(PALETTE);
    expect(MORE_COLOURS).toContain('#ffffff');
    const html = renderToString(createElement(Palette, { color: '#000000', erasing: false, onPick: () => undefined }));
    expect(swatches(html)).toHaveLength(QUICK_COLOURS.length + 1);
    expect(html).toContain('data-testid="tool-more-colors"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="tool-custom-color"');
  });

  it('shows a colour picked from More on the More swatch, picked', () => {
    const html = renderToString(createElement(Palette, { color: '#ffffff', erasing: false, onPick: () => undefined }));
    const more = html.match(/<button[^>]*data-testid="tool-more-colors"[^>]*>/)?.[0] ?? '';
    expect(more).toContain('is-selected');
    expect(more).toContain('background:#ffffff');
  });

  it('never scrolls sideways: the row is a grid of eight that shares the width on a phone', () => {
    expect(css).not.toContain('overflow-x: auto');
    expect(css).toMatch(/\.toolbar__swatches \{\s*grid-template-columns: repeat\(8, minmax\(0, 1fr\)\);/);
  });
});
