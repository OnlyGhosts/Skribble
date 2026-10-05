/** Matchups: one prompt, two anonymous answers, everyone else votes; then the result with the points. */
import type { QuipgameChoice } from '../../../shared/games/quipgame/protocol.js';
import { scoreMatchup } from '../../../shared/games/quipgame/scoring.js';
import { answerById, award, currentMatchup, fail, matchupAuthors, multiplierFor, pickAnnouncer, promptById, snapshot, systemMessage, type Gx, type MatchupData } from './state.js';

export function startMatchup(gx: Gx, index: number): void {
  const { data, ctx } = gx;
  data.phase = 'voting';
  data.matchupIndex = index;
  data.endsAt = ctx.now + ctx.settings.voteSeconds * 1000;
  const m = data.matchups[index];
  m.announcerId = ctx.settings.announcer ? pickAnnouncer(gx, matchupAuthors(data, m)) : null;
  if (!resolveIfComplete(gx)) snapshot(gx);
}

/** Everyone seated and connected except the two authors: spectators included, players in reconnect grace not. */
export function eligibleVoters(gx: Gx, m: MatchupData): string[] {
  const authors = matchupAuthors(gx.data, m);
  return gx.ctx.players.filter((p) => p.connected && !authors.includes(p.id)).map((p) => p.id);
}

export function vote(gx: Gx, playerId: string, choice: QuipgameChoice): void {
  const { data } = gx;
  const m = currentMatchup(data);
  if (data.phase !== 'voting' || !m) return fail(gx, playerId, 'There is no matchup to vote on.');
  if (matchupAuthors(data, m).includes(playerId)) return fail(gx, playerId, "This one's yours — sit tight.");
  m.votes[playerId] = choice;
  if (!resolveIfComplete(gx)) snapshot(gx);
}

/** A seat emptied mid-matchup: its vote no longer counts, so the tally, the live count and the badges all drop it. */
export function forgetVoter(gx: Gx, playerId: string): void {
  const m = currentMatchup(gx.data);
  if (gx.data.phase === 'voting' && m) delete m.votes[playerId];
}

export function tally(m: MatchupData): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const choice of Object.values(m.votes)) {
    if (choice === 'a') a++;
    else b++;
  }
  return { a, b };
}

/** Resolves as soon as every eligible connected voter has voted. Returns true when it did. */
export function resolveIfComplete(gx: Gx): boolean {
  const m = currentMatchup(gx.data);
  if (gx.data.phase !== 'voting' || !m) return false;
  if (eligibleVoters(gx, m).some((id) => m.votes[id] === undefined)) return false;
  resolveMatchup(gx);
  return true;
}

/** The announcer's socket went down: hand the job to the next player so the room is not left waiting. */
export function replaceAnnouncer(gx: Gx, playerId: string): boolean {
  const m = currentMatchup(gx.data);
  if (gx.data.phase !== 'voting' || !m || m.announcerId !== playerId) return false;
  m.announcerId = pickAnnouncer(gx, matchupAuthors(gx.data, m));
  return true;
}

export function resolveMatchup(gx: Gx): void {
  const { data, ctx } = gx;
  const m = currentMatchup(data);
  if (data.phase !== 'voting' || !m) return;
  const votes = tally(m);
  const score = scoreMatchup(votes.a, votes.b, multiplierFor(data));
  m.result = { votes, points: { a: score.a, b: score.b }, flawless: score.flawless, outcome: score.outcome };
  const [a, b] = m.answerIds.map((id) => answerById(data, id));
  if (a) award(gx, a.authorId, score.a);
  if (b) award(gx, b.authorId, score.b);
  data.phase = 'result';
  data.endsAt = ctx.now + ctx.settings.resultsSeconds * 1000;
  const nameA = a?.authorName ?? 'Someone';
  const nameB = b?.authorName ?? 'Someone';
  switch (score.outcome) {
    case 'a':
      systemMessage(gx, `${nameA} took it ${votes.a}-${votes.b} (+${score.a})${score.flawless ? ' — flawless!' : ''}`);
      break;
    case 'b':
      systemMessage(gx, `${nameB} took it ${votes.b}-${votes.a} (+${score.b})${score.flawless ? ' — flawless!' : ''}`);
      break;
    case 'tie':
      systemMessage(gx, `${nameA} and ${nameB} tie ${votes.a}-${votes.b} (+${score.a} each)`);
      break;
    case 'noVotes':
      systemMessage(gx, `Nobody voted on "${promptById(data, m.promptId)?.text ?? 'that one'}" — no points.`);
      break;
  }
  snapshot(gx);
}
