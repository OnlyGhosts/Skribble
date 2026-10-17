/**
 * How a row of hands fits its space (pure, for the components and the tests): every hand full
 * size while they fit side by side, otherwise only the hand in play full size and the rest as
 * compact chips (total, stake, outcome colour), the chips packed in a grid beside it. Chips never
 * shrink below a readable size: past what fits, the ones furthest from the hand in play fold into
 * one "+N" chip that opens the seat's sheet with every hand.
 */

export type HandSlot = 'full' | 'chip';

/** Where a row of hands sits: my hands on the stage, or another player's there when I am not dealt in. */
export type HandPlace = 'mine' | 'stage';

/**
 * The narrowest a full hand still reads: three cards fanned at the smallest card size, its pill
 * over them, its outline. A row also keeps each full hand as wide as the words over its corner
 * (its stake and total), measured as it lays out (HandRow).
 */
export const MIN_FULL_HAND_PX: Record<HandPlace, number> = { mine: 72, stage: 64 };
/**
 * A chip's smallest readable size: its two-digit total (the big totals' font on the stage, a
 * tile's beside it) inside its pill.
 */
export const MIN_CHIP_PX = { width: 34, height: 24, stage: 28 } as const;
/** The gap between two hands, and between two chips. */
export const HAND_GAP_PX = 8;
export const CHIP_GAP_PX = 4;
/** Another player's chips on the stage stay in this many rows. */
export const STAGE_CHIP_ROWS = 2;

/** How many of `size` px (with `gap` between) fit in `space` px; at least one. */
export function fitCount(space: number, size: number, gap = CHIP_GAP_PX): number {
  return Math.max(1, Math.floor((space + gap) / (size + gap)));
}

/** How many full hands fit side by side in `width` px (always at least one). */
export function fullHandsFit(width: number, minHand: number): number {
  return fitCount(width, minHand, HAND_GAP_PX);
}

/**
 * Each hand's slot, left to right: all full while `count` fit (`maxFull`); beyond that the hand in
 * play stays full and every other hand becomes a chip (no hand in play: all chips).
 */
export function handSlots(count: number, activeIndex: number, maxFull: number): HandSlot[] {
  const collapse = count > Math.max(1, maxFull);
  return Array.from({ length: count }, (_, i) => (!collapse || i === activeIndex ? 'full' : 'chip'));
}

export interface ChipGrid {
  cols: number;
  rows: number;
  /** Chips shown one by one; when it is less than the chips, one more slot holds the "+N" for the rest. */
  shown: number;
}

/**
 * The chips' grid in a `width` px zone: the fewest rows (up to `maxRows`) that let every column
 * keep a readable width, the chips spread evenly over them (7 chips in rows of 4 and 3, not 6 and
 * 1). A column never narrows below `minWidth`: once the grid is full, its last slot is a "+N".
 */
export function chipGrid(chips: number, width: number, maxRows: number, minWidth: number = MIN_CHIP_PX.width): ChipGrid {
  if (chips <= 0) return { cols: 0, rows: 0, shown: 0 };
  const perRow = fitCount(width, minWidth);
  const capacity = perRow * Math.max(1, maxRows);
  if (chips > capacity) return { cols: perRow, rows: Math.max(1, maxRows), shown: capacity - 1 };
  const rows = Math.max(1, Math.ceil(chips / perRow));
  return { cols: Math.ceil(chips / rows), rows, shown: chips };
}

/**
 * Which of the chip hands (`indexes`, left to right) keep a chip of their own when only `shown`
 * fit: the ones nearest the hand in play (`activeIndex`; the first ones when none is), a hand still
 * to play before one already played. The rest go into the "+N".
 */
export function chipsShown(indexes: readonly number[], shown: number, activeIndex: number): Set<number> {
  if (shown >= indexes.length) return new Set(indexes);
  const near = [...indexes].sort((a, b) => Math.abs(a - activeIndex) - Math.abs(b - activeIndex) || b - a);
  return new Set(near.slice(0, Math.max(0, shown)));
}
