/**
 * The animation timeline, planned from two snapshots of the table: when each new card lands (in
 * the order a dealer deals), when the hole card turns over and the dealer's draws follow, when the
 * outcomes show, and the old cards going to the discards before a new deal. Times are local epoch
 * ms. Pure, so the store can plan and the tests can check it without a browser.
 *
 * The animation never runs far behind the truth: a backlog longer than MAX_BACKLOG_MS, a fresh
 * entry (welcome, reconnect) or reduced motion snaps the table to the snapshot at once.
 */
import { dealOrder, seatCards, type TableModel } from './table';

export const DEAL_MS = 250;
export const DEAL_GAP_MS = 150;
export const MOVE_MS = 200;
export const FLIP_MS = 400;
export const DEALER_GAP_MS = 500;
/** The beat between the dealer's last card and the outcomes. */
export const OUTCOME_DELAY_MS = 150;
/** How long finished outcomes stay up before a quick next deal clears them. */
export const OUTCOME_HOLD_MS = 900;
export const DISCARD_MS = 300;
/** A pause after the deal before a peeked dealer blackjack turns over. */
export const PEEK_PAUSE_MS = 300;
export const MAX_BACKLOG_MS = 3000;

export interface Discard {
  table: TableModel;
  timeline: Timeline;
  /** The old cards start for the discard tray. */
  from: number;
  /** The new deal takes the table. */
  until: number;
}

export interface Timeline {
  /** The table round this describes; null with nothing on the table. */
  round: number | null;
  /** Card key to the time it starts sliding in. A card without an entry is already on the table. */
  arrivals: Record<string, number>;
  /** Keys of cards that only moved within a seat (a split) rather than coming from the shoe. */
  moved: Record<string, true>;
  /** The hole card turns over; it shows face down before. */
  flipAt: number | null;
  /** The settled outcomes show from here; null shows them at once. */
  outcomesAt: number | null;
  discard: Discard | null;
  /** Everything has landed. */
  endsAt: number;
}

export function snapTimeline(table: TableModel | null, now: number): Timeline {
  return { round: table?.round ?? null, arrivals: {}, moved: {}, flipAt: null, outcomesAt: null, discard: null, endsAt: now };
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

/**
 * Plans the next timeline from the previous one. `fresh` is a first snapshot (nothing to animate
 * from); `motion` is false under prefers-reduced-motion.
 */
export function planTimeline(prev: Timeline, prevTable: TableModel | null, next: TableModel | null, now: number, fresh: boolean, motion: boolean): Timeline {
  if (!next) return snapTimeline(null, now);
  if (fresh || !motion) return snapTimeline(next, now);
  const same = prevTable !== null && prevTable.round === next.round && prev.round === next.round;

  let start = now;
  let discard: Discard | null = null;
  const arrivals: Record<string, number> = same ? { ...prev.arrivals } : {};
  const moved: Record<string, true> = same ? { ...prev.moved } : {};
  const known = new Set(same && prevTable ? dealOrder(prevTable) : []);
  if (same) start = Math.max(now, prev.endsAt);
  else if (prevTable && prev.round === prevTable.round) {
    // The last round's cards go to the discards once its outcomes have had a moment on screen.
    const shownUntil = prev.outcomesAt !== null ? Math.max(prev.endsAt, prev.outcomesAt + OUTCOME_HOLD_MS) : prev.endsAt;
    const from = Math.max(now, shownUntil);
    discard = { table: prevTable, timeline: { ...prev, discard: null }, from, until: from + DISCARD_MS };
    start = discard.until;
  }
  if (start - now > MAX_BACKLOG_MS) return snapTimeline(next, now);

  let t = start;
  let cursor = start;
  let added = false;
  const draws: string[] = [];
  for (const key of dealOrder(next)) {
    if (known.has(key) || arrivals[key] !== undefined) continue;
    const d = dealerIndex(key);
    if (d !== null && d >= 2) {
      draws.push(key);
      continue;
    }
    added = true;
    if (same && prevTable && d === null && movedCard(prevTable, next, key)) {
      arrivals[key] = start;
      moved[key] = true;
      cursor = Math.max(cursor, start + MOVE_MS);
      continue;
    }
    arrivals[key] = t;
    cursor = t + DEAL_MS;
    t += DEAL_GAP_MS;
  }

  let flipAt = same ? prev.flipAt : null;
  const holeShown = next.dealer.length >= 2 && next.dealer[1] !== null;
  const holeWasDown = same && prevTable !== null && prevTable.dealer[1] === null;
  if (holeShown && (!same || holeWasDown)) {
    flipAt = cursor + (same ? 0 : PEEK_PAUSE_MS);
    cursor = flipAt + FLIP_MS;
    added = true;
  }
  draws.forEach((key, k) => {
    const at = (flipAt ?? cursor) + FLIP_MS + 100 + k * DEALER_GAP_MS;
    arrivals[key] = Math.max(at, t);
    cursor = arrivals[key] + DEAL_MS;
    added = true;
  });

  let outcomesAt = same ? prev.outcomesAt : null;
  if (next.settled && !(same && prevTable?.settled)) {
    outcomesAt = cursor + OUTCOME_DELAY_MS;
    cursor = outcomesAt;
    added = true;
  }
  if (same && !added) return prev;
  return { round: next.round, arrivals, moved, flipAt, outcomesAt, discard, endsAt: Math.max(cursor, same ? prev.endsAt : 0, discard?.until ?? 0) };
}

/** What the screen draws at `now`: the old table on its way to the discards, or the current one. */
export interface Frame {
  table: TableModel | null;
  timeline: Timeline;
  /** The old cards are on their way to the discard tray. */
  leaving: boolean;
}

export function frameAt(timeline: Timeline, table: TableModel | null, now: number): Frame {
  const { discard } = timeline;
  if (discard && now < discard.until) return { table: discard.table, timeline: discard.timeline, leaving: now >= discard.from };
  return { table, timeline, leaving: false };
}

export function cardShown(timeline: Timeline, key: string, now: number): boolean {
  const at = timeline.arrivals[key];
  return at === undefined || now >= at;
}

/** How a card that is landing right now comes in: from the shoe, from its old slot, or not at all. */
export function cardMotion(timeline: Timeline, key: string, now: number): 'deal' | 'move' | null {
  const at = timeline.arrivals[key];
  if (at === undefined || now < at || now - at >= DEAL_MS) return null;
  return timeline.moved[key] ? 'move' : 'deal';
}

export function holeFaceDown(timeline: Timeline, now: number): boolean {
  return timeline.flipAt !== null && now < timeline.flipAt;
}

/** The hole card is turning over right now. */
export function holeFlipping(timeline: Timeline, now: number): boolean {
  return timeline.flipAt !== null && now >= timeline.flipAt && now < timeline.flipAt + FLIP_MS;
}

export function outcomesShown(timeline: Timeline, now: number): boolean {
  return timeline.outcomesAt === null || now >= timeline.outcomesAt;
}

export function animating(timeline: Timeline, now: number): boolean {
  return now < timeline.endsAt;
}

/** The next moment the drawing changes, for the screen's clock; null once everything has landed. */
export function nextEvent(timeline: Timeline, now: number): number | null {
  const times: number[] = [...Object.values(timeline.arrivals), ...Object.values(timeline.arrivals).map((t) => t + DEAL_MS), timeline.endsAt];
  if (timeline.flipAt !== null) times.push(timeline.flipAt, timeline.flipAt + FLIP_MS);
  if (timeline.outcomesAt !== null) times.push(timeline.outcomesAt);
  if (timeline.discard) {
    times.push(timeline.discard.from, timeline.discard.until);
    const inner = nextEvent(timeline.discard.timeline, now);
    if (inner !== null) times.push(inner);
  }
  const future = times.filter((t) => t > now);
  return future.length > 0 ? Math.min(...future) : null;
}
