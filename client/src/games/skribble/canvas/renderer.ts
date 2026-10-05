import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@shared/games/skribble/constants';
import type { CanvasAction, DrawOp, Tool } from '@shared/games/skribble/protocol';
import { FILL_TOLERANCE, floodFillImage, paintSpans, type FillSpans } from './floodFill';

export const ERASER_COLOR = '#ffffff';
export { FILL_TOLERANCE };
/** Upper bound keeps the backing store small on 3x phones (1600x1200 at most). */
const MAX_DPR = 2;

type FillAction = Extract<CanvasAction, { kind: 'fill' }>;

interface StrokeStyle {
  tool: Tool;
  color: string;
  size: number;
}

/**
 * A stroke that is still streaming in. `nextPiece` is the index of the next smoothing piece to
 * draw; piece i runs from mid(p[i-1], p[i]) (or p0 for i = 1) through control point p[i] to
 * mid(p[i], p[i+1]). A piece can only be drawn once p[i+1] is known, so the visible line trails the
 * pointer by half a segment until 'end' draws the tail — the price of identical replay output.
 */
interface LiveStroke extends StrokeStyle {
  points: number[];
  nextPiece: number;
}

/** What the renderer needs from a canvas; tests substitute a fake for the offscreen bitmap. */
export interface CanvasSource {
  width: number;
  height: number;
  getContext(contextId: '2d', options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
}

export interface RendererOptions {
  /** Backing canvas for the fixed-resolution fill bitmap; a fresh <canvas> by default. */
  logical?: CanvasSource;
  /** Initial device pixel ratio; `window.devicePixelRatio` by default. */
  dpr?: number;
}

export function clampDpr(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.min(MAX_DPR, Math.max(1, dpr));
}

function applyStyle(ctx: CanvasRenderingContext2D, style: StrokeStyle): void {
  const color = style.tool === 'eraser' ? ERASER_COLOR : style.color;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = style.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.fill();
}

const midX = (pts: readonly number[], i: number): number => (pts[2 * i] + pts[2 * i + 2]) / 2;
const midY = (pts: readonly number[], i: number): number => (pts[2 * i + 1] + pts[2 * i + 3]) / 2;

/**
 * Renders a stroke: a dot for one point, a line for two, midpoint-smoothed quadratics otherwise.
 * A stroke that is not `done` is drawn exactly as the incremental path would have drawn it so far
 * (the start dot and the pieces up to mid(p[n-1], p[n]), no straight tail to the newest point):
 * when further points arrive the picture must end up identical to everyone else's.
 */
export function drawStroke(ctx: CanvasRenderingContext2D, style: StrokeStyle, pts: readonly number[], done = true): void {
  const n = Math.floor(pts.length / 2) - 1; // index of the last point
  if (n < 0) return;
  applyStyle(ctx, style);
  if (n === 0 || !done) drawDot(ctx, pts[0], pts[1], style.size);
  if (n === 0 || (!done && n < 2)) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  if (n === 1) {
    ctx.lineTo(pts[2], pts[3]);
  } else {
    for (let i = 1; i <= n - 1; i++) {
      ctx.quadraticCurveTo(pts[2 * i], pts[2 * i + 1], midX(pts, i), midY(pts, i));
    }
    if (done) ctx.lineTo(pts[2 * n], pts[2 * n + 1]);
  }
  ctx.stroke();
}

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  /**
   * A 1x mirror of the picture at the logical size. Flood fills are computed here, never on the
   * display bitmap: anti-aliasing differs between device pixel ratios, so a near-closed outline
   * would leak on a 2x phone and hold on a 1x laptop. Every client fills the same region this way.
   */
  private readonly logical: CanvasRenderingContext2D;
  private readonly fillScratch = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT);
  /** Spans each fill action painted. A replay repaints them instead of flooding the bitmap again. */
  private readonly fillCache = new WeakMap<FillAction, FillSpans>();
  private dpr = 0;
  private readonly live = new Map<number, LiveStroke>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: RendererOptions = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    const source = opts.logical ?? document.createElement('canvas');
    source.width = CANVAS_WIDTH;
    source.height = CANVAS_HEIGHT;
    const logical = source.getContext('2d', { willReadFrequently: true });
    if (!logical) throw new Error('2D canvas context unavailable');
    this.logical = logical;
    this.resize(opts.dpr ?? window.devicePixelRatio);
  }

  /** (Re)allocates the backing store for a device pixel ratio. Returns true when the bitmap was reset. */
  resize(devicePixelRatio: number): boolean {
    const dpr = clampDpr(devicePixelRatio);
    if (dpr === this.dpr) return false;
    this.dpr = dpr;
    this.canvas.width = Math.round(CANVAS_WIDTH * dpr);
    this.canvas.height = Math.round(CANVAS_HEIGHT * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.clear();
    return true;
  }

  clear(): void {
    this.live.clear();
    for (const c of this.targets()) {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, c.canvas.width, c.canvas.height);
      c.restore();
    }
  }

  /** Redraws everything from a white background. Used for undo, clear, canvas resync and rejoin. */
  replayAll(actions: readonly CanvasAction[]): void {
    this.clear();
    const lastIndex = actions.length - 1;
    actions.forEach((action, i) => {
      if (action.kind === 'fill') {
        this.fill(action.x, action.y, action.color, action);
        return;
      }
      // Only the newest action can still be streaming: it gets no tail yet, and stays live so
      // further 'move' ops extend it exactly as they would have without the replay.
      const done = i !== lastIndex || action.done === true;
      for (const c of this.targets()) drawStroke(c, action, action.points, done);
    });
    const last = actions[lastIndex];
    if (last && last.kind === 'stroke') {
      const n = Math.floor(last.points.length / 2) - 1;
      this.live.set(last.id, {
        tool: last.tool,
        color: last.color,
        size: last.size,
        points: last.points.slice(),
        nextPiece: Math.max(1, n),
      });
    }
  }

  /**
   * Applies streamed ops. `actions` is the action list the ops were already folded into: it lets
   * each fill op find its action so the fill's result is remembered for later replays.
   */
  applyOps(ops: readonly DrawOp[], actions?: readonly CanvasAction[]): void {
    const fills = actions ? this.lastFills(actions, ops.filter((op) => op.k === 'fill').length) : [];
    let nextFill = 0;
    for (const op of ops) {
      if (op.k === 'fill') this.fill(op.x, op.y, op.color, fills[nextFill++] ?? null);
      else this.applyOp(op);
    }
  }

  /** The newest `count` fill actions in order; `[]` when the list does not hold that many. */
  private lastFills(actions: readonly CanvasAction[], count: number): FillAction[] {
    const fills: FillAction[] = [];
    for (let i = actions.length - 1; i >= 0 && fills.length < count; i--) {
      const action = actions[i];
      if (action.kind === 'fill') fills.unshift(action);
    }
    return fills.length === count ? fills : [];
  }

  applyOp(op: DrawOp): void {
    switch (op.k) {
      case 'start': {
        const stroke: LiveStroke = {
          tool: op.tool,
          color: op.color,
          size: op.size,
          points: [op.x, op.y],
          nextPiece: 1,
        };
        this.live.set(op.id, stroke);
        for (const c of this.targets()) {
          applyStyle(c, stroke);
          drawDot(c, op.x, op.y, op.size);
        }
        break;
      }
      case 'move': {
        const stroke = this.live.get(op.id);
        if (!stroke) return;
        for (const v of op.pts) stroke.points.push(v);
        this.drawPendingPieces(stroke);
        break;
      }
      case 'end': {
        const stroke = this.live.get(op.id);
        if (!stroke) return;
        this.drawPendingPieces(stroke);
        this.drawTail(stroke);
        this.live.delete(op.id);
        break;
      }
      case 'fill':
        this.fill(op.x, op.y, op.color, null);
        break;
    }
  }

  private targets(): readonly CanvasRenderingContext2D[] {
    return [this.ctx, this.logical];
  }

  private drawPendingPieces(stroke: LiveStroke): void {
    const pts = stroke.points;
    const n = Math.floor(pts.length / 2) - 1;
    const first = stroke.nextPiece;
    if (first > n - 1) return;
    for (const c of this.targets()) {
      applyStyle(c, stroke);
      c.beginPath();
      if (first === 1) c.moveTo(pts[0], pts[1]);
      else c.moveTo(midX(pts, first - 1), midY(pts, first - 1));
      for (let i = first; i <= n - 1; i++) {
        c.quadraticCurveTo(pts[2 * i], pts[2 * i + 1], midX(pts, i), midY(pts, i));
      }
      c.stroke();
    }
    stroke.nextPiece = n;
  }

  private drawTail(stroke: LiveStroke): void {
    const pts = stroke.points;
    const n = Math.floor(pts.length / 2) - 1;
    if (n < 1) return; // a lone point is already a dot
    for (const c of this.targets()) {
      applyStyle(c, stroke);
      c.beginPath();
      if (n === 1) c.moveTo(pts[0], pts[1]);
      else c.moveTo(midX(pts, n - 1), midY(pts, n - 1));
      c.lineTo(pts[2 * n], pts[2 * n + 1]);
      c.stroke();
    }
  }

  /**
   * Floods the 1x bitmap and paints the resulting spans on both canvases. With `action` the spans
   * are cached (or reused), so a replay of a bucket-heavy turn never re-floods the whole picture.
   */
  private fill(x: number, y: number, color: string, action: FillAction | null): void {
    let spans = action ? this.fillCache.get(action) : undefined;
    if (spans) {
      paintSpans(this.logical, spans, color);
    } else {
      const image = this.logical.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      spans = floodFillImage(image, x, y, color, FILL_TOLERANCE, this.fillScratch);
      if (spans.length > 0) this.logical.putImageData(image, 0, 0);
      if (action) this.fillCache.set(action, spans);
    }
    paintSpans(this.ctx, spans, color);
  }
}
