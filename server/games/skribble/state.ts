/** Skribble's JSON-safe game state (the module's `D`) and the queries over it. */
import type { Rating, SkribbleSettings, TurnEndReason } from '../../../shared/games/skribble/protocol.js';
import type { GameCtx, PlatformPlayer } from '../../platform/game.js';

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
  /** Players who solved the word this turn (the drawer included). */
  guessed: string[];
  /** Points earned this turn by player id. */
  points: Record<string, number>;
  ratings: Record<string, Rating>;
}

export type PhaseData =
  | { kind: 'choosing'; endsAt: number }
  | { kind: 'drawing' }
  | {
      kind: 'turnEnd';
      reason: TurnEndReason;
      endsAt: number;
      points: Record<string, number>;
      /**
       * True while the next turn waits for disconnected players (endsAt no longer fires): fewer
       * than two are connected but enough still hold seats. The platform shows RoomState.waiting
       * over this summary; a reconnect or a join resumes the game.
       */
      held: boolean;
    }
  | { kind: 'gameOver' };

export interface SkribbleData {
  phase: PhaseData;
  turn: TurnData | null;
  /** Identifies the current canvas (the side store's stamp): fresh on every reset. */
  canvasId: string;
  /** 1-based current round. */
  round: number;
  /** Player ids drawing this round, in order. Skipped drawers are removed so turn counts stay accurate. */
  turnQueue: string[];
  turnIndex: number;
  /** Lower-cased words already drawn this game. */
  usedWords: string[];
  grace: {
    /** The drawer's socket dropped: the turn is skipped at this time unless they rejoin. */
    drawerGoneAt: number | null;
    /** The last unsolved guesser dropped: "everyone guessed" ends the turn at this time unless they rejoin. */
    allGuessedAt: number | null;
  };
}

export type Ctx = GameCtx<SkribbleSettings>;

export function findPlayer(ctx: Ctx, id: string): PlatformPlayer | undefined {
  return ctx.players.find((p) => p.id === id);
}

export function connectedCount(ctx: Ctx): number {
  return ctx.players.filter((p) => p.connected).length;
}

export function isHeld(data: SkribbleData): boolean {
  return data.phase.kind === 'turnEnd' && data.phase.held;
}

/** True when every connected non-drawer has guessed (and there is at least one). */
export function everyoneGuessed(ctx: Ctx, data: SkribbleData): boolean {
  if (!data.turn) return false;
  let pending = 0;
  let guessers = 0;
  for (const p of ctx.players) {
    if (p.id === data.turn.drawerId || !p.connected) continue;
    guessers++;
    if (!data.turn.guessed.includes(p.id)) pending++;
  }
  return guessers > 0 && pending === 0;
}

export function isDrawer(data: SkribbleData, playerId: string): boolean {
  return data.turn !== null && data.turn.drawerId === playerId;
}

/** The drawer may draw during the drawing phase, until its deadline (even if no tick has ended it yet). */
export function canDraw(data: SkribbleData, playerId: string, now: number): boolean {
  return data.phase.kind === 'drawing' && data.turn !== null && data.turn.drawerId === playerId && now < data.turn.endsAt;
}

export const NOT_DRAWER_MESSAGE = 'Only the drawer can draw right now.';

/**
 * Whether a canvas op from `playerId` is accepted. Ops the drawer had in flight when their turn
 * ended are expected ('silent'); only a stranger drawing gets an error ('forbidden').
 */
export function drawerCheck(data: SkribbleData, playerId: string, now: number): 'ok' | 'silent' | 'forbidden' {
  if (canDraw(data, playerId, now)) return 'ok';
  return isDrawer(data, playerId) ? 'silent' : 'forbidden';
}
