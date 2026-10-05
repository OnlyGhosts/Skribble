/** Per-recipient projection of SpygameData: the location reaches agents only (everyone once revealed), the spy's identity never before the reveal. */
import type { SpygameClock, SpygamePlayerView, SpygameRole, SpygameSettings, SpygameView, SpygameVoteView } from '../../../shared/games/spygame/protocol.js';
import type { GameViewCtx } from '../../platform/game.js';
import type { SpygameData, VoteData } from './state.js';
import { tally } from './vote.js';

export function viewFor(data: SpygameData, viewerId: string | null, ctx: GameViewCtx<SpygameSettings>): SpygameView {
  const { current, vote, reveal } = data;
  const revealed = data.phase === 'reveal' || data.phase === 'over';
  const phase = data.phase === 'playing' || data.phase === 'voting' ? data.phase : 'reveal';
  const role: SpygameRole = viewerId === null ? 'spectator' : viewerId === current.spyId ? 'spy' : current.playerIds.includes(viewerId) ? 'agent' : 'spectator';
  const players: Record<string, SpygamePlayerView> = {};
  const spectators: string[] = [];
  for (const p of ctx.players) {
    const isSpectator = !current.playerIds.includes(p.id);
    if (isSpectator) spectators.push(p.id);
    players[p.id] = { hasAccused: current.accusers.includes(p.id), isAccused: vote?.accusedId === p.id, isSpectator };
  }
  return {
    phase,
    round: data.round,
    totalRounds: ctx.settings.rounds,
    clock: clockFor(data, ctx.settings.roundMinutes * 60_000),
    candidates: [...current.candidates],
    guessesLeft: current.guessesLeft,
    spyGuessed: [...current.guessed],
    roundPlayers: [...current.playerIds],
    spectators,
    players,
    vote: vote ? voteViewFor(vote, viewerId) : null,
    reveal: reveal ? { ...reveal, points: { ...reveal.points } } : null,
    role,
    locationId: revealed || role === 'agent' ? current.locationId : null,
  };
}

/**
 * The eligible list stays on the server: it is the agents minus the accused, so its members (or
 * its size) would tell everyone whether the accused is the spy. Each recipient learns only whether
 * they themselves may vote.
 */
function voteViewFor(vote: VoteData, viewerId: string | null): SpygameVoteView {
  const eligible = viewerId !== null && vote.eligible.includes(viewerId);
  return {
    accuserId: vote.accuserId,
    accusedId: vote.accusedId,
    ...tally(vote),
    endsAt: vote.endsAt,
    canVote: eligible && viewerId !== vote.accuserId,
    myVote: eligible ? (vote.votes[viewerId] ?? null) : null,
  };
}

function clockFor(data: SpygameData, fullRoundMs: number): SpygameClock {
  const { current } = data;
  if (data.phase === 'reveal' || data.phase === 'over') return { endsAt: null, pausedRemainingMs: fullRoundMs, pausedReason: 'reveal', waitingForId: null };
  if (current.clock.kind === 'running') return { endsAt: current.clock.endsAt, pausedRemainingMs: null, pausedReason: null, waitingForId: null };
  return {
    endsAt: null,
    pausedRemainingMs: current.clock.remainingMs,
    pausedReason: data.phase === 'voting' ? 'vote' : 'spyAway',
    waitingForId: current.spyAway ? current.spyId : null,
  };
}
