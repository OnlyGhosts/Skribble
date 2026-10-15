import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { BlackjackView } from '@shared/games/blackjack/protocol';
import type { TableSheet } from '../../platform/table/TableShell';
import { cardsOnTable, tableOf, type TableModel } from './lib/table';
import { EMPTY_TIMELINE, planTimeline, snapTimeline, type Timeline } from './lib/timeline';

/** The phone sheets the screen can show; one at a time. */
export type BlackjackSheet = TableSheet;

/** Blackjack's own client state: the bet field, the open sheet, the host's End game confirmation and the table's animation timeline. */
interface BlackjackState {
  /** What is typed in the bet field; null until touched (the field then shows the last bet, else a suggested amount). */
  betText: string | null;
  /** The stake last placed on this device. */
  lastBet: number | null;
  sheet: BlackjackSheet | null;
  /** The player whose seat sheet is open (a tile tapped). */
  seat: string | null;
  confirmEnd: boolean;
  /** The table as the last snapshot had it. */
  table: TableModel | null;
  /** Cards swept to the discards since this page joined: every table a new deal replaced. */
  swept: number;
  timeline: Timeline;
  /**
   * The timeline the sounds follow: the same as `timeline`, except under reduced motion, where the
   * table snaps but the sounds keep the deal's pacing (reduced motion is not a mute).
   */
  soundTimeline: Timeline;
}

interface BlackjackActions {
  setBetText(text: string | null): void;
  betPlaced(amount: number): void;
  openSheet(sheet: BlackjackSheet | null): void;
  openSeat(playerId: string | null): void;
  setConfirmEnd(confirm: boolean): void;
  /** Plans the animation from the previous table to this snapshot's; `fresh` snaps (a welcome). */
  applyView(view: BlackjackView | null, now: number, fresh: boolean, motion: boolean): Timeline;
  /** Shows the truth at once, whatever is still animating. */
  snap(now: number): void;
  reset(): void;
}

export type BlackjackStore = BlackjackState & BlackjackActions;

const INITIAL: BlackjackState = { betText: null, lastBet: null, sheet: null, seat: null, confirmEnd: false, table: null, swept: 0, timeline: EMPTY_TIMELINE, soundTimeline: EMPTY_TIMELINE };

export const useBlackjackStore = create<BlackjackStore>()((set, get) => ({
  ...INITIAL,
  setBetText: (betText) => set({ betText }),
  betPlaced: (amount) => set({ lastBet: amount, betText: String(amount) }),
  openSheet: (sheet) => set({ sheet, confirmEnd: false }),
  openSeat: (seat) => set({ seat }),
  setConfirmEnd: (confirmEnd) => set({ confirmEnd }),
  applyView: (view, now, fresh, motion) => {
    const { table: prevTable, timeline: prev, soundTimeline: prevSound, swept } = get();
    const table = tableOf(view);
    const timeline = planTimeline(prev, prevTable, table, now, fresh, motion);
    const soundTimeline = motion ? timeline : planTimeline(prevSound, prevTable, table, now, fresh, true);
    // A new round's table replaces the last one: its cards go to the discards.
    const replaced = prevTable !== null && table !== null && table.round !== prevTable.round;
    set({ table, timeline, soundTimeline, swept: swept + (replaced ? cardsOnTable(prevTable) : 0) });
    return timeline;
  },
  snap: (now) => set((s) => ({ timeline: snapTimeline(s.table, now) })),
  reset: () => set(INITIAL),
}));

/**
 * Reads the store with the live state as the server snapshot too: the app never hydrates
 * server-rendered markup, and the unit tests render through react-dom/server.
 */
export function useBlackjack<T>(selector: (s: BlackjackStore) => T): T {
  const read = () => selector(useBlackjackStore.getState());
  return useSyncExternalStore(useBlackjackStore.subscribe, read, read);
}
