/** Per-recipient projection of SkribbleData: the word and the choices only reach those allowed to see them. */
import { maskWord } from '../../../shared/games/skribble/hints.js';
import type { SkribblePhase, SkribblePlayerView, SkribbleSettings, SkribbleView } from '../../../shared/games/skribble/protocol.js';
import type { GameViewCtx } from '../../platform/game.js';
import type { SkribbleData } from './state.js';

export function viewFor(data: SkribbleData, viewerId: string | null, ctx: GameViewCtx<SkribbleSettings>): SkribbleView {
  const players: Record<string, SkribblePlayerView> = {};
  for (const p of ctx.players) {
    players[p.id] = { guessedThisTurn: data.turn?.guessed.includes(p.id) ?? false, turnPoints: data.turn?.points[p.id] ?? 0 };
  }
  return {
    phase: phaseFor(data, viewerId),
    round: data.round,
    totalRounds: ctx.settings.rounds,
    turn: Math.min(data.turnIndex + 1, data.turnQueue.length),
    turnsInRound: data.turnQueue.length,
    players,
  };
}

function phaseFor(data: SkribbleData, viewerId: string | null): SkribblePhase {
  const { turn, phase } = data;
  switch (phase.kind) {
    case 'choosing': {
      const base = { kind: 'choosing' as const, drawerId: turn?.drawerId ?? '', endsAt: phase.endsAt };
      return viewerId !== null && viewerId === turn?.drawerId ? { ...base, choices: [...(turn?.choices ?? [])] } : base;
    }
    case 'drawing': {
      let likes = 0;
      let dislikes = 0;
      for (const rating of Object.values(turn?.ratings ?? {})) {
        if (rating === 'like') likes++;
        else dislikes++;
      }
      const word = turn?.word ?? '';
      const out: SkribblePhase = {
        kind: 'drawing',
        drawerId: turn?.drawerId ?? '',
        startedAt: turn?.startedAt ?? 0,
        endsAt: turn?.endsAt ?? 0,
        mask: maskWord(word, turn?.revealed ?? []),
        likes,
        dislikes,
      };
      if (viewerId !== null && turn && (viewerId === turn.drawerId || turn.guessed.includes(viewerId))) out.word = word;
      const mine = viewerId !== null ? turn?.ratings[viewerId] : undefined;
      if (mine) out.myRating = mine;
      return out;
    }
    case 'turnEnd':
      return {
        kind: 'turnEnd',
        drawerId: turn?.drawerId ?? '',
        word: turn?.word ?? '',
        reason: phase.reason,
        endsAt: phase.endsAt,
        points: { ...phase.points },
      };
    case 'gameOver':
      return { kind: 'gameOver' };
  }
}
