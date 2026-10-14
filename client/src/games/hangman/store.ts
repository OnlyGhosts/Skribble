import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

export type HangmanSheet = 'players' | 'chat' | 'menu';

/** Hangman's own client state beyond the shared canvas (./canvas.ts). */
interface HangmanState {
  /** The guesser's half-typed word, kept across reloads of the same turn; dropped at turn boundaries. */
  wordDraft: string;
  /** The hangman's own word while choosing. */
  customDraft: string;
  /** Whether the current guesser is picking a letter or typing the whole word. */
  guessMode: 'letters' | 'word';
  /** Actions the canvas held when the section being drawn began: undo and clear never reach below it. */
  sectionFloor: number;
  sheet: HangmanSheet | null;
}

interface HangmanActions {
  setWordDraft(draft: string): void;
  setCustomDraft(draft: string): void;
  setGuessMode(mode: HangmanState['guessMode']): void;
  setSectionFloor(floor: number): void;
  openSheet(sheet: HangmanSheet | null): void;
  /** Drops what belongs to the word just played; the open sheet stays. */
  newTurn(): void;
  reset(): void;
}

export type HangmanStore = HangmanState & HangmanActions;

const TURN: Pick<HangmanState, 'wordDraft' | 'customDraft' | 'guessMode' | 'sectionFloor'> = { wordDraft: '', customDraft: '', guessMode: 'letters', sectionFloor: 0 };
const INITIAL: HangmanState = { ...TURN, sheet: null };

export const useHangmanStore = create<HangmanStore>()((set) => ({
  ...INITIAL,
  setWordDraft: (wordDraft) => set({ wordDraft }),
  setCustomDraft: (customDraft) => set({ customDraft }),
  setGuessMode: (guessMode) => set({ guessMode }),
  setSectionFloor: (sectionFloor) => set({ sectionFloor }),
  openSheet: (sheet) => set({ sheet }),
  newTurn: () => set(TURN),
  reset: () => set(INITIAL),
}));

/**
 * Reads the store with the live state as the server snapshot too: the app never hydrates
 * server-rendered markup, and the unit tests render through react-dom/server.
 */
export function useHangman<T>(selector: (s: HangmanStore) => T): T {
  const read = () => selector(useHangmanStore.getState());
  return useSyncExternalStore(useHangmanStore.subscribe, read, read);
}
