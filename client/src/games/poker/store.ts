import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { PokerView } from '@shared/games/poker/protocol';
import type { TableSheet } from '../../platform/table/TableShell';
import { tableOf, type PokerTable } from './lib/table';
import { EMPTY_TIMELINE, planTimeline, snapTimeline, type Timeline } from './lib/timeline';

/** The phone sheets the screen can show; one at a time. */
export type PokerSheet = TableSheet;

/** Poker's own client state: the open sheet, the raise field, the host's End game confirmation and the table's animation timeline. */
interface PokerState {
  sheet: PokerSheet | null;
  /** What is typed in the raise field; null until touched this turn (the field then shows the minimum). */
  raiseText: string | null;
  /** The host tapped End game once and is asked to confirm. */
  confirmEnd: boolean;
  /** The hand as the last snapshot had it. */
  table: PokerTable | null;
  timeline: Timeline;
  /**
   * The timeline the sounds follow: the same as `timeline`, except under reduced motion, where the
   * table snaps but the sounds keep the deal's pacing (reduced motion is not a mute).
   */
  soundTimeline: Timeline;
}

interface PokerActions {
  openSheet(sheet: PokerSheet | null): void;
  setRaiseText(text: string | null): void;
  setConfirmEnd(confirm: boolean): void;
  /** The turn moved on: the amount belongs to the move that just passed. */
  newTurn(): void;
  /** Plans the animation from the previous hand on the table to this snapshot's; `fresh` snaps (a welcome). */
  applyView(view: PokerView | null, meId: string | null, now: number, fresh: boolean, motion: boolean): Timeline;
  reset(): void;
}

export type PokerStore = PokerState & PokerActions;

const INITIAL: PokerState = { sheet: null, raiseText: null, confirmEnd: false, table: null, timeline: EMPTY_TIMELINE, soundTimeline: EMPTY_TIMELINE };

export const usePokerStore = create<PokerStore>()((set, get) => ({
  ...INITIAL,
  openSheet: (sheet) => set({ sheet, confirmEnd: false }),
  setRaiseText: (raiseText) => set({ raiseText }),
  setConfirmEnd: (confirmEnd) => set({ confirmEnd }),
  newTurn: () => set({ raiseText: null }),
  applyView: (view, meId, now, fresh, motion) => {
    const { table: prevTable, timeline: prev, soundTimeline: prevSound } = get();
    const table = tableOf(view, meId);
    const timeline = planTimeline(prev, prevTable, table, meId, now, fresh, motion);
    const soundTimeline = motion ? timeline : planTimeline(prevSound, prevTable, table, meId, now, fresh, true);
    set({ table, timeline, soundTimeline });
    return timeline;
  },
  reset: () => set(INITIAL),
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
