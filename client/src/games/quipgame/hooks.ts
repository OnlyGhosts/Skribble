import type { QuipgamePhase, QuipgamePromptView, QuipgameRoomState, QuipgameView } from '@shared/games/quipgame/protocol';
import type { PlayerPublic, RoomState } from '@shared/platform/protocol';

export function playerOf(room: RoomState, id: string | null | undefined): PlayerPublic | undefined {
  return id ? room.players.find((p) => p.id === id) : undefined;
}

export function nameOf(room: RoomState, id: string | null | undefined): string {
  return playerOf(room, id)?.name ?? 'Someone';
}

export const WRITING_PHASES: readonly QuipgamePhase[] = ['writing', 'finalWriting'];
export const RESULT_PHASES: readonly QuipgamePhase[] = ['result', 'finalResult'];

export function isWriting(view: QuipgameView): boolean {
  return WRITING_PHASES.includes(view.phase);
}

/** One step of the game: a phase, and for matchups which one, so a new matchup in the same phase still counts as a change. */
export function stepOf(room: QuipgameRoomState | null): string | null {
  const v = room?.game;
  if (!v) return null;
  return `${v.round}:${v.phase}:${v.matchup?.index ?? v.result?.index ?? ''}`;
}

export function stepChanged(prev: QuipgameRoomState | null, next: QuipgameRoomState): boolean {
  return stepOf(prev) !== stepOf(next);
}

export function phaseEntered(prev: QuipgameRoomState | null, next: QuipgameRoomState, phases: readonly QuipgamePhase[]): boolean {
  const now = next.game?.phase;
  const before = prev?.game?.phase;
  return now !== undefined && phases.includes(now) && (before === undefined || !phases.includes(before) || prev?.game?.round !== next.game?.round);
}

/** The prompt to show in the writing card: the one re-opened for editing, else the first still unanswered. */
export function promptToWrite(view: QuipgameView, editingPromptId: string | null): QuipgamePromptView | null {
  if (editingPromptId) {
    const editing = view.myPrompts.find((p) => p.id === editingPromptId);
    if (editing) return editing;
  }
  return view.myPrompts.find((p) => view.myAnswers[p.id] === undefined) ?? null;
}

/** 1-based position of `prompt` among this player's prompts. */
export function promptNumber(view: QuipgameView, prompt: QuipgamePromptView): number {
  return view.myPrompts.findIndex((p) => p.id === prompt.id) + 1;
}

/** Voters a matchup is waiting on: everyone connected but the two authors (whoever they are). */
export function voterCount(room: QuipgameRoomState, votes: number): number {
  return Math.max(votes, room.players.filter((p) => p.connected).length - 2);
}

export function rankerCount(room: QuipgameRoomState, ranked: number): number {
  return Math.max(ranked, room.players.filter((p) => p.connected).length);
}

export function sameRanking(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
