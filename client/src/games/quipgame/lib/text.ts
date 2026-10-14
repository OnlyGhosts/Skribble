import type { QuipgamePhase, QuipgameView } from '@shared/games/quipgame/protocol';

export function chatPlaceholderFor(phase: QuipgamePhase): string {
  switch (phase) {
    case 'writing':
    case 'finalWriting':
      return 'No spoilers while you write…';
    case 'voting':
    case 'finalVoting':
      return 'Vote first, then chat…';
    case 'result':
    case 'finalResult':
      return 'Say it to their face…';
  }
}

export function roundLabel(view: QuipgameView, long: boolean): string {
  const final = view.phase.startsWith('final');
  if (final) return long ? `Final round (${view.round} of ${view.totalRounds})` : 'Final';
  return long ? `Round ${view.round} of ${view.totalRounds}` : `Round ${view.round}/${view.totalRounds}`;
}

export function waitingLine(done: number, total: number): string {
  return `Waiting for the others (${done} of ${total} done)`;
}

export function doneLine(done: number, total: number): string {
  return `${done} of ${total} players done`;
}

export function votedLine(votes: number, voters: number): string {
  return `${votes} of ${voters} voted`;
}

export function rankedLine(ranked: number, rankers: number): string {
  return `${ranked} of ${rankers} ranked`;
}

const MEDALS = ['🥇', '🥈', '🥉'] as const;
const MEDAL_NAMES = ['gold', 'silver', 'bronze'] as const;

/** The final's instruction, naming only the medals this voter can hand out. */
export function rankHint(maxPicks: number): string {
  if (maxPicks <= 1) return 'Tap your favourite answer for gold. Tap again to take the medal back.';
  const medals = MEDAL_NAMES.slice(0, Math.min(maxPicks, MEDAL_NAMES.length)).join(', ');
  return `Tap your top ${maxPicks} in order: ${medals}. Tap again to take a medal back.`;
}

export function medalFor(rank: number): string {
  return MEDALS[rank - 1] ?? '';
}
