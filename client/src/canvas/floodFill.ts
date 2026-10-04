/** Per-channel tolerance that lets fills swallow the anti-aliased fringe of stroke edges. */
export const FILL_TOLERANCE = 32;

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The part of `ImageData` the fill needs; lets tests run without a canvas. */
export interface PixelImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * Horizontal runs of pixels a fill painted, as flat triples [y, x0, x1) in pixel coordinates.
 * Replaying a fill paints these again instead of re-deriving the region from the bitmap.
 */
export type FillSpans = number[];

/**
 * Scanline flood fill on a bitmap. The connected region whose colour is within `tolerance` (per
 * channel) of the pixel at (px, py) is replaced with `hex`; the tolerance lets fills swallow the
 * anti-aliased fringe of stroke edges instead of leaving halos. Returns the painted spans (empty
 * when nothing changed). `scratch` is an optional reusable visited buffer of width*height bytes.
 */
export function floodFillImage(image: PixelImage, px: number, py: number, hex: string, tolerance: number, scratch?: Uint8Array): FillSpans {
  const { width, height, data } = image;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const spans: FillSpans = [];
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return spans;

  const [fr, fg, fb] = hexToRgb(hex);
  const startOffset = (y0 * width + x0) * 4;
  const tr = data[startOffset];
  const tg = data[startOffset + 1];
  const tb = data[startOffset + 2];
  const ta = data[startOffset + 3];
  if (tr === fr && tg === fg && tb === fb && ta === 255) return spans;

  const matches = (pixel: number): boolean => {
    const o = pixel * 4;
    return (
      Math.abs(data[o] - tr) <= tolerance &&
      Math.abs(data[o + 1] - tg) <= tolerance &&
      Math.abs(data[o + 2] - tb) <= tolerance &&
      Math.abs(data[o + 3] - ta) <= tolerance
    );
  };

  let visited: Uint8Array;
  if (scratch && scratch.length === width * height) {
    scratch.fill(0);
    visited = scratch;
  } else {
    visited = new Uint8Array(width * height);
  }
  const stack: number[] = [x0, y0];

  while (stack.length >= 2) {
    const y = stack[stack.length - 1];
    const x = stack[stack.length - 2];
    stack.length -= 2;
    let pixel = y * width + x;
    if (visited[pixel] || !matches(pixel)) continue;

    // Walk left to the start of this horizontal span.
    let lx = x;
    while (lx > 0 && !visited[pixel - 1] && matches(pixel - 1)) {
      lx--;
      pixel--;
    }

    // Fill rightwards, seeding the rows above and below once per contiguous run.
    let upRun = false;
    let downRun = false;
    let cx = lx;
    for (; cx < width && !visited[pixel] && matches(pixel); cx++, pixel++) {
      visited[pixel] = 1;
      const o = pixel * 4;
      data[o] = fr;
      data[o + 1] = fg;
      data[o + 2] = fb;
      data[o + 3] = 255;

      if (y > 0) {
        const up = pixel - width;
        const m = !visited[up] && matches(up);
        if (m && !upRun) stack.push(cx, y - 1);
        upRun = m;
      }
      if (y < height - 1) {
        const down = pixel + width;
        const m = !visited[down] && matches(down);
        if (m && !downRun) stack.push(cx, y + 1);
        downRun = m;
      }
    }
    spans.push(y, lx, cx);
  }

  return spans;
}

/** Paints spans as one path so adjacent rows never show anti-aliased seams (fractional device pixel ratios). */
export function paintSpans(ctx: CanvasRenderingContext2D, spans: FillSpans, hex: string): void {
  if (spans.length === 0) return;
  ctx.fillStyle = hex;
  ctx.beginPath();
  for (let i = 0; i < spans.length; i += 3) ctx.rect(spans[i + 1], spans[i], spans[i + 2] - spans[i + 1], 1);
  ctx.fill();
}
