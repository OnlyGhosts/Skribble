/**
 * The complete, JSON-safe state of one room. No Map/Set/Date/class instances/timers/sockets:
 * `JSON.parse(JSON.stringify(data))` is the identity, so the same object can be stored in
 * memory or in Redis and driven from anywhere.
 *
 * Everything the game needs lives here except the canvas ops (see CanvasStore): deadlines are
 * epoch ms, so no timers are needed; the driver asks `nextDeadline(data)` when to tick next.
 */
import type { Avatar } from '../../shared/avatar.js';
import type { ChatMessage, Phase, TurnEndReason } from '../../shared/protocol.js';
import { DEFAULT_SETTINGS, type RoomSettings } from '../../shared/settings.js';

export type Rating = 'like' | 'dislike';

export interface PlayerData {
  id: string;
  /** Secret used by `rejoin`. Players who leave or are kicked are removed, so a token never outlives its seat. */
  token: string;
  name: string;
  avatar: Avatar;
  score: number;
  /** Position in the turn order (0-based, never reused within a room). */
  joinOrder: number;
  connected: boolean;
  /** Id of the connection bound to this seat; null while disconnected. */
  connectionId: string | null;
  /** When the current connection was established; the longest-connected player becomes host. */
  connectedAt: number;
  /** Epoch ms of the disconnect that started the reconnect grace; null while connected. */
  disconnectedAt: number | null;
  /** True once this player has guessed the current word (also true for the drawer). */
  guessedThisTurn: boolean;
  turnPoints: number;
  rating: Rating | null;
}

export interface TurnData {
  drawerId: string;
  choices: string[];
  /** Empty string until the drawer picked (or was auto-assigned) a word. */
  word: string;
  startedAt: number;
  endsAt: number;
  /** Letter indices in the order they get revealed as hints. */
  revealOrder: number[];
  /** Epoch ms at which revealOrder[i] is revealed; revealOrder[revealed.length] is the next one. */
  revealAt: number[];
  revealed: number[];
  /** Correct guesses this turn; tallied as they happen so leavers still count for the drawer. */
  correct: number;
  /** Everyone who was a connected non-drawer at some point while the word was being drawn. */
  guesserIds: string[];
}

export type Podium = Extract<Phase, { kind: 'gameEnd' }>['podium'];

export type PhaseData =
  | { kind: 'lobby' }
  | { kind: 'choosing'; endsAt: number }
  | { kind: 'drawing' }
  | {
      kind: 'turnEnd';
      reason: TurnEndReason;
      endsAt: number;
      points: Record<string, number>;
      /** True while the next turn waits for a player in reconnect grace (endsAt no longer fires). */
      held: boolean;
    }
  | { kind: 'gameEnd'; podium: Podium };

export interface GraceDeadlines {
  /** The drawer's socket dropped: the turn is skipped at this time unless they rejoin. */
  drawerGoneAt: number | null;
  /** Too few players are connected: the game is abandoned at this time unless someone comes back. */
  lowPlayersAt: number | null;
  /** The last unsolved guesser dropped: "everyone guessed" ends the turn at this time unless they rejoin. */
  allGuessedAt: number | null;
  /** The room is empty: it is destroyed at this time unless someone joins. */
  emptyRoomAt: number | null;
}

export interface VoteKick {
  targetId: string;
  voterIds: string[];
}

export interface RoomData {
  code: string;
  /** Increments on every action that changed something; lets drivers detect concurrent writes. */
  version: number;
  createdAt: number;
  updatedAt: number;
  settings: RoomSettings;
  hostId: string;
  /** Host whose socket dropped: a connected stand-in holds the role until they rejoin or are removed. */
  returningHostId: string | null;
  nextJoinOrder: number;
  /** In join order. */
  players: PlayerData[];
  phase: PhaseData;
  turn: TurnData | null;
  /** Identifies the current canvas: bumped whenever the canvas is reset (turn start, lobby reset). */
  turnId: number;
  /** 1-based current round (0 in lobby). */
  round: number;
  /** Player ids drawing this round, in order. Skipped drawers are removed so turn counts stay accurate. */
  turnQueue: string[];
  turnIndex: number;
  /** Lower-cased words already drawn this game. */
  usedWords: string[];
  /** Public chat history (capped at CHAT_HISTORY_LENGTH), replayed to joiners. */
  chat: ChatMessage[];
  nextChatId: number;
  votes: VoteKick[];
  grace: GraceDeadlines;
}

export function createRoomData(code: string, now: number): RoomData {
  return {
    code,
    version: 0,
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS, customWords: [] },
    hostId: '',
    returningHostId: null,
    nextJoinOrder: 0,
    players: [],
    phase: { kind: 'lobby' },
    turn: null,
    turnId: 0,
    round: 0,
    turnQueue: [],
    turnIndex: -1,
    usedWords: [],
    chat: [],
    nextChatId: 1,
    votes: [],
    grace: { drawerGoneAt: null, lowPlayersAt: null, allGuessedAt: null, emptyRoomAt: null },
  };
}
