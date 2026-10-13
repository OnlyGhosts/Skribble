import { create } from 'zustand';

/** Skribble's own client state beyond the shared canvas (./canvas.ts): the guesser's half-typed word. */
interface SkribbleState {
  /** What the guesser has typed into the word tiles but not sent yet; reset every turn. */
  guessDraft: string;
}

interface SkribbleActions {
  setGuessDraft(draft: string): void;
  reset(): void;
}

export type SkribbleStore = SkribbleState & SkribbleActions;

export const useSkribbleStore = create<SkribbleStore>()((set) => ({
  guessDraft: '',
  setGuessDraft: (guessDraft) => set({ guessDraft }),
  reset: () => set({ guessDraft: '' }),
}));
