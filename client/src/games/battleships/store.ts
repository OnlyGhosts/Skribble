import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { ShipView } from '@shared/games/battleships/protocol';
import { draftFrom, layoutKey, placeShip, shipAt, type Draft, type DraftShip } from './lib/placement';

export type BattleshipsSheet = 'players' | 'chat' | 'menu' | 'log';

export interface Aim {
  sideId: string;
  x: number;
  y: number;
}

/** Battleships' own client state: the sheets, the grid on show, the two-tap aim and the placement draft. */
interface BattleshipsState {
  sheet: BattleshipsSheet | null;
  /** The grid on show: a target side's id, or null for the viewer's own fleet. */
  tab: string | null;
  /** The cell awaiting its confirming tap (or the Fire button). */
  aim: Aim | null;
  draft: Draft;
  /** The ship in hand while placing: from the tray, or picked up off the board. */
  selectedShipId: string | null;
  /** The orientation the next drop uses. */
  horizontal: boolean;
  /** Cells of the last rejected drop, painted red until the next tap. */
  invalid: string[];
  /** Fingerprint of the server layout the draft was last taken from, so an echo of our own layout changes nothing. */
  adopted: string;
  /** The ship a move row points at (hovered or focused), lit on the board so "3 across" is never ambiguous. */
  highlight: string | null;
}

interface BattleshipsActions {
  openSheet(sheet: BattleshipsSheet | null): void;
  selectTab(tab: string | null): void;
  setAim(aim: Aim | null): void;
  setHighlight(shipId: string | null): void;
  /** Picks a tray ship up (or puts it back with null). */
  pickShip(id: string | null): void;
  /** Flips the orientation; a ship already on the board turns in place when it fits there. */
  rotate(size: number): void;
  /**
   * A tap on the own board while placing: drops the ship in hand at the cell, or picks up the
   * ship lying there when the hand is empty.
   */
  tapCell(x: number, y: number, size: number, lengths: readonly number[]): void;
  /** Takes the server's layout when it differs from what the draft came from (an auto-place, a rejoin). */
  adoptLayout(ships: readonly ShipView[]): void;
  /** A game starts: drops the draft, the aim and the tab; the open sheet stays. */
  newGame(): void;
  reset(): void;
}

export type BattleshipsStore = BattleshipsState & BattleshipsActions;

const GAME: Omit<BattleshipsState, 'sheet'> = { tab: null, aim: null, draft: {}, selectedShipId: null, horizontal: true, invalid: [], adopted: '', highlight: null };
const INITIAL: BattleshipsState = { ...GAME, sheet: null };

export const useBattleshipsStore = create<BattleshipsStore>()((set, get) => ({
  ...INITIAL,
  openSheet: (sheet) => set({ sheet }),
  selectTab: (tab) => set({ tab }),
  setAim: (aim) => set({ aim }),
  setHighlight: (highlight) => set({ highlight }),
  pickShip: (selectedShipId) => set({ selectedShipId, invalid: [] }),

  rotate: (size) => {
    const { draft, selectedShipId, horizontal } = get();
    const placed = selectedShipId ? draft[selectedShipId] : undefined;
    if (!placed) return set({ horizontal: !horizontal, invalid: [] });
    const turned = placeShip(draft, { ...placed, horizontal: !placed.horizontal }, size);
    if (turned.ok) set({ draft: turned.draft, horizontal: !placed.horizontal, invalid: [] });
    else set({ invalid: turned.cells });
  },

  tapCell: (x, y, size, lengths) => {
    const { draft, selectedShipId, horizontal } = get();
    if (selectedShipId === null) {
      const lying = shipAt(draft, x, y);
      if (lying) set({ selectedShipId: lying.id, horizontal: lying.horizontal, invalid: [] });
      return;
    }
    const index = Number(selectedShipId.slice(1));
    const length = draft[selectedShipId]?.length ?? lengths[index];
    if (length === undefined) return;
    const ship: DraftShip = { id: selectedShipId, length, x, y, horizontal };
    const dropped = placeShip(draft, ship, size);
    if (dropped.ok) set({ draft: dropped.draft, selectedShipId: null, invalid: [] });
    else set({ invalid: dropped.cells });
  },

  adoptLayout: (ships) => {
    if (ships.length === 0) return;
    const key = layoutKey(ships);
    if (key === get().adopted) return;
    const draft = draftFrom(ships);
    set(layoutKey(Object.values(get().draft)) === key ? { adopted: key } : { adopted: key, draft, selectedShipId: null, invalid: [] });
  },

  newGame: () => set(GAME),
  reset: () => set(INITIAL),
}));

/**
 * Reads the store with the live state as the server snapshot too: the app never hydrates
 * server-rendered markup, and the unit tests render through react-dom/server.
 */
export function useBattleships<T>(selector: (s: BattleshipsStore) => T): T {
  const read = () => selector(useBattleshipsStore.getState());
  return useSyncExternalStore(useBattleshipsStore.subscribe, read, read);
}
