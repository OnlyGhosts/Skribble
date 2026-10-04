import type { CanvasSource } from '../canvas/renderer';

export interface Call {
  op: string;
  args: number[];
}

/**
 * A 2D context double for renderer tests. Path and style calls are recorded; `rasterize` adds a
 * pixel buffer where `fillRect`, `rect` + `fill` and `putImageData` really paint, so flood fills
 * (which read the bitmap) behave. Strokes are never rasterised: the tests paint barriers directly.
 */
export class FakeContext {
  readonly calls: Call[] = [];
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  private pendingRects: number[][] = [];
  private data: Uint8ClampedArray | null = null;

  constructor(
    readonly canvas: FakeCanvas,
    private readonly rasterize: boolean,
  ) {}

  private buffer(): Uint8ClampedArray {
    const size = this.canvas.width * this.canvas.height * 4;
    if (!this.data || this.data.length !== size) this.data = new Uint8ClampedArray(size).fill(255);
    return this.data;
  }

  save(): void {}
  restore(): void {}
  setTransform(): void {}
  beginPath(): void {
    this.pendingRects = [];
    this.calls.push({ op: 'beginPath', args: [] });
  }
  moveTo(x: number, y: number): void {
    this.calls.push({ op: 'moveTo', args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.calls.push({ op: 'lineTo', args: [x, y] });
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.calls.push({ op: 'quadraticCurveTo', args: [cx, cy, x, y] });
  }
  arc(x: number, y: number, r: number): void {
    this.calls.push({ op: 'arc', args: [x, y, r] });
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.pendingRects.push([x, y, w, h]);
    this.calls.push({ op: 'rect', args: [x, y, w, h] });
  }
  stroke(): void {
    this.calls.push({ op: 'stroke', args: [] });
  }
  fill(): void {
    this.calls.push({ op: 'fill', args: [] });
    if (!this.rasterize) return;
    for (const [x, y, w, h] of this.pendingRects) this.paintRect(x, y, w, h);
    this.pendingRects = [];
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ op: 'fillRect', args: [x, y, w, h] });
    if (this.rasterize) this.paintRect(x, y, w, h);
  }
  getImageData(): { width: number; height: number; data: Uint8ClampedArray } {
    this.calls.push({ op: 'getImageData', args: [] });
    return { width: this.canvas.width, height: this.canvas.height, data: this.buffer().slice() };
  }
  putImageData(image: { data: Uint8ClampedArray }): void {
    this.calls.push({ op: 'putImageData', args: [] });
    this.buffer().set(image.data);
  }

  /** Paints one pixel directly (a stroke stand-in for fill tests). */
  setPixel(x: number, y: number, hex: string): void {
    this.fillStyle = hex;
    this.paintRect(x, y, 1, 1);
  }

  pixel(x: number, y: number): string {
    const o = (y * this.canvas.width + x) * 4;
    const d = this.buffer();
    return `#${[d[o], d[o + 1], d[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  private paintRect(x: number, y: number, w: number, h: number): void {
    const n = Number.parseInt(this.fillStyle.slice(1, 7), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const d = this.buffer();
    for (let py = Math.max(0, y); py < Math.min(this.canvas.height, y + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(this.canvas.width, x + w); px++) {
        const o = (py * this.canvas.width + px) * 4;
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = b;
        d[o + 3] = 255;
      }
    }
  }
}

export class FakeCanvas implements CanvasSource {
  width = 300;
  height = 150;
  readonly ctx: FakeContext;

  constructor(rasterize: boolean) {
    this.ctx = new FakeContext(this, rasterize);
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx as unknown as CanvasRenderingContext2D;
  }
}

/** Geometry calls only (what ends up on the bitmap), ignoring style and bookkeeping. */
export function geometry(ctx: FakeContext): Call[] {
  return ctx.calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo' || c.op === 'quadraticCurveTo' || c.op === 'arc');
}
