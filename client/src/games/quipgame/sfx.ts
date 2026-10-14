/** When Quip Game's reveal sounds play: a drumroll as a result comes up, then applause for a flawless or lopsided win. */
import type { QuipgameView } from '@shared/games/quipgame/protocol';
import { createSoundSchedule } from '../../platform/lib/sound';
import { quipgameSounds as sfx } from './sounds';

/** The drumroll lands on its accent about here. */
export const DRUMROLL_MS = 950;
/** A win by this many votes or more gets applause too. */
export const BIG_WIN_MARGIN = 3;

const schedule = createSoundSchedule();

export function clearQuipgameSounds(): void {
  schedule.clear();
}

/** A matchup worth applause: someone took every vote, or won by a mile. The final always is. */
export function bigWin(view: QuipgameView): boolean {
  if (view.phase === 'finalResult') return true;
  const r = view.result;
  if (!r || r.outcome === 'tie' || r.outcome === 'noVotes') return false;
  return r.a.flawless || r.b.flawless || Math.abs(r.a.votes - r.b.votes) >= BIG_WIN_MARGIN;
}

export function playRevealSounds(view: QuipgameView): void {
  sfx.play('reveal');
  if (bigWin(view)) schedule.at(Date.now() + DRUMROLL_MS, () => sfx.play('applause'));
}
