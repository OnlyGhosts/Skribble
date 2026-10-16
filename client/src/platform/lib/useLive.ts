import { useSyncExternalStore } from 'react';

interface Store<S> {
  getState(): S;
  subscribe(listener: () => void): () => void;
}

/**
 * Reads a zustand store with the live state as the server snapshot too. The app never hydrates
 * server-rendered markup, and the unit tests render through react-dom/server, where zustand's own
 * hook would report the initial state instead. The selector must return state it does not build
 * (a field, a boolean), or the snapshot would never settle.
 */
export function useLive<S, T>(store: Store<S>, selector: (s: S) => T): T {
  const read = () => selector(store.getState());
  return useSyncExternalStore(store.subscribe, read, read);
}
