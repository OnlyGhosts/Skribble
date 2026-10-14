/**
 * The shared drawing canvas: the streaming op format, the history format late joiners replay,
 * the caps that bound a canvas and the three side messages (`draw`, `undo`, `clear`) any game
 * with a canvas accepts. Skribble was the first user; a game opts in by including these messages
 * in its client schema, declaring `CANVAS_SIDE_MESSAGE_TYPES` as its `sideMessages` and creating
 * the platform's canvas side store (server/platform/sideStores/canvas.ts) with its own policy.
 */
import { z } from 'zod';

/** The logical canvas is a fixed size; clients scale it to fit and always send coordinates in this space. */
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;

/**
 * Caps that bound memory per room. The whole canvas is re-sent to every joiner/rejoiner in
 * `welcome`, so these also bound that message: see MAX_CANVAS_RESYNC_BYTES.
 */
export const MAX_ACTIONS_PER_TURN = 500;
/** Flat coordinate numbers ([x, y, x, y, ...]) a single stroke may hold. */
export const MAX_POINTS_PER_STROKE = 4000;
/** Flat coordinate numbers across *all* strokes on the canvas; bounds the turn, not just one stroke. */
export const MAX_POINTS_PER_TURN = 80_000;
/** Rough upper bound on the serialized canvas (coordinates are rounded to 2 decimals, so ~8 bytes each). */
export const MAX_CANVAS_RESYNC_BYTES = MAX_POINTS_PER_TURN * 8 + MAX_ACTIONS_PER_TURN * 128;

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');

export const toolSchema = z.enum(['brush', 'eraser']);
export type Tool = z.infer<typeof toolSchema>;

/**
 * Streaming drawing operations. Coordinates are logical canvas pixels
 * (0..CANVAS_WIDTH, 0..CANVAS_HEIGHT) and may be fractional. Stroke `id`s are
 * assigned by the drawer and must be unique within a canvas (an incrementing counter).
 */
export const drawOpSchema = z.discriminatedUnion('k', [
  z.object({
    k: z.literal('start'),
    id: z.number().int().nonnegative(),
    tool: toolSchema,
    color: hexColorSchema,
    size: z.number().min(1).max(100),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  /** Append points to the stroke `id`; `pts` is flat: [x0, y0, x1, y1, ...]. */
  z.object({
    k: z.literal('move'),
    id: z.number().int().nonnegative(),
    pts: z.array(z.number().finite()).min(2).max(2000).refine((a) => a.length % 2 === 0, 'pts must be pairs'),
  }),
  z.object({ k: z.literal('end'), id: z.number().int().nonnegative() }),
  /** Flood fill at (x, y) with `color`. */
  z.object({ k: z.literal('fill'), x: z.number().finite(), y: z.number().finite(), color: hexColorSchema }),
]);
export type DrawOp = z.infer<typeof drawOpSchema>;

/** Canvas history as kept by the server and replayed by late joiners. Undo removes the last action. */
export type CanvasAction =
  | {
      kind: 'stroke';
      id: number;
      tool: Tool;
      color: string;
      size: number;
      points: number[];
      /** Set once the drawer's 'end' op arrived; absent while the stroke may still receive points. */
      done?: boolean;
    }
  | { kind: 'fill'; x: number; y: number; color: string };

/** The canvas messages a client sends; a game spreads these into its own client message union. */
export const canvasClientMessageOptions = [
  /** Ops are batched by the client (~every 30ms). Handled by the canvas side store, never the reducer. */
  z.object({ t: z.literal('draw'), ops: z.array(drawOpSchema).min(1).max(200) }),
  z.object({ t: z.literal('undo') }),
  z.object({ t: z.literal('clear') }),
] as const;

export const canvasClientMessageSchema = z.discriminatedUnion('t', [...canvasClientMessageOptions]);
export type CanvasClientMessage = z.infer<typeof canvasClientMessageSchema>;

/** Message types the canvas side store handles outside the pure reducer. */
export const CANVAS_SIDE_MESSAGE_TYPES: ReadonlySet<string> = new Set(['draw', 'undo', 'clear']);

export type CanvasServerMessage =
  | { t: 'draw'; ops: DrawOp[] }
  | { t: 'undo' }
  | { t: 'clear' }
  /** Full canvas resync (e.g. after the drawer's ops were truncated by the caps). */
  | { t: 'canvas'; actions: CanvasAction[] };

/** What a game with a canvas puts in `welcome.extra`. */
export interface CanvasWelcomeExtra {
  canvas: CanvasAction[];
  /** Segmented canvases only: actions drawn before the current segment began, which undo and clear leave alone. */
  floor?: number;
}

export function isCanvasWelcomeExtra(x: unknown): x is CanvasWelcomeExtra {
  return typeof x === 'object' && x !== null && Array.isArray((x as { canvas?: unknown }).canvas);
}
