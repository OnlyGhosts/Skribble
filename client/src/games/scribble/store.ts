import { create } from 'zustand';

/** Scribble's own client state beyond the shared canvas (./canvas.ts): the guesser's half-typed word and where the guess feed starts. */
interface ScribbleState {
  /** What the guesser has typed into the word tiles but not sent yet; reset every turn. */
  guessDraft: string;
  /** The guess feed shows the room's lines after this id: the ones from before this game started stay out. */
  feedFrom: number;
}

interface ScribbleActions {
  setGuessDraft(draft: string): void;
  setFeedFrom(id: number): void;
  reset(): void;
}

export type ScribbleStore = ScribbleState & ScribbleActions;

export const useScribbleStore = create<ScribbleStore>()((set) => ({
  guessDraft: '',
  feedFrom: 0,
  setGuessDraft: (guessDraft) => set({ guessDraft }),
  setFeedFrom: (feedFrom) => set({ feedFrom }),
  reset: () => set({ guessDraft: '', feedFrom: 0 }),
}));
