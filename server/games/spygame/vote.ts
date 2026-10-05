/** Accusations and votes: one accusation per agent per round, a passed vote is the group's single guess. */
import { endRound, pauseClock, resumeClock } from './round.js';
import { fail, isRoundPlayer, nameOf, snapshot, systemMessage, type Gx } from './state.js';

export function accuse(gx: Gx, playerId: string, accusedId: string): void {
  const { data, ctx } = gx;
  const { current } = data;
  if (data.phase === 'voting') return fail(gx, playerId, 'A vote is already running.');
  if (data.phase !== 'playing') return fail(gx, playerId, 'The round is over.');
  if (!isRoundPlayer(data, playerId)) return fail(gx, playerId, 'You are watching this round.');
  if (playerId === current.spyId) return fail(gx, playerId, "The spy can't accuse anyone.");
  if (accusedId === playerId) return fail(gx, playerId, "You can't accuse yourself.");
  if (!isRoundPlayer(data, accusedId)) return fail(gx, playerId, 'You can only accuse a player in this round.');
  if (current.accusers.includes(playerId)) return fail(gx, playerId, 'You already started a vote this round.');

  pauseClock(gx);
  current.accusers.push(playerId);
  data.vote = {
    accuserId: playerId,
    accusedId,
    eligible: current.playerIds.filter((id) => id !== current.spyId && id !== accusedId),
    votes: { [playerId]: true },
    endsAt: ctx.now + ctx.settings.voteSeconds * 1000,
  };
  data.phase = 'voting';
  systemMessage(gx, `${nameOf(ctx, playerId)} accuses ${nameOf(ctx, accusedId)} of being the spy! Vote now.`);
  if (!resolveIfComplete(gx)) snapshot(gx);
}

export function vote(gx: Gx, playerId: string, yes: boolean): void {
  const { data } = gx;
  if (data.phase !== 'voting' || !data.vote) return fail(gx, playerId, 'There is no vote running.');
  if (!data.vote.eligible.includes(playerId)) return fail(gx, playerId, "You can't vote in this one.");
  if (playerId === data.vote.accuserId) return fail(gx, playerId, 'You started this vote — you count as Yes.');
  data.vote.votes[playerId] = yes;
  if (!resolveIfComplete(gx)) snapshot(gx);
}

/** Votes cast so far; voters who have not voted are in neither count until the vote resolves. */
export function tally(vote: { eligible: string[]; votes: Record<string, boolean> }): { yes: number; no: number } {
  let yes = 0;
  let no = 0;
  for (const id of vote.eligible) {
    if (vote.votes[id] === true) yes++;
    else if (vote.votes[id] === false) no++;
  }
  return { yes, no };
}

/** Resolves as soon as every eligible voter has voted. Returns true when it did. */
function resolveIfComplete(gx: Gx): boolean {
  const { vote: v } = gx.data;
  if (!v || v.eligible.some((id) => v.votes[id] === undefined)) return false;
  resolveVote(gx);
  return true;
}

/** Missing votes count as No; a tie fails. A passed vote ends the round either way. */
export function resolveVote(gx: Gx): void {
  const { data, ctx } = gx;
  const v = data.vote;
  if (data.phase !== 'voting' || !v) return;
  const { yes } = tally(v);
  const no = v.eligible.length - yes; // a missing vote counts as No
  if (yes > no) {
    systemMessage(gx, `The vote passed (${yes}–${no}): ${nameOf(ctx, v.accusedId)} is accused.`);
    return endRound(gx, v.accusedId === data.current.spyId ? 'spyCaught' : 'wrongAccusation', { accuserId: v.accuserId, accusedId: v.accusedId });
  }
  systemMessage(gx, `The vote failed (${yes}–${no}) — play on.`);
  data.vote = null;
  data.phase = 'playing';
  resumeClock(gx);
  snapshot(gx);
}

/** Drops the vote when the accused leaves (the accuser gets their accusation back); a leaving voter stops counting. */
export function voterLeft(gx: Gx, playerId: string): void {
  const { data } = gx;
  const v = data.vote;
  if (data.phase !== 'voting' || !v) return;
  if (playerId === v.accusedId) {
    systemMessage(gx, 'The accused left — the vote is off.');
    data.current.accusers = data.current.accusers.filter((id) => id !== v.accuserId);
    data.vote = null;
    data.phase = 'playing';
    resumeClock(gx);
    return snapshot(gx);
  }
  if (!v.eligible.includes(playerId)) return;
  v.eligible = v.eligible.filter((id) => id !== playerId);
  delete v.votes[playerId];
  if (!resolveIfComplete(gx)) snapshot(gx);
}
