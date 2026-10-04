import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@shared/constants';
import type { CanvasAction, DrawOp, Tool } from '@shared/protocol';
import { floodFill } from './floodFill';

export const ERASER_COLOR = '#ffffff';
export const FILL_TOLERANCE = 32;
/** Upper bound keeps flood fills fast on 3x phones (1600x1200 backing store at most). */
const MAX_DPR = 2;

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

/** Renders a complete stroke: a dot for one point, a line for two, midpoint-smoothed quadratics otherwise. */
export function drawStroke(ctx: CanvasRenderingContext2D, style: StrokeStyle, pts: readonly number[]): void {
  const n = Math.floor(pts.length / 2) - 1; // index of the last point
  if (n < 0) return;
  applyStyle(ctx, style);
  if (n === 0) {
    drawDot(ctx, pts[0], pts[1], style.size);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  if (n === 1) {
    ctx.lineTo(pts[2], pts[3]);
  } else {
    for (let i = 1; i <= n - 1; i++) {
      ctx.quadraticCurveTo(pts[2 * i], pts[2 * i + 1], midX(pts, i), midY(pts, i));
    }
    ctx.lineTo(pts[2 * n], pts[2 * n + 1]);
  }
  ctx.stroke();
}

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 0;
  private readonly live = new Map<number, LiveStroke>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.resize(window.devicePixelRatio);
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
    const c = this.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.restore();
  }

  /** Redraws everything from a white background. Used for undo, clear, canvas resync and rejoin. */
  replayAll(actions: readonly CanvasAction[]): void {
    this.clear();
    for (const action of actions) {
      if (action.kind === 'stroke') drawStroke(this.ctx, action, action.points);
      else this.fill(action.x, action.y, action.color);
    }
    // Only the newest action can still be streaming; keep it live so further 'move' ops extend it.
    const last = actions[actions.length - 1];
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

  applyOps(ops: readonly DrawOp[]): void {
    for (const op of ops) this.applyOp(op);
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
        applyStyle(this.ctx, stroke);
        drawDot(this.ctx, op.x, op.y, op.size);
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
        this.fill(op.x, op.y, op.color);
        break;
    }
  }

  private drawPendingPieces(stroke: LiveStroke): void {
    const pts = stroke.points;
    const n = Math.floor(pts.length / 2) - 1;
    const first = stroke.nextPiece;
    if (first > n - 1) return;
    const c = this.ctx;
    applyStyle(c, stroke);
    c.beginPath();
    if (first === 1) c.moveTo(pts[0], pts[1]);
    else c.moveTo(midX(pts, first - 1), midY(pts, first - 1));
    for (let i = first; i <= n - 1; i++) {
      c.quadraticCurveTo(pts[2 * i], pts[2 * i + 1], midX(pts, i), midY(pts, i));
    }
    c.stroke();
    stroke.nextPiece = n;
  }

  private drawTail(stroke: LiveStroke): void {
    const pts = stroke.points;
    const n = Math.floor(pts.length / 2) - 1;
    if (n < 1) return; // a lone point is already a dot
    const c = this.ctx;
    applyStyle(c, stroke);
    c.beginPath();
    if (n === 1) c.moveTo(pts[0], pts[1]);
    else c.moveTo(midX(pts, n - 1), midY(pts, n - 1));
    c.lineTo(pts[2 * n], pts[2 * n + 1]);
    c.stroke();
  }

  private fill(x: number, y: number, color: string): void {
    floodFill(this.ctx, x * this.dpr, y * this.dpr, color, FILL_TOLERANCE);
  }
}
