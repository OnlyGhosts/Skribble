/**
 * When Poker's sounds play. Every card that moves makes a sound timed to its animation: each hole
 * card as it slides to its seat, each board card (the flop's three, the turn, the river) as it
 * slides out and once as it turns over, a toss as a folded hand goes to the muck (at once for my
 * own, which stays in front of me), one flip as the hands turn over at a showdown, and a soft
 * swoosh as the last hand clears before the next deal. Chips as bets slide out and the pot goes
 * to its winners, a knock for a check and a sting on the winner's phone. Other seats' moments
 * play quieter, and cards that move together sound once.
 */
import type { PokerView } from '@shared/games/poker/protocol';
import { ONLOOKER_VOLUME, createSoundSchedule } from '../../platform/lib/sound';
import { scheduleTimelineSounds } from '../../platform/table/sounds';
import { OUTCOMES, type Flight } from '../../platform/table/timeline';
import { POT_ANCHOR, type Timeline } from './lib/timeline';
import { pokerSounds as sfx } from './sounds';

const schedule = createSoundSchedule();

export function clearPokerSounds(): void {
  schedule.clear();
}

export interface PokerMoment {
  view: PokerView;
  /** Null for the snapshot that starts the game. */
  prevView: PokerView | null;
  before: Timeline;
  timeline: Timeline;
  me: string | null;
}

const SEAT = 'seat:';

/** Chips going in front of a seat, swept into the pot, or paid out of it. */
function flightKind(f: Flight): 'bet' | 'sweep' | 'pay' {
  if (f.from === POT_ANCHOR) return 'pay';
  return f.to === POT_ANCHOR ? 'sweep' : 'bet';
}

/** The player a hole card ("h/<player>/<n>") belongs to. */
function ownerOf(key: string): string | null {
  return key.startsWith('h/') ? key.slice(2, key.lastIndexOf('/')) : null;
}

export function playPokerSounds({ view, prevView, before, timeline, me }: PokerMoment): void {
  const level = (id: string | null) => (id !== null && id === me ? 1 : ONLOOKER_VOLUME);
  const move = view.lastMove;
  const newMove = move !== null && move.seq !== prevView?.lastMove?.seq ? move : null;
  if (newMove?.kind === 'check') sfx.play('check', { volume: level(newMove.playerId) });
  // My folded cards stay in front of me, so my fold sounds at once; the others' when their cards leave.
  if (newMove?.kind === 'fold' && newMove.playerId === me) sfx.play('fold');

  if (timeline !== before && timeline.discard && timeline.discard !== before.discard) schedule.at(timeline.discard.from, () => sfx.play('sweep'));
  // Cards or chips that move together (a hand to the muck, the flop turning over, the bets swept in) sound once.
  const together = new Set<string>();
  const once = (moment: string, play: () => void) => {
    if (together.has(moment)) return;
    together.add(moment);
    play();
  };
  const loudest = (ids: (string | null)[]) => (me !== null && ids.includes(me) ? 1 : ONLOOKER_VOLUME);
  scheduleTimelineSounds(schedule, before, timeline, {
    // Hole cards are keyed "h/<player>/<n>", the board "b/<n>".
    arrival: (key) => (key.startsWith('b/') ? sfx.play('board') : sfx.play('deal', { volume: level(ownerOf(key)) })),
    flip: (key) => once(`flip:${timeline.flips[key]}`, () => sfx.play('flip', { volume: key.startsWith('b/') ? 1 : ONLOOKER_VOLUME })),
    departure: (key) => once(`muck:${timeline.departures[key]}`, () => sfx.play('fold', { volume: ONLOOKER_VOLUME })),
    flight: (f) => {
      const kind = flightKind(f);
      const group = timeline.flights.filter((g) => g.at === f.at && flightKind(g) === kind);
      once(`${kind}:${f.at}`, () => {
        if (kind === 'sweep') return sfx.play('chips', { volume: 0.5 * ONLOOKER_VOLUME });
        if (kind === 'pay') return sfx.play('collect', { volume: loudest(group.map((g) => g.to.slice(SEAT.length))) });
        const ids = group.map((g) => g.from.slice(SEAT.length));
        const allIn = newMove?.kind === 'allIn' && ids.includes(newMove.playerId);
        sfx.play(allIn ? 'allIn' : 'chips', { volume: loudest(ids) });
      });
    },
  });

  const at = timeline.marks[OUTCOMES];
  if (me !== null && view.results && at !== undefined && at !== before.marks[OUTCOMES] && (view.results.net[me] ?? 0) > 0) {
    schedule.at(at, () => sfx.play('win'));
  }
}
