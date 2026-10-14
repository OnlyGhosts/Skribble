import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

/** The phone sheets the screen can show; one at a time. */
export type BlackjackSheet = 'players' | 'chat' | 'menu';

/** Blackjack's own client state: the stake being chosen and the open sheet. */
interface BlackjackState {
  /** The amount on the betting panel; null until the player touches it (the panel then starts from their last bet). */
  betDraft: number | null;
  /** The stake last placed on this device, the starting point for the next round's panel. */
  lastBet: number | null;
  /** A placed bet re-opened for changing. */
  changingBet: boolean;
  sheet: BlackjackSheet | null;
}

interface BlackjackActions {
  setBetDraft(amount: number | null): void;
  betPlaced(amount: number): void;
  setChangingBet(changing: boolean): void;
  openSheet(sheet: BlackjackSheet | null): void;
  /** A new round: the draft and the re-opened panel are stale; the last bet and the open sheet stay. */
  newRound(): void;
  reset(): void;
}

export type BlackjackStore = BlackjackState & BlackjackActions;

const ROUND: Pick<BlackjackState, 'betDraft' | 'changingBet'> = { betDraft: null, changingBet: false };
const INITIAL: BlackjackState = { ...ROUND, lastBet: null, sheet: null };

export const useBlackjackStore = create<BlackjackStore>()((set) => ({
  ...INITIAL,
  setBetDraft: (betDraft) => set({ betDraft }),
  betPlaced: (amount) => set({ lastBet: amount, betDraft: amount, changingBet: false }),
  setChangingBet: (changingBet) => set({ changingBet }),
  openSheet: (sheet) => set({ sheet }),
  newRound: () => set(ROUND),
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
