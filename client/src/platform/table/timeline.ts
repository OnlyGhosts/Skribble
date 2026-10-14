/**
 * The card-table animation queue, shared by the card games: a timeline planned from two snapshots
 * of a table that says when each card slides in (from the deck, or a short move within a seat),
 * when a face-down card turns over, when a card leaves for the discards, when named moments come
 * (the outcomes), which chips fly between two places on the table, how a shown number steps on its
 * way to the truth, and when the old table clears before a new one is dealt. Times are local epoch
 * ms. Pure, so a game's store can plan and the tests can check it without a browser.
 *
 * A game writes its own planner on top (what is new between two of its tables, in what order a
 * dealer would do it) with beginPlan / finishPlan; the queries below draw any timeline. The
 * animation never runs far behind the truth: a backlog longer than MAX_BACKLOG_MS, a fresh entry
 * (welcome, reconnect) or reduced motion snaps the table to the snapshot at once.
 */

export const DEAL_MS = 250;
export const DEAL_GAP_MS = 150;
export const MOVE_MS = 200;
export const FLIP_MS = 400;
export const DISCARD_MS = 300;
/** A stack of chips sliding from one place on the table to another. */
export const CHIP_MS = 300;
/** How long finished outcomes stay up before a quick next deal clears them. */
export const OUTCOME_HOLD_MS = 900;
export const MAX_BACKLOG_MS = 3000;

/** The mark for the moment a table's outcomes show. */
export const OUTCOMES = 'outcomes';

/** Chips moving between two anchors (elements carrying `data-table-anchor`). */
export interface Flight {
  id: string;
  from: string;
  to: string;
  amount: number;
  at: number;
  ms: number;
}

/** A number on show that steps towards the truth: `from` until the first step, then each step's value from its time. */
export interface Tween {
  from: number;
  steps: { at: number; value: number }[];
}

export interface Discard<T> {
  table: T;
  timeline: Timeline<T>;
  /** The old cards start for the discard tray. */
  from: number;
  /** The new deal takes the table. */
  until: number;
}

export interface Timeline<T> {
  /** The table this describes (a round, a hand); null with nothing on the table. */
  id: number | null;
  /** Card key to the time it starts sliding in. A card without an entry is already on the table. */
  arrivals: Record<string, number>;
  /** Keys of cards that only moved within a seat (a split) rather than coming from the deck. */
  moved: Record<string, true>;
  /** Card key to the time it turns face up; it shows face down before. */
  flips: Record<string, number>;
  /** Card key to the time it starts for the discards (a folded hand). */
  departures: Record<string, number>;
  /** Named moments (OUTCOMES); a moment without an entry has come. */
  marks: Record<string, number>;
  flights: Flight[];
  /** Shown numbers by name; a name without an entry shows the truth. */
  values: Record<string, Tween>;
  discard: Discard<T> | null;
  /** Everything has landed. */
  endsAt: number;
}

export function snapTimeline<T>(id: number | null, now: number): Timeline<T> {
  return { id, arrivals: {}, moved: {}, flips: {}, departures: {}, marks: {}, flights: [], values: {}, discard: null, endsAt: now };
}

export function emptyTimeline<T>(): Timeline<T> {
  return snapTimeline<T>(null, 0);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** A timeline being planned: a game adds to `tl` from `start`, then calls finishPlan. */
export interface Draft<T> {
  tl: Timeline<T>;
  /** The same table as the previous plan (a move within a round), rather than a new one. */
  same: boolean;
  /** When the new animation may begin: after what is still landing, or after the discards. */
  start: number;
  prev: Timeline<T>;
}

export interface PlanInput<T> {
  prev: Timeline<T>;
  prevTable: T | null;
  prevId: number | null;
  nextId: number;
  now: number;
  /** A first snapshot (a welcome, a reconnect): nothing to animate from. */
  fresh: boolean;
  /** False under prefers-reduced-motion. */
  motion: boolean;
  /** How long the old table's outcomes stay up before it clears; OUTCOME_HOLD_MS by default. */
  hold?: number;
}

/**
 * Starts a plan from the previous timeline: the same table carries on after what is still
 * landing, a new one waits for the old cards to go to the discards. Null means show the truth at
 * once (a fresh entry, reduced motion, or a backlog too long to be worth playing).
 */
export function beginPlan<T>({ prev, prevTable, prevId, nextId, now, fresh, motion, hold = OUTCOME_HOLD_MS }: PlanInput<T>): Draft<T> | null {
  if (fresh || !motion) return null;
  const same = prevTable !== null && prevId === nextId && prev.id === nextId;
  const tl = same ? { ...prev, arrivals: { ...prev.arrivals }, moved: { ...prev.moved }, flips: { ...prev.flips }, departures: { ...prev.departures }, marks: { ...prev.marks }, flights: [...prev.flights], values: { ...prev.values } } : snapTimeline<T>(nextId, now);
  let start = now;
  if (same) start = Math.max(now, prev.endsAt);
  else if (prevTable !== null && prev.id === prevId) {
    const outcomes = prev.marks[OUTCOMES];
    const shownUntil = outcomes !== undefined ? Math.max(prev.endsAt, outcomes + hold) : prev.endsAt;
    const from = Math.max(now, shownUntil);
    tl.discard = { table: prevTable, timeline: { ...prev, discard: null }, from, until: from + DISCARD_MS };
    start = tl.discard.until;
  }
  if (start - now > MAX_BACKLOG_MS) return null;
  return { tl, same, start, prev };
}

/** Ends a plan whose last animation finishes at `cursor`; a plan that added nothing to the same table keeps the previous timeline. */
export function finishPlan<T>(draft: Draft<T>, cursor: number, added: boolean): Timeline<T> {
  const { tl, same, prev } = draft;
  if (same && !added) return prev;
  return { ...tl, endsAt: Math.max(cursor, same ? prev.endsAt : 0, tl.discard?.until ?? 0) };
}

/** A shown number that holds `from` and then steps to each value at its time (appended to any steps already planned). */
export function tween<T>(tl: Timeline<T>, name: string, from: number, at: number, value: number): void {
  const current = tl.values[name];
  tl.values[name] = current ? { from: current.from, steps: [...current.steps, { at, value }] } : { from, steps: [{ at, value }] };
}

// ---------------------------------------------------------------------------
// Queries: what the table looks like at `now`
// ---------------------------------------------------------------------------

/** What the screen draws at `now`: the old table on its way to the discards, or the current one. */
export interface Frame<T> {
  table: T | null;
  timeline: Timeline<T>;
  /** The old cards are on their way to the discard tray. */
  leaving: boolean;
}

export function frameAt<T>(timeline: Timeline<T>, table: T | null, now: number): Frame<T> {
  const { discard } = timeline;
  if (discard && now < discard.until) return { table: discard.table, timeline: discard.timeline, leaving: now >= discard.from };
  return { table, timeline, leaving: false };
}

export function cardShown<T>(timeline: Timeline<T>, key: string, now: number): boolean {
  const at = timeline.arrivals[key];
  return at === undefined || now >= at;
}

/** How a card that is landing right now comes in: from the deck, from its old slot, or not at all. */
export function cardMotion<T>(timeline: Timeline<T>, key: string, now: number): 'deal' | 'move' | null {
  const at = timeline.arrivals[key];
  if (at === undefined || now < at || now - at >= DEAL_MS) return null;
  return timeline.moved[key] ? 'move' : 'deal';
}

export function faceDown<T>(timeline: Timeline<T>, key: string, now: number): boolean {
  const at = timeline.flips[key];
  return at !== undefined && now < at;
}

/** The card is turning over right now. */
export function flipping<T>(timeline: Timeline<T>, key: string, now: number): boolean {
  const at = timeline.flips[key];
  return at !== undefined && now >= at && now < at + FLIP_MS;
}

/**
 * Where a card the truth has taken off the table is at `now`: still in its place, on its way to
 * the discards, or gone. Without a planned departure (a snap) it is gone.
 */
export function departure<T>(timeline: Timeline<T>, key: string, now: number): 'here' | 'leaving' | 'gone' {
  const at = timeline.departures[key];
  if (at === undefined || now >= at + DISCARD_MS) return 'gone';
  return now < at ? 'here' : 'leaving';
}

export function reached<T>(timeline: Timeline<T>, mark: string, now: number): boolean {
  const at = timeline.marks[mark];
  return at === undefined || now >= at;
}

/** The number on show for `name`: the truth, unless the timeline is still stepping towards it. */
export function valueAt<T>(timeline: Timeline<T>, name: string, truth: number, now: number): number {
  const t = timeline.values[name];
  if (!t) return truth;
  let value = t.from;
  for (const step of t.steps) if (now >= step.at) value = step.value;
  return value;
}

/** The chips in the air at `now`. */
export function flightsAt<T>(timeline: Timeline<T>, now: number): Flight[] {
  return timeline.flights.filter((f) => now >= f.at && now < f.at + f.ms);
}

export function animating<T>(timeline: Timeline<T>, now: number): boolean {
  return now < timeline.endsAt;
}

/** The next moment the drawing changes, for the screen's clock; null once everything has landed. */
export function nextEvent<T>(timeline: Timeline<T>, now: number): number | null {
  const times: number[] = [timeline.endsAt];
  for (const at of Object.values(timeline.arrivals)) times.push(at, at + DEAL_MS);
  for (const at of Object.values(timeline.flips)) times.push(at, at + FLIP_MS);
  for (const at of Object.values(timeline.departures)) times.push(at, at + DISCARD_MS);
  times.push(...Object.values(timeline.marks));
  for (const f of timeline.flights) times.push(f.at, f.at + f.ms);
  for (const t of Object.values(timeline.values)) for (const step of t.steps) times.push(step.at);
  if (timeline.discard) {
    times.push(timeline.discard.from, timeline.discard.until);
    const inner = nextEvent(timeline.discard.timeline, now);
    if (inner !== null) times.push(inner);
  }
  const future = times.filter((t) => t > now);
  return future.length > 0 ? Math.min(...future) : null;
}
