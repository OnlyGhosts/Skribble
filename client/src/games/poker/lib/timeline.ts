/**
 * Poker's animation plan on the platform's table timeline, from two snapshots of the hand: the
 * blinds going in and the hole cards dealt round from the button, every bet sliding from its seat
 * to its spot, the bets swept into the pot when a street closes, the board coming out (three
 * cards, then one, then one, each sliding out face down and turning over), folded cards going to
 * the muck, the hands turning over at a showdown and the pot sliding to the winners. Pure, so the
 * store can plan and the tests can check it without a browser.
 */
import { dealGapMs } from '@shared/games/poker/reveal';
import {
  CHIP_MS,
  DEAL_GAP_MS,
  DEAL_MS,
  FLIP_MS,
  OUTCOMES,
  beginPlan,
  finishPlan,
  reached,
  snapTimeline as snapAt,
  tween,
  type Draft,
  type Frame as TableFrame,
  type Timeline as TableTimeline,
} from '../../../platform/table/timeline';
import { boardKey, committedBefore, dealingOrder, holding, holeKey, potsTotal, winnings, type PokerTable } from './table';

export { CHIP_MS, DEAL_GAP_MS, DEAL_MS, DISCARD_MS, FLIP_MS, MAX_BACKLOG_MS, animating, cardMotion, cardShown, departure, faceDown, flightsAt, flipping, frameAt, nextEvent, valueAt } from '../../../platform/table/timeline';

/** The pot sliding over to a winner. */
export const PAY_MS = 500;
/** The beat between the bets landing and the sweep, and between one street's cards and the next. */
export const SWEEP_GAP_MS = 150;
export const STREET_GAP_MS = 300;
/** The beat before the hands turn over, and before the winners light up. */
export const SHOWDOWN_GAP_MS = 250;
/** The mark from which a winner's payout shows on its seat. */
export const PAID = 'paid';

export type Timeline = TableTimeline<PokerTable>;
export type Frame = TableFrame<PokerTable>;

export function snapTimeline(table: PokerTable | null, now: number): Timeline {
  return snapAt<PokerTable>(table?.hand ?? null, now);
}

export const EMPTY_TIMELINE: Timeline = snapTimeline(null, 0);

/** Names of the numbers the table shows on their way to the truth. */
export const betValue = (id: string): string => `bet:${id}`;
export const chipsValue = (id: string): string => `chips:${id}`;
export const POT_VALUE = 'pot';
/** Anchors (data-table-anchor) the chips fly between. */
export const seatAnchor = (id: string): string => `seat:${id}`;
export const betAnchor = (id: string): string => `bet:${id}`;
export const POT_ANCHOR = 'pot';

/** The hand just before its first card: nothing bet, nothing on the board. */
function dealtOut(next: PokerTable): PokerTable {
  const seats: PokerTable['seats'] = {};
  for (const id of next.order) seats[id] = { cards: [], status: 'waiting', bet: 0, committed: 0, chips: next.seats[id].chips };
  return { ...next, street: 'preflop', community: [], pot: 0, pots: [], seats, results: null };
}

const STREET_CARDS: number[][] = [[0, 1, 2], [3], [4]];

/** The street's bet each seat ended on: its bet now, or, once the street closed, everything it put in since `prev`'s street opened. */
function finalBets(prev: PokerTable, next: PokerTable, closed: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of next.order) {
    out[id] = closed ? Math.max(0, committedBefore(next, id) - committedBefore(prev, id)) : (next.seats[id]?.bet ?? 0);
  }
  return out;
}

/**
 * Plans the moves from `prev` to `next` (the same hand, or a fresh deal from nothing) from
 * `start`, writing into the draft; returns when the last one ends.
 */
function progress(draft: Draft<PokerTable>, prev: PokerTable, next: PokerTable, meId: string | null, dealing: boolean): { cursor: number; added: boolean } {
  const { tl, start } = draft;
  let cursor = start;
  let added = false;
  const won = winnings(next.results);
  const stackBeforePay = (id: string) => (next.seats[id]?.chips ?? 0) - (won[id] ?? 0);

  // The hole cards, two rounds from the left of the button (quicker at a big table).
  if (dealing) {
    const order = dealingOrder(next);
    const gap = dealGapMs(order.reduce((n, id) => n + Math.min(2, next.seats[id].cards.length), 0));
    let t = start;
    for (const round of [0, 1]) {
      for (const id of order) {
        if (next.seats[id].cards.length <= round) continue;
        tl.arrivals[holeKey(id, round)] = t;
        cursor = t + DEAL_MS;
        t += gap;
        added = true;
      }
    }
  }

  // The bets (the blinds on a fresh deal) slide from each seat to its spot.
  const closed = next.results !== null || next.street !== prev.street;
  const bets = finalBets(prev, next, closed);
  const middle = next.results ? potsTotal(next.results) : next.pot;
  let moved = false;
  for (const id of next.order) {
    const before = prev.seats[id]?.bet ?? 0;
    const after = bets[id];
    if (after === before) continue;
    if (after > before) {
      tl.flights.push({ id: `${tl.flights.length}:${betAnchor(id)}`, from: seatAnchor(id), to: betAnchor(id), amount: after - before, at: start, ms: CHIP_MS });
      tween(tl, chipsValue(id), stackBeforePay(id) + after - before, start, stackBeforePay(id));
      tween(tl, betValue(id), before, start + CHIP_MS, after);
      moved = true;
    } else tween(tl, betValue(id), before, start, after);
    added = true;
  }
  if (moved) {
    tween(tl, POT_VALUE, prev.pot, start + CHIP_MS, middle);
    cursor = Math.max(cursor, start + CHIP_MS);
  }

  // Folded hands go to the muck (my own stay in front of me, dimmed).
  for (const id of next.order) {
    if (id === meId || holding(next.seats[id]) || !holding(prev.seats[id])) continue;
    next.seats[id].cards.forEach((_, i) => {
      tl.departures[holeKey(id, i)] = start;
    });
    added = true;
  }

  // The street closed: every bet swept into the pot.
  if (closed) {
    const sweep = cursor + (moved ? SWEEP_GAP_MS : 0);
    for (const id of next.order) {
      if (bets[id] <= 0) continue;
      tl.flights.push({ id: `${tl.flights.length}:sweep:${id}`, from: betAnchor(id), to: POT_ANCHOR, amount: bets[id], at: sweep, ms: CHIP_MS });
      tween(tl, betValue(id), bets[id], sweep, 0);
      added = true;
      cursor = sweep + CHIP_MS;
    }
  }

  // The board: each street's cards slide out face down one after another, then turn over together.
  let first = true;
  for (const group of STREET_CARDS) {
    const fresh = group.filter((i) => i >= prev.community.length && i < next.community.length);
    if (fresh.length === 0) continue;
    let t = cursor + (first ? (added ? SWEEP_GAP_MS : 0) : STREET_GAP_MS);
    first = false;
    for (const i of fresh) {
      tl.arrivals[boardKey(i)] = t;
      t += DEAL_GAP_MS;
    }
    const flipAt = t - DEAL_GAP_MS + DEAL_MS;
    for (const i of fresh) tl.flips[boardKey(i)] = flipAt;
    cursor = flipAt + FLIP_MS;
    added = true;
  }

  // The end of the hand: the hands turn over, the winners light up and the pot slides to them.
  if (next.results && !prev.results) {
    if (!next.results.uncontested) {
      const flipAt = cursor + SHOWDOWN_GAP_MS;
      let flipped = false;
      for (const id of Object.keys(next.results.revealed)) {
        if (id === meId || !next.seats[id]) continue;
        next.seats[id].cards.forEach((_, i) => {
          tl.flips[holeKey(id, i)] = flipAt;
        });
        flipped = true;
      }
      if (flipped) cursor = flipAt + FLIP_MS;
    }
    const outcomes = cursor + SHOWDOWN_GAP_MS;
    tl.marks[OUTCOMES] = outcomes;
    tl.marks[PAID] = outcomes + PAY_MS;
    tween(tl, POT_VALUE, middle, outcomes, 0);
    for (const pot of next.results.pots) {
      for (const w of pot.winners) {
        tl.flights.push({ id: `${tl.flights.length}:pay:${w.playerId}`, from: POT_ANCHOR, to: seatAnchor(w.playerId), amount: w.amount, at: outcomes, ms: PAY_MS });
      }
    }
    for (const id of Object.keys(won)) tween(tl, chipsValue(id), stackBeforePay(id), outcomes + PAY_MS, next.seats[id]?.chips ?? 0);
    cursor = outcomes + PAY_MS;
    added = true;
  }

  // Whatever happened in between (a snapshot that carried several moves), every number ends on the truth.
  const settle = (name: string, truth: number) => {
    const t = tl.values[name];
    const last = t?.steps[t.steps.length - 1];
    if (t && last && last.value !== truth) tween(tl, name, truth, Math.max(cursor, last.at), truth);
  };
  for (const id of next.order) {
    settle(betValue(id), next.seats[id]?.bet ?? 0);
    settle(chipsValue(id), next.seats[id]?.chips ?? 0);
  }
  settle(POT_VALUE, next.pot);
  return { cursor, added };
}

/**
 * Plans the next timeline from the previous one. `fresh` is a first snapshot (nothing to animate
 * from); `motion` is false under prefers-reduced-motion. A new hand first clears the last one's
 * cards to the muck.
 */
export function planTimeline(prev: Timeline, prevTable: PokerTable | null, next: PokerTable | null, meId: string | null, now: number, fresh: boolean, motion: boolean): Timeline {
  if (!next) return snapTimeline(null, now);
  const draft = beginPlan({ prev, prevTable, prevId: prevTable?.hand ?? null, nextId: next.hand, now, fresh, motion, hold: 0 });
  if (!draft) return snapTimeline(next, now);
  const from = draft.same && prevTable ? prevTable : dealtOut(next);
  const { cursor, added } = progress(draft, from, next, meId, !draft.same);
  return finishPlan(draft, cursor, added);
}

export function outcomesShown(timeline: Timeline, now: number): boolean {
  return reached(timeline, OUTCOMES, now);
}

export function paidOut(timeline: Timeline, now: number): boolean {
  return reached(timeline, PAID, now);
}
