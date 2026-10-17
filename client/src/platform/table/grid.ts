/**
 * How the other players' tiles fill the space the table leaves them: the tier (how much each tile
 * shows) goes by the room the seats have, and the columns by the space the grid has, so a table
 * of any size fits without scrolling. Pure, for the grid component and the tests.
 */

/**
 * - `full`: avatar, name, the stack and the bet, the cards in miniature and the total.
 * - `compact`: avatar, name, total, the stack and the bet, and a status icon; no cards.
 * - `small`: avatar with a status dot, total, the name shortened; the stack and the bet too where
 *   the tile is tall enough (a desktop).
 * - `dense`: an avatar chip with a total badge and a status dot.
 */
export type TileTier = 'full' | 'compact' | 'small' | 'dense';

/** Richest first. */
export const TIERS: readonly TileTier[] = ['full', 'compact', 'small', 'dense'];

/** The tier a table of `count` others usually takes: full to 4, compact to 9, small to 23, dense beyond (the room decides, tierFor). */
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
  /** The shortest the tile still reads: its rows give up this much before the tier steps down. */
  minHeight: number;
  /** The column counts the tier reads best at. */
  cols: readonly [number, number];
  /** The most columns the tier may spread to when the grid is short. */
  maxCols: number;
  /**
   * The narrowest the tile still reads (its name, its total, the Playing tag): a short grid never
   * spreads to columns narrower than this, the tiles get shorter instead.
   */
  minWidth: number;
}

export const TIER_SHAPES: Record<TileTier, TierShape> = {
  full: { width: 168, height: 96, minHeight: 94, cols: [1, 4], maxCols: 4, minWidth: 92 },
  compact: { width: 116, height: 68, minHeight: 52, cols: [3, 5], maxCols: 5, minWidth: 64 },
  small: { width: 70, height: 50, minHeight: 36, cols: [4, 6], maxCols: 10, minWidth: 44 },
  dense: { width: 46, height: 30, minHeight: 26, cols: [6, 8], maxCols: 14, minWidth: 24 },
};

/** A desktop table is wider than a phone: the tiles may be too, and a row of full tiles may run to eight. */
export const WIDE_TIER_SHAPES: Record<TileTier, TierShape> = {
  full: { width: 210, height: 122, minHeight: 90, cols: [1, 4], maxCols: 8, minWidth: 120 },
  compact: { width: 140, height: 60, minHeight: 54, cols: [3, 5], maxCols: 9, minWidth: 110 },
  small: { width: 84, height: 84, minHeight: 40, cols: [4, 8], maxCols: 9, minWidth: 64 },
  dense: { width: 52, height: 34, minHeight: 28, cols: [6, 10], maxCols: 12, minWidth: 48 },
};

/** The gap between tiles, in px (table.css reads it from the grid). */
export const GRID_GAP: Record<TileTier, number> = { full: 6, compact: 6, small: 4, dense: 4 };

/** How far the ends of a desktop row lift: a gentle arc for a few big tiles, barely a curve for many small ones (it costs height). */
export const ARC_LIFT: Record<TileTier, number> = { full: 16, compact: 16, small: 8, dense: 4 };

export interface GridOptions {
  wide?: boolean;
  tier?: TileTier;
}

/** A full tile before the deal (no seat has cards): its top rows alone, so an empty table never shows tall empty boxes. */
export const BARE_FULL_HEIGHT = 60;

/** The height a tile takes: its tier's, or a full tile's bare height while no seat has cards. */
export function tileHeight(tier: TileTier, wide: boolean, bare: boolean): number {
  return bare && tier === 'full' ? BARE_FULL_HEIGHT : shapeOf(tier, wide).height;
}

export function shapeOf(tier: TileTier, wide: boolean): TierShape {
  return (wide ? WIDE_TIER_SHAPES : TIER_SHAPES)[tier];
}

/** The gap between a desktop's rows includes the arc's lift, and the grid pads for the lifted ends. */
export function rowGapOf(tier: TileTier, wide: boolean): number {
  return GRID_GAP[tier] + (wide ? ARC_LIFT[tier] : 0);
}

export function paddingOf(tier: TileTier, wide: boolean): number {
  return wide ? ARC_LIFT[tier] + 2 : 0;
}

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
export function tileScale(count: number, cols: number, box: { width: number; height: number }, shape: TierShape, gap: number, rowGap: number = gap): number {
  const rows = Math.ceil(count / cols);
  const w = (box.width - (cols - 1) * gap) / cols;
  const h = (box.height - (rows - 1) * rowGap) / rows;
  return Math.min(1, w / shape.width, h / shape.height);
}

/** The most columns whose tiles are still wide enough to read (always at least one). */
function widestColumns(shape: TierShape, width: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (shape.minWidth + gap)));
}

/**
 * The columns that give the largest tiles in the box, among those whose rows keep the tile's
 * least height; on a tie (tiles already at their natural size) the tier's usual shape. Searched
 * over the tier's usual range first; a short box may spread further, up to the tier's limit, when
 * that makes the tiles clearly larger or is the only way to keep their height, but never to
 * columns narrower than the tier's minimum width (a narrow tile clips its name and total).
 */
export function fitGrid(count: number, box: { width: number; height: number } | null, { wide = false, tier = tileTier(count), gap = GRID_GAP[tier], rowGap = rowGapOf(tier, wide) }: GridOptions & { gap?: number; rowGap?: number } = {}): GridFit {
  const n = Math.max(1, count);
  const shape = shapeOf(tier, wide);
  const usualCols = Math.min(n, defaultColumns(count, tier));
  if (!box || box.width <= 0 || box.height <= 0) return { cols: usualCols, rows: Math.ceil(n / usualCols) };
  const tall = (cols: number): boolean => {
    const rows = Math.ceil(n / cols);
    return (box.height - (rows - 1) * rowGap) / rows >= shape.minHeight;
  };
  const best = (lo: number, hi: number): { cols: number; scale: number; tall: boolean } => {
    let pick = { cols: usualCols, scale: -1, tall: false };
    for (let c = Math.min(n, lo); c <= Math.min(n, hi); c++) {
      const scale = tileScale(n, c, box, shape, gap, rowGap);
      const keeps = tall(c);
      const larger = scale > pick.scale + 1e-6 || (Math.abs(scale - pick.scale) <= 1e-6 && Math.abs(c - usualCols) < Math.abs(pick.cols - usualCols));
      if ((keeps && !pick.tall) || (keeps === pick.tall && larger)) pick = { cols: c, scale, tall: keeps };
    }
    return pick;
  };
  const widest = widestColumns(shape, box.width, gap);
  const usual = best(Math.min(shape.cols[0], usualCols, widest), Math.min(shape.cols[1], widest));
  if (usual.scale >= 1) return { cols: usual.cols, rows: Math.ceil(n / usual.cols) };
  const spread = best(1, Math.min(shape.maxCols, widest));
  const pick = (spread.tall && !usual.tall) || (spread.tall === usual.tall && spread.scale > usual.scale + 0.02) ? spread : usual;
  return { cols: pick.cols, rows: Math.ceil(n / pick.cols) };
}

/**
 * The height the grid takes with its tiles at their natural size in a row `width` px wide, in the
 * tier's usual columns (as many as fit at the tier's least width), its row gap and padding
 * included: the most a table gives its seats, so a few tiles never take a tall band with empty
 * space round them. It goes by the width alone, never by the height the grid was given. Before
 * the deal (`bare`) the full tiles keep to their top rows.
 */
export function naturalHeight(count: number, width: number, { wide = false, tier = tileTier(count), bare = false }: GridOptions & { bare?: boolean } = {}): number {
  if (count <= 0) return 0;
  const shape = shapeOf(tier, wide);
  const cols = Math.min(count, defaultColumns(count, tier), widestColumns(shape, width, GRID_GAP[tier]));
  const rows = Math.ceil(count / cols);
  return rows * tileHeight(tier, wide, bare) + (rows - 1) * rowGapOf(tier, wide) + paddingOf(tier, wide);
}

/**
 * The least height a tier's grid takes for `count` tiles in a row `width` wide: its fewest rows
 * (as many columns as fit at the tile's least width, up to the tier's most) at the tile's least
 * height, with the gaps and the arc's padding.
 */
export function leastHeight(count: number, width: number, { wide = false, tier = tileTier(count) }: GridOptions = {}): number {
  if (count <= 0) return 0;
  const shape = shapeOf(tier, wide);
  const cols = Math.max(1, Math.min(count, shape.maxCols, widestColumns(shape, width, GRID_GAP[tier])));
  const rows = Math.ceil(count / cols);
  return rows * shape.minHeight + (rows - 1) * rowGapOf(tier, wide) + paddingOf(tier, wide);
}

/** The room the seats have: the width of their row, and the height the table's other rows leave. */
export interface Room {
  width: number;
  height: number;
}

/** Whether a tier's grid for `count` tiles has the room: its least height fits. */
export function fitsRoom(count: number, room: Room, { wide = false, tier = tileTier(count) }: GridOptions = {}): boolean {
  return leastHeight(count, room.width, { wide, tier }) <= room.height;
}

/** A richer tier takes over only with this much to spare, so a room that wobbles by a pixel never flips the tiles. */
const SPARE = 8;

/** The poorest tier a count may fall to when its usual one has no room: full gives up its cards for compact; the rest keep what they show (the stack and the bet stay on a compact tile). */
const LOWEST: Record<TileTier, TileTier> = { full: 'compact', compact: 'compact', small: 'small', dense: 'dense' };

/**
 * The tier the room allows: the richest, down to the count's own or one step under it, whose
 * least height fits the room, so the cards in miniature stay wherever the table has the height
 * for them (seven seats across a desktop) and the tiles step down where it has not (four seats
 * on a phone). When nothing fits, the count's usual tier, overflowing a little as it always did.
 * Before the room is measured, and on the server render, the count's usual tier. The tier on
 * show stays while it still fits.
 */
export function tierFor(count: number, room: Room | null, { wide = false, current = null }: { wide?: boolean; current?: TileTier | null } = {}): TileTier {
  const usual = tileTier(count);
  if (room === null || count <= 0) return usual;
  const richer = (tier: TileTier): boolean => current !== null && TIERS.indexOf(tier) < TIERS.indexOf(current);
  for (const tier of TIERS.slice(0, TIERS.indexOf(LOWEST[usual]) + 1)) {
    if (leastHeight(count, room.width, { wide, tier }) + (richer(tier) ? SPARE : 0) <= room.height) return tier;
  }
  return usual;
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
