/**
 * Blackjack's animation plan on the platform's table timeline: when each new card lands (in the
 * order a dealer deals), when the hole card turns over and the dealer's draws follow, when the
 * outcomes show, and the old cards going to the discards before a new deal. Pure, so the store can
 * plan and the tests can check it without a browser.
 */
import {
  DEAL_GAP_MS,
  DEAL_MS,
  FLIP_MS,
  MOVE_MS,
  OUTCOMES,
  beginPlan,
  faceDown,
  finishPlan,
  flipping,
  reached,
  snapTimeline as snapAt,
  type Frame as TableFrame,
  type Timeline as TableTimeline,
} from '../../../platform/table/timeline';
import { dealOrder, dealerKey, seatCards, type TableModel } from './table';

export { DEAL_GAP_MS, DEAL_MS, DISCARD_MS, FLIP_MS, MAX_BACKLOG_MS, MOVE_MS, OUTCOME_HOLD_MS, animating, cardMotion, cardShown, frameAt, nextEvent } from '../../../platform/table/timeline';

export const DEALER_GAP_MS = 500;
/** The beat between the dealer's last card and the outcomes. */
export const OUTCOME_DELAY_MS = 150;
/** A pause after the deal before a peeked dealer blackjack turns over. */
export const PEEK_PAUSE_MS = 300;

export type Timeline = TableTimeline<TableModel>;
export type Frame = TableFrame<TableModel>;

const HOLE = dealerKey(1);

export function snapTimeline(table: TableModel | null, now: number): Timeline {
  return snapAt<TableModel>(table?.round ?? null, now);
}

export const EMPTY_TIMELINE: Timeline = snapTimeline(null, 0);

function dealerIndex(key: string): number | null {
  return key.startsWith('d') ? Number(key.slice(1)) : null;
}

/** A card that left one slot of a seat and turned up in another: the half of a split that moves. */
function movedCard(prev: TableModel, next: TableModel, key: string): boolean {
  const [playerId] = key.split('/');
  const card = key.slice(key.lastIndexOf('/') + 1);
  const nextKeys = new Set(seatCards(next, playerId).keys());
  for (const [k, c] of seatCards(prev, playerId)) if (c === card && !nextKeys.has(k)) return true;
  return false;
}

/** When the hole card turns over; null while it is not planned to. */
export function holeFlipAt(timeline: Timeline): number | null {
  return timeline.flips[HOLE] ?? null;
}

/** When the settled outcomes show; null shows them at once. */
export function outcomesAt(timeline: Timeline): number | null {
  return timeline.marks[OUTCOMES] ?? null;
}

/**
 * Plans the next timeline from the previous one. `fresh` is a first snapshot (nothing to animate
 * from); `motion` is false under prefers-reduced-motion.
 */
export function planTimeline(prev: Timeline, prevTable: TableModel | null, next: TableModel | null, now: number, fresh: boolean, motion: boolean): Timeline {
  if (!next) return snapTimeline(null, now);
  const draft = beginPlan({ prev, prevTable, prevId: prevTable?.round ?? null, nextId: next.round, now, fresh, motion });
  if (!draft) return snapTimeline(next, now);
  const { tl, same, start } = draft;

  const known = new Set(same && prevTable ? dealOrder(prevTable) : []);
  let t = start;
  let cursor = start;
  let added = false;
  const draws: string[] = [];
  for (const key of dealOrder(next)) {
    if (known.has(key) || tl.arrivals[key] !== undefined) continue;
    const d = dealerIndex(key);
    if (d !== null && d >= 2) {
      draws.push(key);
      continue;
    }
    added = true;
    if (same && prevTable && d === null && movedCard(prevTable, next, key)) {
      tl.arrivals[key] = start;
      tl.moved[key] = true;
      cursor = Math.max(cursor, start + MOVE_MS);
      continue;
    }
    tl.arrivals[key] = t;
    cursor = t + DEAL_MS;
    t += DEAL_GAP_MS;
  }

  const holeShown = next.dealer.length >= 2 && next.dealer[1] !== null;
  const holeWasDown = same && prevTable !== null && prevTable.dealer[1] === null;
  if (holeShown && (!same || holeWasDown)) {
    tl.flips[HOLE] = cursor + (same ? 0 : PEEK_PAUSE_MS);
    cursor = tl.flips[HOLE] + FLIP_MS;
    added = true;
  }
  const flipAt = holeFlipAt(tl);
  draws.forEach((key, k) => {
    const at = (flipAt ?? cursor) + FLIP_MS + 100 + k * DEALER_GAP_MS;
    tl.arrivals[key] = Math.max(at, t);
    cursor = tl.arrivals[key] + DEAL_MS;
    added = true;
  });

  if (next.settled && !(same && prevTable?.settled)) {
    tl.marks[OUTCOMES] = cursor + OUTCOME_DELAY_MS;
    cursor = tl.marks[OUTCOMES];
    added = true;
  }
  return finishPlan(draft, cursor, added);
}

export function holeFaceDown(timeline: Timeline, now: number): boolean {
  return faceDown(timeline, HOLE, now);
}

/** The hole card is turning over right now. */
export function holeFlipping(timeline: Timeline, now: number): boolean {
  return flipping(timeline, HOLE, now);
}

export function outcomesShown(timeline: Timeline, now: number): boolean {
  return reached(timeline, OUTCOMES, now);
}
