/**
 * When Poker's sounds play: cards and chips in step with the table's animation (the hole cards,
 * the board, every bet and the pot going to its winners), a knock for a check, a toss for a fold,
 * and a sting on the winner's phone. Other seats' moments play quieter.
 */
import type { PokerView } from '@shared/games/poker/protocol';
import { ONLOOKER_VOLUME, createSoundSchedule } from '../../platform/lib/sound';
import { scheduleTimelineSounds } from '../../platform/table/sounds';
import { OUTCOMES } from '../../platform/table/timeline';
import { POT_ANCHOR, type Timeline } from './lib/timeline';
import { pokerSounds as sfx } from './sounds';

const schedule = createSoundSchedule();

export function clearPokerSounds(): void {
  schedule.clear();
}

export interface PokerMoment {
  view: PokerView;
  prevView: PokerView;
  before: Timeline;
  timeline: Timeline;
  me: string | null;
}

const SEAT = 'seat:';

export function playPokerSounds({ view, prevView, before, timeline, me }: PokerMoment): void {
  const level = (id: string | null) => (id !== null && id === me ? 1 : ONLOOKER_VOLUME);
  const move = view.lastMove;
  const newMove = move !== null && move.seq !== prevView.lastMove?.seq ? move : null;
  if (newMove?.kind === 'check') sfx.play('check', { volume: level(newMove.playerId) });
  if (newMove?.kind === 'fold') sfx.play('fold', { volume: level(newMove.playerId) });

  scheduleTimelineSounds(schedule, before, timeline, {
    // Hole cards are keyed "h/<player>/<n>", the board "b/<n>".
    arrival: (key) => (key.startsWith('b/') ? sfx.play('board') : sfx.play('deal', { volume: level(key.split('/')[1] ?? null) })),
    flip: (key) => {
      if (key.startsWith('h/')) sfx.play('flip', { volume: ONLOOKER_VOLUME });
    },
    flight: (f) => {
      if (f.from === POT_ANCHOR) {
        sfx.play('collect', { volume: level(f.to.slice(SEAT.length)) });
        return;
      }
      if (f.to === POT_ANCHOR) {
        sfx.play('chips', { volume: 0.5 * ONLOOKER_VOLUME });
        return;
      }
      const id = f.from.slice(SEAT.length);
      const allIn = newMove?.kind === 'allIn' && newMove.playerId === id;
      sfx.play(allIn ? 'allIn' : 'chips', { volume: level(id) });
    },
  });

  const at = timeline.marks[OUTCOMES];
  if (me !== null && view.results && at !== undefined && at !== before.marks[OUTCOMES] && (view.results.net[me] ?? 0) > 0) {
    schedule.at(at, () => sfx.play('win'));
  }
}
