import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

/** The phone sheets the screen can show; one at a time, and never under the vote sheet. */
export type SpygameSheet = 'players' | 'chat' | 'menu';

/** The Spy Game's own client state: the two-tap selections and which sheet is up. */
interface SpygameState {
  /** The spy's tile awaiting its confirming tap. */
  highlightedLocation: string | null;
  /** The player an agent is about to accuse, awaiting the confirming tap. */
  highlightedPlayer: string | null;
  /** Opened for eligible voters when a vote starts; they may close it and vote from the panel instead. */
  voteSheetOpen: boolean;
  /** The players / chat / menu sheet that is open, if any. */
  sheet: SpygameSheet | null;
}

interface SpygameActions {
  highlightLocation(id: string | null): void;
  highlightPlayer(id: string | null): void;
  /** Opening the vote sheet closes any other sheet, so the Yes/No never hides under the chat. */
  setVoteSheetOpen(open: boolean): void;
  openSheet(sheet: SpygameSheet | null): void;
  /** Drops the pending taps and the vote sheet (a round started or ended); the open sheet stays. */
  clearSelections(): void;
  /** Back to the initial state (the lobby, leaving the room). */
  reset(): void;
}

export type SpygameStore = SpygameState & SpygameActions;

const SELECTIONS: Pick<SpygameState, 'highlightedLocation' | 'highlightedPlayer' | 'voteSheetOpen'> = { highlightedLocation: null, highlightedPlayer: null, voteSheetOpen: false };
const INITIAL: SpygameState = { ...SELECTIONS, sheet: null };

export const useSpygameStore = create<SpygameStore>()((set) => ({
  ...INITIAL,
  highlightLocation: (highlightedLocation) => set({ highlightedLocation }),
  highlightPlayer: (highlightedPlayer) => set({ highlightedPlayer }),
  setVoteSheetOpen: (voteSheetOpen) => set(voteSheetOpen ? { voteSheetOpen, sheet: null } : { voteSheetOpen }),
  openSheet: (sheet) => set({ sheet }),
  clearSelections: () => set(SELECTIONS),
  reset: () => set(INITIAL),
}));

/**
 * Reads the store with the live state as the server snapshot too. The app never hydrates
 * server-rendered markup, and the unit tests render through react-dom/server, where zustand's own
 * hook would report the initial state instead.
 */
export function useSpygame<T>(selector: (s: SpygameStore) => T): T {
  const read = () => selector(useSpygameStore.getState());
  return useSyncExternalStore(useSpygameStore.subscribe, read, read);
}
