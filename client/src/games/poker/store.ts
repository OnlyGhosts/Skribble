import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

/** The phone sheets the screen can show; one at a time. */
export type PokerSheet = 'players' | 'chat' | 'menu';

/** Poker's own client state: the open sheet, the bet/raise panel and the host's End game confirmation. */
interface PokerState {
  sheet: PokerSheet | null;
  /** The bet/raise panel is open over the action bar. */
  raiseOpen: boolean;
  /** The amount on the panel (a bet, or the total a raise goes to); null until touched. */
  raiseDraft: number | null;
  /** The host tapped End game once and is asked to confirm. */
  confirmEnd: boolean;
}

interface PokerActions {
  openSheet(sheet: PokerSheet | null): void;
  openRaise(open: boolean): void;
  setRaiseDraft(amount: number | null): void;
  setConfirmEnd(confirm: boolean): void;
  /** The turn moved on: the panel and its amount belong to the move that just passed. */
  newTurn(): void;
  reset(): void;
}

export type PokerStore = PokerState & PokerActions;

const TURN: Pick<PokerState, 'raiseOpen' | 'raiseDraft'> = { raiseOpen: false, raiseDraft: null };
const INITIAL: PokerState = { ...TURN, sheet: null, confirmEnd: false };

export const usePokerStore = create<PokerStore>()((set) => ({
  ...INITIAL,
  openSheet: (sheet) => set({ sheet, confirmEnd: false }),
  openRaise: (raiseOpen) => set(raiseOpen ? { raiseOpen } : TURN),
  setRaiseDraft: (raiseDraft) => set({ raiseDraft }),
  setConfirmEnd: (confirmEnd) => set({ confirmEnd }),
  newTurn: () => set(TURN),
  reset: () => set(INITIAL),
}));

/**
 * Reads the store with the live state as the server snapshot too: the app never hydrates
 * server-rendered markup, and the unit tests render through react-dom/server.
 */
export function usePoker<T>(selector: (s: PokerStore) => T): T {
  const read = () => selector(usePokerStore.getState());
  return useSyncExternalStore(usePokerStore.subscribe, read, read);
}
