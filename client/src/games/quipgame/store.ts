import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

/** The phone sheets the screen can show; one at a time. */
export type QuipgameSheet = 'players' | 'chat' | 'menu';

/** Quip Game's own client state: what is being typed, tapped or ranked before the server echoes it. */
interface QuipgameState {
  /** Draft answers by prompt id, kept while a prompt is being written or re-opened for editing. */
  drafts: Record<string, string>;
  /** A prompt re-opened from the waiting card; null shows the next unanswered prompt. */
  editingPromptId: string | null;
  /** The answer just tapped in a matchup, shown as selected until the snapshot confirms it. */
  selectedChoice: 'a' | 'b' | null;
  /** The final ranking being built, favourite first. */
  picks: string[];
  sheet: QuipgameSheet | null;
}

interface QuipgameActions {
  setDraft(promptId: string, text: string): void;
  /** Forgets the draft once it was sent (the server copy is the truth from here). */
  clearDraft(promptId: string): void;
  editPrompt(promptId: string | null): void;
  selectChoice(choice: 'a' | 'b' | null): void;
  setPicks(picks: string[]): void;
  /** Adds `answerId` as the next pick, or removes it when already picked; never past `max` picks. */
  togglePick(answerId: string, max: number): void;
  openSheet(sheet: QuipgameSheet | null): void;
  /** A new phase: the pending tap, the edit and the drafts are stale; the open sheet stays. */
  clearPhaseState(): void;
  reset(): void;
}

export type QuipgameStore = QuipgameState & QuipgameActions;

const PHASE_STATE: Omit<QuipgameState, 'sheet'> = { drafts: {}, editingPromptId: null, selectedChoice: null, picks: [] };
const INITIAL: QuipgameState = { ...PHASE_STATE, sheet: null };

export const useQuipgameStore = create<QuipgameStore>()((set) => ({
  ...INITIAL,
  setDraft: (promptId, text) => set((s) => ({ drafts: { ...s.drafts, [promptId]: text } })),
  clearDraft: (promptId) =>
    set((s) => {
      const drafts = { ...s.drafts };
      delete drafts[promptId];
      return { drafts };
    }),
  editPrompt: (editingPromptId) => set({ editingPromptId }),
  selectChoice: (selectedChoice) => set({ selectedChoice }),
  setPicks: (picks) => set({ picks }),
  togglePick: (answerId, max) =>
    set((s) => {
      if (s.picks.includes(answerId)) return { picks: s.picks.filter((id) => id !== answerId) };
      return s.picks.length >= max ? {} : { picks: [...s.picks, answerId] };
    }),
  openSheet: (sheet) => set({ sheet }),
  clearPhaseState: () => set(PHASE_STATE),
  reset: () => set(INITIAL),
}));

/**
 * Reads the store with the live state as the server snapshot too. The app never hydrates
 * server-rendered markup, and the unit tests render through react-dom/server, where zustand's own
 * hook would report the initial state instead.
 */
export function useQuipgame<T>(selector: (s: QuipgameStore) => T): T {
  const read = () => selector(useQuipgameStore.getState());
  return useSyncExternalStore(useQuipgameStore.subscribe, read, read);
}
