/** Per-recipient projection of QuipgameData: own prompts and answers only, authors hidden until a result. */
import type { QuipgameAnswerResultView, QuipgameFinalResultView, QuipgamePhase, QuipgameSettings, QuipgameView } from '../../../shared/games/quipgame/protocol.js';
import type { GameViewCtx } from '../../platform/game.js';
import { maxPicks } from './final.js';
import { finishedWriters, writerCounts } from './round.js';
import { answerById, currentMatchup, findPlayer, matchupAuthors, multiplierFor, promptById, type AnswerData, type MatchupResultData, type QuipgameData } from './state.js';

export function viewFor(data: QuipgameData, viewerId: string | null, ctx: GameViewCtx<QuipgameSettings>): QuipgameView {
  const phase: QuipgamePhase = data.phase === 'over' ? (data.final ? 'finalResult' : 'result') : data.phase;
  const viewer = viewerId === null ? undefined : findPlayer(ctx.players, viewerId);
  const isRoundPlayer = viewerId !== null && data.roundPlayers.includes(viewerId);
  const m = currentMatchup(data);
  const authors = m ? matchupAuthors(data, m) : [];
  const isAuthor = viewerId !== null && authors.includes(viewerId);
  const inMatchup = phase === 'voting' || phase === 'result';
  const inFinal = phase === 'finalWriting' || phase === 'finalVoting' || phase === 'finalResult';
  const final = inFinal ? data.final : null;
  const prompt = m ? promptById(data, m.promptId) : undefined;
  const myAnswers: Record<string, string> = {};
  let myAnswerId: string | null = null;
  for (const a of data.answers) {
    if (a.authorId !== viewerId) continue;
    myAnswers[a.promptId] = a.text;
    if (inFinal) myAnswerId = a.id;
  }
  const announcerId = inMatchup ? (m?.announcerId ?? null) : (final?.announcerId ?? null);
  const res = m?.result ?? null;
  const [resA, resB] = m && res ? m.answerIds.map((id, i) => resultView(answerById(data, id), res, i === 0 ? 'a' : 'b')) : [null, null];
  return {
    phase,
    round: data.round,
    totalRounds: data.totalRounds,
    endsAt: data.endsAt,
    multiplier: multiplierFor(data),
    roundPlayers: [...data.roundPlayers],
    spectators: ctx.players.filter((p) => !data.roundPlayers.includes(p.id)).map((p) => p.id),
    isSpectator: !isRoundPlayer,
    myPrompts: isRoundPlayer ? data.prompts.filter((p) => p.authorIds.includes(viewerId)).map((p) => ({ id: p.id, text: p.text })) : [],
    myAnswers,
    ...writerCounts(data, ctx.players),
    finished: phase === 'writing' || phase === 'finalWriting' ? finishedWriters(data, ctx.players) : [],
    matchup:
      phase === 'voting' && m && prompt
        ? { index: data.matchupIndex, total: data.matchups.length, prompt: prompt.text, a: answerById(data, m.answerIds[0])?.text ?? '', b: answerById(data, m.answerIds[1])?.text ?? '', votes: Object.keys(m.votes).length }
        : null,
    canVote: phase === 'voting' && viewer !== undefined && viewer.connected && !isAuthor,
    isAuthor: inMatchup && isAuthor,
    myVote: phase === 'voting' && viewerId !== null ? (m?.votes[viewerId] ?? null) : null,
    voted: phase === 'voting' && m ? Object.keys(m.votes) : phase === 'finalVoting' && final ? Object.keys(final.rankings) : [],
    result: phase === 'result' && m?.result && prompt && resA && resB ? { index: data.matchupIndex, total: data.matchups.length, prompt: prompt.text, a: resA, b: resB, outcome: m.result.outcome } : null,
    finalPrompt: inFinal ? (data.prompts[0]?.text ?? null) : null,
    finalAnswers: phase === 'finalVoting' && final ? final.order.map((id) => ({ id, text: answerById(data, id)?.text ?? '' })) : [],
    myAnswerId,
    maxPicks: phase === 'finalVoting' && final && viewer?.connected ? maxPicks(data, final, viewer.id) : 0,
    myRanking: final && viewerId !== null ? [...(final.rankings[viewerId] ?? [])] : [],
    ranked: final ? Object.keys(final.rankings).length : 0,
    finalResult: phase === 'finalResult' && final?.result ? final.result.map((e) => finalEntry(answerById(data, e.answerId), e)) : null,
    announcerId,
    isAnnouncer: viewerId !== null && announcerId === viewerId,
    canSkip: viewerId === ctx.hostId && data.phase !== 'over' && (phase === 'result' || phase === 'finalResult'),
  };
}

function resultView(a: AnswerData | undefined, result: MatchupResultData, side: 'a' | 'b'): QuipgameAnswerResultView {
  return {
    text: a?.text ?? '',
    authorId: a?.authorId ?? '',
    authorName: a?.authorName ?? 'Someone',
    votes: result.votes[side],
    points: result.points[side],
    flawless: result.flawless === side,
    fallback: a?.fallback ?? false,
  };
}

function finalEntry(a: AnswerData | undefined, e: { answerId: string; points: number; rank: number }): QuipgameFinalResultView {
  return { id: e.answerId, text: a?.text ?? '', authorId: a?.authorId ?? '', authorName: a?.authorName ?? 'Someone', points: e.points, rank: e.rank, fallback: a?.fallback ?? false };
}
