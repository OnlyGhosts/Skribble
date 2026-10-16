import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { PokerView } from '@shared/games/poker/protocol';
import type { TableSheet } from '../../platform/table/TableShell';
import { tableOf, type PokerTable } from './lib/table';
import { EMPTY_TIMELINE, planTimeline, snapTimeline, type Timeline } from './lib/timeline';

/** The phone sheets the screen can show; one at a time. */
export type PokerSheet = TableSheet;

/** A sent move waits this long at most for the table's answer before the controls come back anyway. */
export const PENDING_MS = 3000;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function stopPendingTimer(): void {
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = null;
}

/** What changes once a move of mine has been answered: the hand, the latest move on the table, whose turn it is. */
export function answerKey(view: PokerView): string {
  return [view.hand, view.lastMove?.seq ?? 0, view.turn ?? '-'].join('|');
}

/** Poker's own client state: the open sheet, the raise field, the host's End game confirmation and the table's animation timeline. */
interface PokerState {
  sheet: PokerSheet | null;
  /** The player whose seat sheet is open (a tile tapped). */
  seat: string | null;
  /** What is typed in the raise field; null until touched this turn (the field then shows the minimum). */
  raiseText: string | null;
  /** The hand as the last snapshot had it. */
  table: PokerTable | null;
  timeline: Timeline;
  /**
   * The timeline the sounds follow: the same as `timeline`, except under reduced motion, where the
   * table snaps but the sounds keep the deal's pacing (reduced motion is not a mute).
   */
  soundTimeline: Timeline;
  /** A move sent and not answered yet (answerKey as it was): the moves wait for it, so a second tap never plays twice. */
  pending: { move: string; key: string } | null;
}

interface PokerActions {
  openSheet(sheet: PokerSheet | null): void;
  openSeat(playerId: string | null): void;
  setRaiseText(text: string | null): void;
  markPending(move: string, view: PokerView): void;
  clearPending(): void;
  /** The turn moved on: the amount belongs to the move that just passed. */
  newTurn(): void;
  /** Plans the animation from the previous hand on the table to this snapshot's; `fresh` snaps (a welcome). */
  applyView(view: PokerView | null, meId: string | null, now: number, fresh: boolean, motion: boolean): Timeline;
  reset(): void;
}

export type PokerStore = PokerState & PokerActions;

const INITIAL: PokerState = { sheet: null, seat: null, raiseText: null, table: null, timeline: EMPTY_TIMELINE, soundTimeline: EMPTY_TIMELINE, pending: null };

export const usePokerStore = create<PokerStore>()((set, get) => ({
  ...INITIAL,
  openSheet: (sheet) => set({ sheet }),
  openSeat: (seat) => set({ seat }),
  setRaiseText: (raiseText) => set({ raiseText }),
  markPending: (move, view) => {
    stopPendingTimer();
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      set({ pending: null });
    }, PENDING_MS);
    set({ pending: { move, key: answerKey(view) } });
  },
  clearPending: () => {
    stopPendingTimer();
    if (get().pending !== null) set({ pending: null });
  },
  newTurn: () => set({ raiseText: null }),
  applyView: (view, meId, now, fresh, motion) => {
    const { table: prevTable, timeline: prev, soundTimeline: prevSound } = get();
    const table = tableOf(view, meId);
    const timeline = planTimeline(prev, prevTable, table, meId, now, fresh, motion);
    const soundTimeline = motion ? timeline : planTimeline(prevSound, prevTable, table, meId, now, fresh, true);
    set({ table, timeline, soundTimeline });
    return timeline;
  },
  reset: () => {
    stopPendingTimer();
    set(INITIAL);
  },
}));

export { snapTimeline };

/**
 * Reads the store with the live state as the server snapshot too: the app never hydrates
 * server-rendered markup, and the unit tests render through react-dom/server.
 */
export function usePoker<T>(selector: (s: PokerStore) => T): T {
  const read = () => selector(usePokerStore.getState());
  return useSyncExternalStore(usePokerStore.subscribe, read, read);
}
