/** Regular rounds: prompt assignment, the writing phase (answers, resubmission, fallbacks) and moving on. */
import { FALLBACK_ANSWERS } from '../../../shared/games/quipgame/prompts.js';
import { QUIPGAME_REGULAR_ROUNDS } from '../../../shared/games/quipgame/protocol.js';
import { startFinal, startFinalVoting } from './final.js';
import { drawPrompts } from './prompts.js';
import {
  MIN_PLAYERS,
  answerFor,
  connectedCount,
  fail,
  findPlayer,
  isFinalRound,
  nameOf,
  pickOne,
  promptById,
  shuffle,
  snapshot,
  systemMessage,
  type Gx,
  type MatchupData,
  type PromptData,
} from './state.js';
import { startMatchup } from './vote.js';

export function abortForLowPlayers(gx: Gx): boolean {
  if (connectedCount(gx.ctx) >= MIN_PLAYERS) return false;
  gx.effects.push({ type: 'abort', reason: 'Not enough players — back to the lobby.' });
  return true;
}

/** Round players in join order; the prompt assignment is shuffled separately so the public list gives nothing away. */
export function seatRound(gx: Gx): string[] {
  const { data, ctx } = gx;
  data.roundPlayers = ctx.players.filter((p) => p.connected).map((p) => p.id);
  data.answers = [];
  data.matchups = [];
  data.matchupIndex = 0;
  data.final = null;
  return data.roundPlayers;
}

/** Player i of the shuffled order writes prompts i and (i + 1) mod N: two authors per prompt, two prompts per player. */
export function assignPrompts(gx: Gx, players: string[]): PromptData[] {
  const order = shuffle(players, gx.ctx.rng);
  const n = order.length;
  return drawPrompts(gx, n).map((text, i) => ({ id: `r${gx.data.round}-p${i}`, text, authorIds: [order[i], order[(i + n - 1) % n]] }));
}

export function startRound(gx: Gx): void {
  const { data, ctx } = gx;
  const players = seatRound(gx);
  data.prompts = assignPrompts(gx, players);
  data.phase = 'writing';
  data.endsAt = ctx.now + ctx.settings.writeSeconds * 1000;
  const extra = data.round === QUIPGAME_REGULAR_ROUNDS ? ' Double points!' : '';
  systemMessage(gx, `Round ${data.round} of ${data.totalRounds} — write your answers!${extra}`);
  snapshot(gx);
}

export function answer(gx: Gx, playerId: string, promptId: string, text: string): void {
  const { data, ctx } = gx;
  if (data.phase !== 'writing' && data.phase !== 'finalWriting') return fail(gx, playerId, 'Writing is over.');
  if (!data.roundPlayers.includes(playerId)) return fail(gx, playerId, 'You are watching this round.');
  const prompt = promptById(data, promptId);
  if (!prompt || !prompt.authorIds.includes(playerId)) return fail(gx, playerId, "That's not one of your prompts.");
  const existing = answerFor(data, promptId, playerId);
  if (existing) {
    existing.text = text;
    existing.fallback = false;
  } else {
    data.answers.push({ id: ctx.newId(), promptId, authorId: playerId, authorName: nameOf(ctx, playerId), text, fallback: false });
  }
  if (allWritten(gx)) return finishWriting(gx, 'everyoneIn');
  snapshot(gx);
}

/** Round players still seated who have answered every prompt of theirs, in join order. */
export function finishedWriters(data: Gx['data'], players: Gx['ctx']['players']): string[] {
  return seatedWriters(data, players).filter((id) => data.prompts.every((p) => !p.authorIds.includes(id) || answerFor(data, p.id, id)));
}

function seatedWriters(data: Gx['data'], players: Gx['ctx']['players']): string[] {
  return data.roundPlayers.filter((id) => findPlayer(players, id));
}

/** How many round players still seated are done, and how many were asked. */
export function writerCounts(data: Gx['data'], players: Gx['ctx']['players']): { done: number; total: number } {
  return { done: finishedWriters(data, players).length, total: seatedWriters(data, players).length };
}

/** Everyone still seated has written everything (a player who left cannot hold the round up). */
export function allWritten(gx: Gx): boolean {
  const { done, total } = writerCounts(gx.data, gx.ctx.players);
  return done === total;
}

/** Closes the writing phase: missing answers get a stand-in, then the matchups (or the final ranking) begin. */
export function finishWriting(gx: Gx, why: 'everyoneIn' | 'timeUp'): void {
  const { data, ctx } = gx;
  if (data.phase !== 'writing' && data.phase !== 'finalWriting') return;
  for (const prompt of data.prompts) {
    for (const authorId of prompt.authorIds) {
      if (answerFor(data, prompt.id, authorId)) continue;
      data.answers.push({ id: ctx.newId(), promptId: prompt.id, authorId, authorName: nameOf(ctx, authorId), text: pickOne(FALLBACK_ANSWERS, ctx.rng), fallback: true });
    }
  }
  systemMessage(gx, why === 'everyoneIn' ? "Everyone's in — time to vote!" : "Time's up — time to vote!");
  if (isFinalRound(data)) return startFinalVoting(gx);
  data.matchups = data.prompts.map((prompt): MatchupData => {
    const ids = prompt.authorIds.map((authorId) => answerFor(data, prompt.id, authorId)?.id ?? '');
    const flip = ctx.rng() < 0.5;
    return { promptId: prompt.id, answerIds: flip ? [ids[1], ids[0]] : [ids[0], ids[1]], votes: {}, announcerId: null, result: null };
  });
  startMatchup(gx, 0);
}

/** Leaves a result: the next matchup, the next round, the final, or the podium; the lobby when too few are left. */
export function advance(gx: Gx): void {
  const { data } = gx;
  if (data.phase === 'finalResult') {
    data.phase = 'over';
    gx.effects.push({ type: 'gameOver' });
    return;
  }
  if (data.phase !== 'result') return;
  if (data.matchupIndex + 1 < data.matchups.length) return startMatchup(gx, data.matchupIndex + 1);
  if (data.round >= data.totalRounds) {
    data.phase = 'over';
    gx.effects.push({ type: 'gameOver' });
    return;
  }
  if (abortForLowPlayers(gx)) return;
  data.round += 1;
  if (isFinalRound(data)) return startFinal(gx);
  startRound(gx);
}

export function next(gx: Gx, playerId: string): void {
  if (playerId !== gx.ctx.hostId) return fail(gx, playerId, 'Only the host can skip ahead.');
  if (gx.data.phase !== 'result' && gx.data.phase !== 'finalResult') return fail(gx, playerId, 'There is no result to skip.');
  advance(gx);
}
