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

/** The classic board: every board owned by one player. */
export const BATTLESHIPS_CLASSIC_SIZE = 10;
/**
 * Board side by crew (the players sharing a board): 1 player 10x10, 2 12x12, 3 13x13, and 4 or
 * more 14x14, which stays just under double the classic area.
 */
export const BATTLESHIPS_BOARD_SIZES = [10, 12, 13, 14] as const;
export const BATTLESHIPS_MAX_BOARD_SIZE = 14;
/** Each crew member beyond the first adds one ship of this length to the board's fleet. */
export const BATTLESHIPS_EXTRA_SHIP_LENGTH = 3;
/** The most ships a fleet message may carry (the classic fleet plus extra ships for a big crew). */
export const BATTLESHIPS_MAX_SHIPS = 16;

/** Ship lengths per fleet, longest first, before any extra ships for a crew. */
export const BATTLESHIPS_FLEETS = {
  small: [4, 3, 3, 2],
  classic: [5, 4, 3, 3, 2],
} as const;
export type BattleshipsFleet = keyof typeof BATTLESHIPS_FLEETS;

export const battleshipsSettingsSchema = z.object({
  /** Every player for themselves, or two teams sharing one board each. */
  mode: z.enum(['solo', 'teams']),
  fleet: z.enum(['small', 'classic']),
  /** Seconds everyone has to place their ships. */
  placeSeconds: z.number().int().min(BATTLESHIPS_SETTINGS_LIMITS.placeSeconds.min).max(BATTLESHIPS_SETTINGS_LIMITS.placeSeconds.max),
  /** Seconds a shooter has to fire or move. */
  turnSeconds: z.number().int().min(BATTLESHIPS_SETTINGS_LIMITS.turnSeconds.min).max(BATTLESHIPS_SETTINGS_LIMITS.turnSeconds.max),
  /** Every turn starts with a die roll, and the shooter either fires or moves a ship up to the roll. Off: one shot a turn. */
  moveOrFire: z.boolean(),
});

export type BattleshipsSettings = z.infer<typeof battleshipsSettingsSchema>;
export type BattleshipsMode = BattleshipsSettings['mode'];

export const DEFAULT_BATTLESHIPS_SETTINGS: BattleshipsSettings = {
  mode: 'solo',
  fleet: 'classic',
  placeSeconds: 60,
  turnSeconds: 30,
  moveOrFire: true,
};

// ---------------------------------------------------------------------------
// Rules shared by both sides
// ---------------------------------------------------------------------------

/** Shot events kept in the view's log. */
export const BATTLESHIPS_LOG_LENGTH = 12;
export const BATTLESHIPS_TEAM_IDS = ['A', 'B'] as const;
/** The faces of the die rolled at the start of every turn under move or fire. */
export const BATTLESHIPS_DIE_FACES = 6;

export const BATTLESHIPS_POINTS = {
  hit: 10,
  /** On top of the hit. */
  sink: 30,
  /** Per player on the winning side. */
  win: 100,
} as const;

export const BATTLESHIPS_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export type MoveDirection = (typeof BATTLESHIPS_DIRECTIONS)[number];

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const coord = z.number().int().min(0).max(BATTLESHIPS_MAX_BOARD_SIZE - 1);
const shipIdSchema = z.string().min(1).max(8);

export const shipPlacementSchema = z.object({ id: shipIdSchema, x: coord, y: coord, horizontal: z.boolean() });
export type ShipPlacement = z.infer<typeof shipPlacementSchema>;

/**
 * A move of one ship: up to the roll in a straight line, or a quarter turn about its centre
 * square (a whole move whatever the roll).
 */
export const shipMoveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shift'), direction: z.enum(BATTLESHIPS_DIRECTIONS), steps: z.number().int().min(1).max(BATTLESHIPS_DIE_FACES) }),
  z.object({ kind: z.literal('rotate') }),
]);
export type ShipMove = z.infer<typeof shipMoveSchema>;

/** The shooter's move in the making: a ship picked, and where it would go so far (null: not moved yet). */
export const movePlanSchema = z.object({ shipId: shipIdSchema, move: shipMoveSchema.nullable() });
export type MovePlan = z.infer<typeof movePlanSchema>;

export const battleshipsClientMessageSchema = z.discriminatedUnion('t', [
  /**
   * During `placing`, from a side's captain: the layout so far (any ships of the fleet, each once,
   * in bounds, no overlap). Sent after every drop, so teammates watch it take shape; the fleet is
   * `placed` once every ship has a spot.
   */
  z.object({ t: z.literal('place'), ships: z.array(shipPlacementSchema).max(BATTLESHIPS_MAX_SHIPS) }),
  /** During `placing`, from a side's captain: lock the complete layout in. */
  z.object({ t: z.literal('placeReady') }),
  /** During `placing`, from a side's captain: a random valid layout instead. */
  z.object({ t: z.literal('autoPlace') }),
  /** From the shooter on their turn: a cell of an opponent side not shot before. */
  z.object({ t: z.literal('fire'), targetId: z.string().min(1).max(64), x: coord, y: coord }),
  /** From the shooter on their turn, move or fire on: move one of their side's afloat ships instead of firing. */
  z.object({ t: z.literal('move'), shipId: shipIdSchema, move: shipMoveSchema }),
  /** From the shooter while choosing a move: the plan so far, shown live to their teammates (null clears it). */
  z.object({ t: z.literal('plan'), plan: movePlanSchema.nullable() }),
]);

export type BattleshipsClientMessage = z.infer<typeof battleshipsClientMessageSchema>;

/** Battleships sends nothing beyond snapshots. */
export type BattleshipsServerMessage = never;

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export type BattleshipsPhase = 'placing' | 'playing' | 'gameOver';
export type ShotResult = 'miss' | 'hit' | 'sunk';
/** What a shot left on a cell; a sunk ship's cells all read 'sunk'. */
export type CellMark = ShotResult;

export interface ShipView {
  id: string;
  x: number;
  y: number;
  length: number;
  horizontal: boolean;
  /** Per segment from (x, y): damaged or not. Damage travels with a ship that moves. */
  damage: boolean[];
  /** Damaged segments. */
  hits: number;
  sunk: boolean;
}

/** The viewer's own side's board: the fleet and every shot that landed on it. */
export interface OwnBoardView {
  sideId: string;
  ships: ShipView[];
  /** Shots received, keyed by `cellKey(x, y)`; they stay on their squares when a ship moves away. */
  shots: Record<string, CellMark>;
  /** During `placing`: every ship has a spot / the layout is locked in. */
  placed: boolean;
  ready: boolean;
  /** On this side's turn: the shooter's move in the making, so teammates watch it live. */
  plan: MovePlan | null;
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
  /** The side's last turn was a move, so its next one must be a shot. */
  movedLastTurn: boolean;
}

export interface ShotEvent {
  shooterId: string;
  targetId: string;
  x: number;
  y: number;
  result: ShotResult;
  /** The length of the ship that went down, for `sunk` only: a plain hit never says which ship it found. */
  length: number | null;
  /** The die rolled at the start of the turn; null with move or fire off. */
  dice: number | null;
  /** True for a shot the clock fired on the shooter's behalf. */
  auto: boolean;
}

/** What the last turn did. A move says who moved, never which ship or where. */
export type TurnAction = { kind: 'fire'; shot: ShotEvent } | { kind: 'move'; playerId: string; sideId: string; dice: number };

export interface TurnView {
  sideId: string;
  shooterId: string;
  /** The die rolled for this turn, seen by everyone; null with move or fire off. */
  roll: number | null;
  /** Move or fire is on and the side did not move last turn. Whether a ship has room is the side's own business. */
  canMove: boolean;
}

export interface BattleshipsView {
  phase: BattleshipsPhase;
  mode: BattleshipsMode;
  /** Move or fire is on: every turn rolls a die and offers a move. */
  moveOrFire: boolean;
  /** Every board's side: 10 for solo, 10 to 14 by crew in teams. */
  boardSize: number;
  /** Ship lengths of every fleet, in ship-id order (longest first). */
  fleet: number[];
  sides: SideView[];
  /** The viewer's side; null for spectators, late joiners and the HTTP preview. */
  mySideId: string | null;
  myBoard: OwnBoardView | null;
  /** Every other side (every side for a viewer without one), in side order. */
  targets: TargetGridView[];
  /** Whose turn it is during `playing`. */
  turn: TurnView | null;
  /** Epoch ms (server clock) when the current phase ends on its own; null while held. */
  endsAt: number | null;
  /** True while the game holds for disconnected players. */
  paused: boolean;
  lastShot: ShotEvent | null;
  /** The last turn's shot or move. */
  lastAction: TurnAction | null;
  /** The last BATTLESHIPS_LOG_LENGTH shots, newest last. */
  log: ShotEvent[];
  winnerSideId: string | null;
  /** 1-based number of the turn being taken (shots and moves). */
  turnNumber: number;
}

export type BattleshipsRoomState = RoomState<BattleshipsView, BattleshipsSettings>;
