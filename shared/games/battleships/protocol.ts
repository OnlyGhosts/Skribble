/**
 * Battleships' part of the wire protocol: its settings, its client messages and the
 * per-recipient view the platform embeds in `RoomState.game`. Boards are secret: a view carries
 * the viewer's own side's ships and only the shots that landed on every other side.
 */
import { z } from 'zod';
import type { RoomState } from '../../platform/protocol.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const BATTLESHIPS_SETTINGS_LIMITS = {
  placeSeconds: { min: 30, max: 120 },
  turnSeconds: { min: 10, max: 60 },
} as const;

export const BATTLESHIPS_BOARD_SIZES = [8, 10] as const;
export type BattleshipsBoardSize = (typeof BATTLESHIPS_BOARD_SIZES)[number];

/** Ship lengths per fleet, longest first (the placement order and the ship ids' order). */
export const BATTLESHIPS_FLEETS = {
  small: [4, 3, 3, 2],
  classic: [5, 4, 3, 3, 2],
} as const;
export type BattleshipsFleet = keyof typeof BATTLESHIPS_FLEETS;

export const battleshipsSettingsSchema = z.object({
  /** Every player for themselves, or two teams sharing one board each. */
  mode: z.enum(['solo', 'teams']),
  boardSize: z.union([z.literal(8), z.literal(10)]),
  fleet: z.enum(['small', 'classic']),
  /** Seconds everyone has to place their ships. */
  placeSeconds: z.number().int().min(BATTLESHIPS_SETTINGS_LIMITS.placeSeconds.min).max(BATTLESHIPS_SETTINGS_LIMITS.placeSeconds.max),
  /** Seconds a shooter has to call a shot. */
  turnSeconds: z.number().int().min(BATTLESHIPS_SETTINGS_LIMITS.turnSeconds.min).max(BATTLESHIPS_SETTINGS_LIMITS.turnSeconds.max),
  /** Roll a die after every shot; a 5 or 6 lets the shooter slide an undamaged ship. */
  diceMoves: z.boolean(),
});

export type BattleshipsSettings = z.infer<typeof battleshipsSettingsSchema>;
export type BattleshipsMode = BattleshipsSettings['mode'];

export const DEFAULT_BATTLESHIPS_SETTINGS: BattleshipsSettings = {
  mode: 'solo',
  boardSize: 8,
  fleet: 'small',
  placeSeconds: 60,
  turnSeconds: 30,
  diceMoves: true,
};

// ---------------------------------------------------------------------------
// Rules shared by both sides
// ---------------------------------------------------------------------------

/** Seconds a shooter has to slide a ship after a lucky roll. */
export const BATTLESHIPS_MOVE_SECONDS = 12;
/** The lowest die roll that opens a move window. */
export const BATTLESHIPS_MOVE_ROLL = 5;
/** Shot events kept in the view's log. */
export const BATTLESHIPS_LOG_LENGTH = 12;
export const BATTLESHIPS_TEAM_IDS = ['A', 'B'] as const;
export type BattleshipsTeamId = (typeof BATTLESHIPS_TEAM_IDS)[number];

export const BATTLESHIPS_POINTS = {
  hit: 10,
  /** On top of the hit. */
  sink: 30,
  /** Per player on the winning side. */
  win: 100,
} as const;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const coord = z.number().int().min(0).max(9);

export const shipPlacementSchema = z.object({ id: z.string().min(1).max(8), x: coord, y: coord, horizontal: z.boolean() });
export type ShipPlacement = z.infer<typeof shipPlacementSchema>;

export const battleshipsClientMessageSchema = z.discriminatedUnion('t', [
  /**
   * During `placing`, from a side's captain: the layout so far (any ships of the fleet, each once,
   * in bounds, no overlap). Sent after every drop, so teammates watch it take shape; the fleet is
   * `placed` once every ship has a spot.
   */
  z.object({ t: z.literal('place'), ships: z.array(shipPlacementSchema).max(8) }),
  /** During `placing`, from a side's captain: lock the complete layout in. */
  z.object({ t: z.literal('placeReady') }),
  /** During `placing`, from a side's captain: a random valid layout instead. */
  z.object({ t: z.literal('autoPlace') }),
  /** From the shooter on their turn: a cell of an opponent side not shot before. */
  z.object({ t: z.literal('fire'), targetId: z.string().min(1).max(64), x: coord, y: coord }),
  /** From the shooter during their move window: slide one undamaged ship one cell along its axis. */
  z.object({ t: z.literal('move'), shipId: z.string().min(1).max(8), direction: z.enum(['forward', 'back']) }),
  /** From the shooter during their move window: keep the fleet where it is. */
  z.object({ t: z.literal('skipMove') }),
]);

export type BattleshipsClientMessage = z.infer<typeof battleshipsClientMessageSchema>;
export type MoveDirection = 'forward' | 'back';

/** Battleships sends nothing beyond snapshots. */
export type BattleshipsServerMessage = never;

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/** `moving` opens on every roll of 5 or 6, whether or not a ship can slide: the roll alone never tells the room about the fleet. */
export type BattleshipsPhase = 'placing' | 'playing' | 'moving' | 'gameOver';
export type ShotResult = 'miss' | 'hit' | 'sunk';
/** What a shot left on a cell; a sunk ship's cells all read 'sunk'. */
export type CellMark = ShotResult;

export interface ShipView {
  id: string;
  x: number;
  y: number;
  length: number;
  horizontal: boolean;
  /** Damaged segments; a ship with hits never moves. */
  hits: number;
  sunk: boolean;
}

/** The viewer's own side's board: the fleet and every shot that landed on it. */
export interface OwnBoardView {
  sideId: string;
  ships: ShipView[];
  /** Shots received, keyed by `cellKey(x, y)`. */
  shots: Record<string, CellMark>;
  /** During `placing`: every ship has a spot / the layout is locked in. */
  placed: boolean;
  ready: boolean;
  /** Ships that could slide (undamaged, with unshot room) during the viewer's move window; empty when none can. */
  movable: Array<{ id: string; forward: boolean; back: boolean }>;
}

/** Another side's board as the viewer may see it: shots only, never ships. */
export interface TargetGridView {
  sideId: string;
  shots: Record<string, CellMark>;
  shipsLeft: number;
  shipsTotal: number;
  /** Lengths of the ships sunk so far. */
  sunkLengths: number[];
}

export interface SideView {
  id: string;
  /** Members in join order (one player in solo). */
  memberIds: string[];
  /** In teams: who places the fleet (the member with the lowest join order); the player in solo. */
  captainId: string;
  alive: boolean;
  /** During `placing`: the layout is locked in. */
  ready: boolean;
  shipsLeft: number;
}

export interface ShotEvent {
  shooterId: string;
  targetId: string;
  x: number;
  y: number;
  result: ShotResult;
  /** The length of the ship that went down, for `sunk` only: a plain hit never says which ship it found. */
  length: number | null;
  /** The die rolled after the shot, when dice moves are on. */
  dice: number | null;
  /** True for a shot the clock fired on the shooter's behalf. */
  auto: boolean;
}

export interface BattleshipsView {
  phase: BattleshipsPhase;
  mode: BattleshipsMode;
  boardSize: number;
  /** Ship lengths of the fleet, in ship-id order. */
  fleet: number[];
  sides: SideView[];
  /** The viewer's side; null for spectators, late joiners and the HTTP preview. */
  mySideId: string | null;
  myBoard: OwnBoardView | null;
  /** Every other side (every side for a viewer without one), in side order. */
  targets: TargetGridView[];
  /** Whose shot it is during `playing` / `moving`. */
  turn: { sideId: string; shooterId: string } | null;
  /** Epoch ms (server clock) when the current phase ends on its own; null while held. */
  endsAt: number | null;
  /** True while the game holds for disconnected players. */
  paused: boolean;
  /** The latest die roll, kept until the next shot. */
  dice: number | null;
  lastShot: ShotEvent | null;
  /** The last BATTLESHIPS_LOG_LENGTH shots, newest last. */
  log: ShotEvent[];
  winnerSideId: string | null;
  /** 1-based number of the shot being taken. */
  turnNumber: number;
}

export type BattleshipsRoomState = RoomState<BattleshipsView, BattleshipsSettings>;
