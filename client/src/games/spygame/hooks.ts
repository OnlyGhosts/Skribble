import type { SpygameRoomState, SpygameView } from '@shared/games/spygame/protocol';
import type { PlayerPublic, RoomState } from '@shared/platform/protocol';

export function playerOf(room: RoomState, id: string | null | undefined): PlayerPublic | undefined {
  return id ? room.players.find((p) => p.id === id) : undefined;
}

export function nameOf(room: RoomState, id: string | null | undefined): string {
  return playerOf(room, id)?.name ?? 'Someone';
}

/** A round started: the first snapshot with a game, or the round counter moved. */
export function isNewRound(prev: SpygameRoomState | null, next: SpygameRoomState): boolean {
  if (!next.game) return false;
  return !prev?.game || prev.game.round !== next.game.round;
}

export function voteStarted(prev: SpygameRoomState | null, next: SpygameRoomState): boolean {
  return next.game?.phase === 'voting' && prev?.game?.phase !== 'voting';
}

export function voteEnded(prev: SpygameRoomState | null, next: SpygameRoomState): boolean {
  return prev?.game?.phase === 'voting' && next.game?.phase !== 'voting';
}

/** The spy ruled another location out (same round, one more wrong guess). */
export function wrongGuessAdded(prev: SpygameRoomState | null, next: SpygameRoomState): boolean {
  if (!prev?.game || !next.game || prev.game.round !== next.game.round) return false;
  return next.game.spyGuessed.length > prev.game.spyGuessed.length;
}

export function roundEnded(prev: SpygameRoomState | null, next: SpygameRoomState): boolean {
  return next.game?.phase === 'reveal' && prev?.game !== undefined && prev?.game !== null && prev.game.phase !== 'reveal';
}

export type VoteRole = 'accuser' | 'accused' | 'voter' | 'watcher';

/** What this player is to the running vote; 'watcher' when there is none or they have no say. */
export function voteRoleOf(view: SpygameView, meId: string): VoteRole {
  const vote = view.vote;
  if (!vote) return 'watcher';
  if (vote.accuserId === meId) return 'accuser';
  if (vote.accusedId === meId) return 'accused';
  return vote.canVote ? 'voter' : 'watcher';
}

/** The round clock just stopped for the spy's dropped connection. */
export function spyWentAway(prev: SpygameRoomState | null, next: SpygameRoomState): boolean {
  return next.game?.clock.waitingForId !== null && next.game?.clock.waitingForId !== undefined && prev?.game?.clock.waitingForId !== next.game.clock.waitingForId;
}

/** Whether the spy may tap a tile right now: only while the round clock runs and guesses remain. */
export function canGuessNow(view: SpygameView): boolean {
  return view.phase === 'playing' && view.clock.endsAt !== null && view.guessesLeft > 0;
}

/** Why this player cannot start a vote right now; null when they can. Target-specific reasons come from `accuseTargetBlock`. */
export function accuseBlock(view: SpygameView, meId: string): string | null {
  if (view.role === 'spy') return null; // the spy's list is read-only; no reason is printed
  if (view.role === 'spectator') return "You're watching this round.";
  if (view.phase === 'voting') return 'A vote is running.';
  if (view.phase === 'reveal') return 'The round is over.';
  if (view.players[meId]?.hasAccused) return "You've used your accusation this round.";
  return null;
}

export function accuseTargetBlock(view: SpygameView, meId: string, targetId: string): string | null {
  if (targetId === meId) return "That's you";
  if (view.players[targetId]?.isSpectator) return 'Watching';
  return null;
}
