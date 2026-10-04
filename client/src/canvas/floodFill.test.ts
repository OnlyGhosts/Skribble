import { describe, expect, it } from 'vitest';
import { FILL_TOLERANCE, floodFillImage, hexToRgb, type PixelImage } from './floodFill';

function image(width: number, height: number): PixelImage & { data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { width, height, data };
}

function paint(img: PixelImage, x: number, y: number, hex: string): void {
  const [r, g, b] = hexToRgb(hex);
  const o = (y * img.width + x) * 4;
  img.data[o] = r;
  img.data[o + 1] = g;
  img.data[o + 2] = b;
  img.data[o + 3] = 255;
}

function pixel(img: PixelImage, x: number, y: number): string {
  const o = (y * img.width + x) * 4;
  return `#${[img.data[o], img.data[o + 1], img.data[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Applies spans to a bitmap the way the renderer repaints a cached fill. */
function applySpans(img: PixelImage, spans: number[], hex: string): void {
  for (let i = 0; i < spans.length; i += 3) for (let x = spans[i + 1]; x < spans[i + 2]; x++) paint(img, x, spans[i], hex);
}

describe('floodFillImage', () => {
  it('fills the connected region up to a barrier and returns the spans it painted', () => {
    const img = image(8, 4);
    for (let y = 0; y < 4; y++) paint(img, 4, y, '#000000'); // vertical wall
    const spans = floodFillImage(img, 1, 1, '#ff0000', FILL_TOLERANCE);
    expect(pixel(img, 0, 0)).toBe('#ff0000');
    expect(pixel(img, 3, 3)).toBe('#ff0000');
    expect(pixel(img, 4, 1)).toBe('#000000');
    expect(pixel(img, 5, 1)).toBe('#ffffff');
    // One span per row, each covering columns 0..3.
    expect(spans).toHaveLength(4 * 3);
    for (let i = 0; i < spans.length; i += 3) expect([spans[i + 1], spans[i + 2]]).toEqual([0, 4]);
  });

  it('repainting the spans reproduces the filled bitmap exactly', () => {
    const original = image(10, 6);
    paint(original, 3, 2, '#000000');
    paint(original, 4, 3, '#000000');
    const copy = image(10, 6);
    copy.data.set(original.data);
    const spans = floodFillImage(original, 0, 0, '#00ff00', FILL_TOLERANCE);
    applySpans(copy, spans, '#00ff00');
    expect(Array.from(copy.data)).toEqual(Array.from(original.data));
  });

  it('does nothing when the target pixel already has the fill colour or lies outside', () => {
    const img = image(4, 4);
    paint(img, 1, 1, '#0000ff');
    expect(floodFillImage(img, 1, 1, '#0000ff', FILL_TOLERANCE)).toEqual([]);
    expect(floodFillImage(img, 9, 1, '#0000ff', FILL_TOLERANCE)).toEqual([]);
  });

  it('reuses a scratch buffer of the right size and ignores one of the wrong size', () => {
    const scratch = new Uint8Array(16);
    const first = image(4, 4);
    floodFillImage(first, 0, 0, '#ff0000', FILL_TOLERANCE, scratch);
    expect(Array.from(scratch).every((v) => v === 1)).toBe(true);
    const second = image(4, 4);
    paint(second, 0, 1, '#000000');
    paint(second, 1, 0, '#000000');
    // The stale marks must not block the second fill: only (0,0) is reachable.
    const spans = floodFillImage(second, 0, 0, '#ff0000', FILL_TOLERANCE, scratch);
    expect(spans).toEqual([0, 0, 1]);
    expect(floodFillImage(image(4, 4), 0, 0, '#ff0000', FILL_TOLERANCE, new Uint8Array(3))).toHaveLength(4 * 3);
  });
});
