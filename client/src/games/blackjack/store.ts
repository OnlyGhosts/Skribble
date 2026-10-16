import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { BlackjackView } from '@shared/games/blackjack/protocol';
import type { TableSheet } from '../../platform/table/TableShell';
import { answerKey, type Pending, type PendingKind } from './lib/pending';
import { cardsOnTable, tableOf, type TableModel } from './lib/table';
import { EMPTY_TIMELINE, planTimeline, snapTimeline, type Timeline } from './lib/timeline';

/** The phone sheets the screen can show; one at a time. */
export type BlackjackSheet = TableSheet;

/** A sent move waits this long at most for the table's answer before the controls come back anyway. */
export const PENDING_MS = 3000;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/** Blackjack's own client state: the bet field, the open sheet, the host's End game confirmation and the table's animation timeline. */
interface BlackjackState {
  /** What is typed in the bet field; null until touched (the field then shows the last bet, else a suggested amount). */
  betText: string | null;
  /** The stake last placed on this device. */
  lastBet: number | null;
  sheet: BlackjackSheet | null;
  /** The player whose seat sheet is open (a tile tapped). */
  seat: string | null;
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
  /** A move or table control sent and not answered yet: every control waits for the snapshot that answers it. */
  pending: Pending | null;
  /** A bet tapped while the last round's outcomes are up, before the bets open: sent the moment they do. */
  queuedBet: { round: number; amount: number } | null;
}

interface BlackjackActions {
  setBetText(text: string | null): void;
  betPlaced(amount: number): void;
  openSheet(sheet: BlackjackSheet | null): void;
  openSeat(playerId: string | null): void;
  /** A move went out against this table: the controls wait for its answer. */
  markPending(kind: PendingKind, view: BlackjackView, meId: string): void;
  /** The answer came (a refusal, a reconnect), or it is overdue: the controls come back. */
  clearPending(): void;
  queueBet(round: number, amount: number): void;
  clearQueuedBet(): void;
  /** Plans the animation from the previous table to this snapshot's; `fresh` snaps (a welcome). */
  applyView(view: BlackjackView | null, now: number, fresh: boolean, motion: boolean): Timeline;
  /** Shows the truth at once, whatever is still animating. */
  snap(now: number): void;
  reset(): void;
}

export type BlackjackStore = BlackjackState & BlackjackActions;

const INITIAL: BlackjackState = {
  betText: null,
  lastBet: null,
  sheet: null,
  seat: null,
  table: null,
  swept: 0,
  timeline: EMPTY_TIMELINE,
  soundTimeline: EMPTY_TIMELINE,
  pending: null,
  queuedBet: null,
};

function stopPendingTimer(): void {
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = null;
}

export const useBlackjackStore = create<BlackjackStore>()((set, get) => ({
  ...INITIAL,
  setBetText: (betText) => set({ betText }),
  betPlaced: (amount) => set({ lastBet: amount, betText: String(amount) }),
  openSheet: (sheet) => set({ sheet }),
  openSeat: (seat) => set({ seat }),
  markPending: (kind, view, meId) => {
    stopPendingTimer();
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      set({ pending: null });
    }, PENDING_MS);
    set({ pending: { kind, key: answerKey(view, meId) } });
  },
  clearPending: () => {
    stopPendingTimer();
    if (get().pending !== null) set({ pending: null });
  },
  queueBet: (round, amount) => set({ queuedBet: { round, amount }, lastBet: amount, betText: String(amount) }),
  clearQueuedBet: () => set({ queuedBet: null }),
  applyView: (view, now, fresh, motion) => {
    const { table: prevTable, timeline: prev, soundTimeline: prevSound, swept, pending } = get();
    const table = tableOf(view);
    // My own bet dealt the cards: the last round's outcomes have been seen, so the new deal does not wait on them.
    const hold = pending?.kind === 'bet' ? 0 : undefined;
    const timeline = planTimeline(prev, prevTable, table, now, fresh, motion, hold);
    const soundTimeline = motion ? timeline : planTimeline(prevSound, prevTable, table, now, fresh, true, hold);
    // A new round's table replaces the last one: its cards go to the discards.
    const replaced = prevTable !== null && table !== null && table.round !== prevTable.round;
    set({ table, timeline, soundTimeline, swept: swept + (replaced ? cardsOnTable(prevTable) : 0) });
    return timeline;
  },
  snap: (now) => set((s) => ({ timeline: snapTimeline(s.table, now) })),
  reset: () => {
    stopPendingTimer();
    set(INITIAL);
  },
}));

/**
 * Reads the store with the live state as the server snapshot too: the app never hydrates
 * server-rendered markup, and the unit tests render through react-dom/server.
 */
export function useBlackjack<T>(selector: (s: BlackjackStore) => T): T {
  const read = () => selector(useBlackjackStore.getState());
  return useSyncExternalStore(useBlackjackStore.subscribe, read, read);
}
