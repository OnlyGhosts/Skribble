/** The final round: one prompt for everyone, then everyone ranks the anonymous answers. */
import { QUIPGAME_MAX_PICKS } from '../../../shared/games/quipgame/protocol.js';
import { pickPoints } from '../../../shared/games/quipgame/scoring.js';
import { drawPrompts } from './prompts.js';
import { answerById, award, fail, pickAnnouncer, shuffle, snapshot, systemMessage, type FinalData, type FinalResultData, type Gx, type QuipgameData } from './state.js';
import type { PlatformPlayer } from '../../platform/game.js';

export function startFinal(gx: Gx): void {
  const { data, ctx } = gx;
  data.roundPlayers = ctx.players.filter((p) => p.connected).map((p) => p.id);
  data.answers = [];
  data.matchups = [];
  data.matchupIndex = 0;
  data.final = { order: [], rankings: {}, announcerId: null, result: null };
  const [text] = drawPrompts(gx, 1);
  data.prompts = [{ id: `r${data.round}-p0`, text, authorIds: [...data.roundPlayers] }];
  data.phase = 'finalWriting';
  data.endsAt = ctx.now + ctx.settings.writeSeconds * 1000;
  systemMessage(gx, 'Final round — one prompt, everyone answers!');
  snapshot(gx);
}

export function startFinalVoting(gx: Gx): void {
  const { data, ctx } = gx;
  const final = data.final ?? { order: [], rankings: {}, announcerId: null, result: null };
  final.order = shuffle(
    data.answers.map((a) => a.id),
    ctx.rng,
  );
  final.announcerId = ctx.settings.announcer ? pickAnnouncer(gx, []) : null;
  data.final = final;
  data.phase = 'finalVoting';
  data.endsAt = ctx.now + ctx.settings.voteSeconds * 1000;
  if (!resolveIfRanked(gx)) snapshot(gx);
}

/** The answers a voter may pick: every answer but their own. */
export function pickable(data: QuipgameData, final: FinalData, voterId: string): string[] {
  return final.order.filter((id) => answerById(data, id)?.authorId !== voterId);
}

export function maxPicks(data: QuipgameData, final: FinalData, voterId: string): number {
  return Math.min(QUIPGAME_MAX_PICKS, pickable(data, final, voterId).length);
}

/** Seated, connected and with something to pick: spectators included, players in reconnect grace not. */
export function eligibleRankers(data: QuipgameData, final: FinalData, players: PlatformPlayer[]): string[] {
  return players.filter((p) => p.connected && maxPicks(data, final, p.id) > 0).map((p) => p.id);
}

export function rank(gx: Gx, playerId: string, answerIds: string[]): void {
  const { data } = gx;
  const final = data.final;
  if (data.phase !== 'finalVoting' || !final) return fail(gx, playerId, 'There is no ranking open.');
  if (new Set(answerIds).size !== answerIds.length) return fail(gx, playerId, 'Pick each answer once.');
  if (answerIds.some((id) => !final.order.includes(id))) return fail(gx, playerId, "That's not one of the answers.");
  if (answerIds.some((id) => answerById(data, id)?.authorId === playerId)) return fail(gx, playerId, "You can't pick your own answer.");
  const limit = maxPicks(data, final, playerId);
  if (answerIds.length > limit) return fail(gx, playerId, `Pick at most ${limit} answer${limit === 1 ? '' : 's'}.`);
  final.rankings[playerId] = [...answerIds];
  if (!resolveIfRanked(gx)) snapshot(gx);
}

export function resolveIfRanked(gx: Gx): boolean {
  const { data, ctx } = gx;
  const final = data.final;
  if (data.phase !== 'finalVoting' || !final) return false;
  if (eligibleRankers(data, final, ctx.players).some((id) => final.rankings[id] === undefined)) return false;
  resolveFinal(gx);
  return true;
}

export function replaceFinalAnnouncer(gx: Gx, playerId: string): boolean {
  const final = gx.data.final;
  if (gx.data.phase !== 'finalVoting' || !final || final.announcerId !== playerId) return false;
  final.announcerId = pickAnnouncer(gx, []);
  return true;
}

/** Every voter's picks pay their authors 1500 / 1000 / 500; the answers are then ranked by points. */
export function resolveFinal(gx: Gx): void {
  const { data, ctx } = gx;
  const final = data.final;
  if (data.phase !== 'finalVoting' || !final) return;
  const points: Record<string, number> = {};
  for (const id of final.order) points[id] = 0;
  for (const picks of Object.values(final.rankings)) picks.forEach((id, i) => (points[id] = (points[id] ?? 0) + pickPoints(i)));
  const sorted = [...final.order].sort((x, y) => points[y] - points[x] || final.order.indexOf(x) - final.order.indexOf(y));
  final.result = sorted.map((answerId): FinalResultData => ({ answerId, points: points[answerId], rank: 1 + sorted.filter((o) => points[o] > points[answerId]).length }));
  for (const entry of final.result) {
    const a = answerById(data, entry.answerId);
    if (a) award(gx, a.authorId, entry.points);
  }
  data.phase = 'finalResult';
  data.endsAt = ctx.now + ctx.settings.resultsSeconds * 1000;
  const line = final.result.map((e) => `${e.rank}. ${answerById(data, e.answerId)?.authorName ?? 'Someone'} (${e.points})`).join(', ');
  systemMessage(gx, `Final ranking: ${line}`);
  snapshot(gx);
}
