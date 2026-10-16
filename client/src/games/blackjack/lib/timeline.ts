/**
 * Blackjack's animation plan on the platform's table timeline: when each new card lands (in the
 * order a dealer deals), when the hole card turns over and the dealer's draws follow, when the
 * outcomes show, and the old cards going to the discards before a new deal. Pure, so the store can
 * plan and the tests can check it without a browser.
 */
import {
  DEAL_MS,
  FLIP_MS,
  MOVE_MS,
  OUTCOMES,
  beginPlan,
  faceDown,
  finishPlan,
  flipping,
  landed,
  reached,
  snapTimeline as snapAt,
  type Frame as TableFrame,
  type Timeline as TableTimeline,
} from '../../../platform/table/timeline';
import { BLACKJACK_REVEAL, dealGapMs } from '@shared/games/blackjack/deal';
import { cardKey, dealOrder, dealerKey, seatCards, type TableModel } from './table';

export { DEAL_GAP_MS, DEAL_MS, DISCARD_MS, FLIP_MS, MAX_BACKLOG_MS, MOVE_MS, OUTCOME_HOLD_MS, animating, cardMotion, cardShown, frameAt, landed, nextEvent } from '../../../platform/table/timeline';

/**
 * The reveal's pace is shared with the server (shared/games/blackjack/deal.ts), which keeps the
 * settled table on show exactly as long as the reveal takes here, so the bets open the moment the
 * outcomes show.
 */
export const DEALER_GAP_MS = BLACKJACK_REVEAL.draw;
/** The deal's pace is shared with the server, which gives the first turn the time the deal takes to show. */
export { BIG_DEAL_MS, MIN_DEAL_GAP_MS, dealGapMs } from '@shared/games/blackjack/deal';
/** The beat between the dealer's last card and the outcomes. */
export const OUTCOME_DELAY_MS = BLACKJACK_REVEAL.outcome;
/** A pause after the deal before a peeked dealer blackjack turns over. */
export const PEEK_PAUSE_MS = BLACKJACK_REVEAL.peekPause;
/** The beat after the hole card turns before the dealer's first draw. */
export const DRAW_BEAT_MS = BLACKJACK_REVEAL.beat;

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
 * from); `motion` is false under prefers-reduced-motion; `hold` is how long the last round's
 * outcomes stay up before a new deal clears them (OUTCOME_HOLD_MS unless given).
 */
export function planTimeline(prev: Timeline, prevTable: TableModel | null, next: TableModel | null, now: number, fresh: boolean, motion: boolean, hold?: number): Timeline {
  if (!next) return snapTimeline(null, now);
  const draft = beginPlan({ prev, prevTable, prevId: prevTable?.round ?? null, nextId: next.round, now, fresh, motion, ...(hold !== undefined ? { hold } : {}) });
  if (!draft) return snapTimeline(next, now);
  const { tl, same, start } = draft;

  const known = new Set(same && prevTable ? dealOrder(prevTable) : []);
  const newKeys = dealOrder(next).filter((key) => !known.has(key) && tl.arrivals[key] === undefined);
  const moving = new Set(same && prevTable ? newKeys.filter((key) => dealerIndex(key) === null && movedCard(prevTable, next, key)) : []);
  let cursor = start;
  let added = false;
  // A split's moving card slides over first; the new cards are dealt once it is in place.
  for (const key of moving) {
    tl.arrivals[key] = start;
    tl.moved[key] = true;
    cursor = start + MOVE_MS;
    added = true;
  }
  let t = cursor;
  const gap = dealGapMs(newKeys.filter((key) => !moving.has(key) && (dealerIndex(key) ?? 0) < 2).length);
  const draws: string[] = [];
  for (const key of newKeys) {
    if (moving.has(key)) continue;
    const d = dealerIndex(key);
    if (d !== null && d >= 2) {
      draws.push(key);
      continue;
    }
    added = true;
    tl.arrivals[key] = t;
    cursor = t + DEAL_MS;
    t += gap;
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
    const at = (flipAt ?? cursor) + FLIP_MS + DRAW_BEAT_MS + k * DEALER_GAP_MS;
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

/**
 * My moves may go once the cards they depend on have landed: my hand in play and the dealer's up
 * card. The rest of the deal (the other seats, the hole card) can still be sliding in.
 */
export function myHandLanded(timeline: Timeline, table: TableModel | null, meId: string, handIndex: number, now: number): boolean {
  const hand = table?.hands[meId]?.[handIndex];
  if (!table || !hand || (timeline.discard && now < timeline.discard.until)) return false;
  return landed(timeline, dealerKey(0), now) && hand.cards.every((card, i) => landed(timeline, cardKey(meId, handIndex, i, card), now));
}
