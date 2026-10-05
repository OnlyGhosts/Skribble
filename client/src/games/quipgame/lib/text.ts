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

/** The phase in a few words; `short` is the phone header's narrow slot. */
export function phaseKicker(view: QuipgameView, short = false): string {
  switch (view.phase) {
    case 'writing':
      if (short) return view.multiplier > 1 ? 'Write — double points' : 'Write your answers';
      return view.multiplier > 1 ? 'Write — double points!' : 'Write your answers';
    case 'finalWriting':
      return short ? 'One answer each' : 'Final round — one answer';
    case 'voting':
      return short ? 'Vote!' : 'Vote for the funnier one';
    case 'finalVoting':
      return short ? 'Rank them' : 'Rank your favourites';
    case 'result':
      return short ? 'The votes are in' : 'And the votes say…';
    case 'finalResult':
      return 'The final ranking';
  }
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

export function medalFor(rank: number): string {
  return MEDALS[rank - 1] ?? '';
}
