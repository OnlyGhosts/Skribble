/**
 * How the other players' tiles fill the space under the spotlight: the tier (how much each tile
 * shows) goes by how many tiles there are, and the columns by the space the grid has, so a table
 * of any size fits without scrolling. Pure, for the grid component and the tests.
 */

/**
 * - `full` (1 to 4 others): avatar, name, chips, bet, the cards in miniature and the total.
 * - `compact` (5 to 9): avatar, name, total, bet and a status icon; no cards.
 * - `small` (10 to 23): avatar with a status dot, total, the name shortened.
 * - `dense` (24 and up): an avatar chip with a total badge and a status dot.
 */
export type TileTier = 'full' | 'compact' | 'small' | 'dense';

export function tileTier(count: number): TileTier {
  if (count <= 4) return 'full';
  if (count <= 9) return 'compact';
  if (count <= 23) return 'small';
  return 'dense';
}

export interface TierShape {
  /** The tile at its natural size, in px; it never grows past it. */
  width: number;
  height: number;
  /** The column counts the tier reads best at. */
  cols: readonly [number, number];
  /** The most columns the tier may spread to when the grid is short. */
  maxCols: number;
}

export const TIER_SHAPES: Record<TileTier, TierShape> = {
  full: { width: 168, height: 96, cols: [1, 4], maxCols: 4 },
  compact: { width: 124, height: 56, cols: [3, 5], maxCols: 5 },
  small: { width: 70, height: 50, cols: [4, 6], maxCols: 10 },
  dense: { width: 46, height: 30, cols: [6, 8], maxCols: 14 },
};

/** A desktop table is wider than a phone: the tiles may be too. */
export const WIDE_TIER_SHAPES: Record<TileTier, TierShape> = {
  full: { width: 190, height: 104, cols: [1, 4], maxCols: 4 },
  compact: { width: 140, height: 60, cols: [3, 5], maxCols: 9 },
  small: { width: 80, height: 56, cols: [4, 8], maxCols: 12 },
  dense: { width: 52, height: 34, cols: [6, 10], maxCols: 16 },
};

export interface GridFit {
  cols: number;
  rows: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** The columns before the grid has been measured (and on the server render): the tier's usual shape. */
export function defaultColumns(count: number, tier: TileTier = tileTier(count)): number {
  if (count <= 0) return 1;
  switch (tier) {
    case 'full':
      return clamp(count, 1, 4);
    case 'compact':
      return clamp(Math.ceil(count / 2), 3, 5);
    case 'small':
      return clamp(Math.ceil(count / 3), 4, 6);
    case 'dense':
      return clamp(Math.ceil(count / 6), 6, 8);
  }
}

/** How large a tile can be with `cols` columns in a `width` x `height` box: 1 is its natural size (never more). */
export function tileScale(count: number, cols: number, box: { width: number; height: number }, shape: TierShape, gap: number): number {
  const rows = Math.ceil(count / cols);
  const w = (box.width - (cols - 1) * gap) / cols;
  const h = (box.height - (rows - 1) * gap) / rows;
  return Math.min(1, w / shape.width, h / shape.height);
}

/**
 * The columns that give the largest tiles in the box; on a tie (tiles already at their natural
 * size) the tier's usual shape. Searched over the tier's usual range first; a short box may spread
 * further, up to the tier's limit, when that makes the tiles clearly larger.
 */
export function fitGrid(count: number, box: { width: number; height: number } | null, { wide = false, gap = 6 }: { wide?: boolean; gap?: number } = {}): GridFit {
  const n = Math.max(1, count);
  const tier = tileTier(count);
  const shape = (wide ? WIDE_TIER_SHAPES : TIER_SHAPES)[tier];
  const usualCols = Math.min(n, defaultColumns(count, tier));
  if (!box || box.width <= 0 || box.height <= 0) return { cols: usualCols, rows: Math.ceil(n / usualCols) };
  const best = (lo: number, hi: number): { cols: number; scale: number } => {
    let pick = { cols: usualCols, scale: -1 };
    for (let c = Math.min(n, lo); c <= Math.min(n, hi); c++) {
      const scale = tileScale(n, c, box, shape, gap);
      const better = scale > pick.scale + 1e-6 || (Math.abs(scale - pick.scale) <= 1e-6 && Math.abs(c - usualCols) < Math.abs(pick.cols - usualCols));
      if (better) pick = { cols: c, scale };
    }
    return pick;
  };
  const usual = best(Math.min(shape.cols[0], usualCols), shape.cols[1]);
  if (usual.scale >= 1) return { cols: usual.cols, rows: Math.ceil(n / usual.cols) };
  const spread = best(1, shape.maxCols);
  const pick = spread.scale > usual.scale + 0.02 ? spread : usual;
  return { cols: pick.cols, rows: Math.ceil(n / pick.cols) };
}

/**
 * The desktop's gentle arc: how far a tile in column `col` of `cols` sits up from the row's lowest
 * point, 0 in the middle to 1 at the ends (the players round the near edge of the table).
 */
export function arcLift(col: number, cols: number): number {
  if (cols <= 1) return 0;
  const mid = (cols - 1) / 2;
  const x = (col - mid) / mid;
  return Math.round(x * x * 100) / 100;
}
