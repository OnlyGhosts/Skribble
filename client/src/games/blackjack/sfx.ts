/**
 * When Blackjack's sounds play: the cards and the hole card in step with the table's animation,
 * chips as bets go down, a reshuffle, and the viewer's own moments (a natural, a bust, the
 * settle). Other seats' moments play quieter.
 */
import type { BlackjackView } from '@shared/games/blackjack/protocol';
import { ONLOOKER_VOLUME, createSoundSchedule } from '../../platform/lib/sound';
import { scheduleTimelineSounds } from '../../platform/table/sounds';
import { cardKey, type TableHand, type TableModel } from './lib/table';
import { DEAL_MS, outcomesAt, type Timeline } from './lib/timeline';
import { blackjackSounds as sfx } from './sounds';

const schedule = createSoundSchedule();

export function clearBlackjackSounds(): void {
  schedule.clear();
}

export interface BlackjackMoment {
  view: BlackjackView;
  prevView: BlackjackView;
  table: TableModel | null;
  prevTable: TableModel | null;
  before: Timeline;
  timeline: Timeline;
  me: string | null;
}

/** Everything a seat has on the table: the stake, plus doubles and splits. */
function staked(view: BlackjackView, id: string): number {
  const p = view.players[id];
  if (!p) return 0;
  return Math.max(p.bet, p.hands.reduce((sum, h) => sum + h.bet, 0));
}

/** When the hand's newest card lands. */
function landedAt(timeline: Timeline, me: string, index: number, hand: TableHand): number {
  const last = hand.cards.length - 1;
  const at = last >= 0 ? timeline.arrivals[cardKey(me, index, last, hand.cards[last])] : undefined;
  return at === undefined ? Date.now() : at + DEAL_MS;
}

export function playBlackjackSounds({ view, prevView, table, prevTable, before, timeline, me }: BlackjackMoment): void {
  const sameRound = prevView.round === view.round;
  if (view.reshuffled && (!prevView.reshuffled || !sameRound)) sfx.play('shuffle');
  for (const id of Object.keys(view.players)) {
    if (staked(view, id) > (sameRound ? staked(prevView, id) : 0)) sfx.play('bet', { volume: id === me ? 1 : ONLOOKER_VOLUME });
  }

  scheduleTimelineSounds(schedule, before, timeline, {
    // Seat cards are keyed "<player>/..."; the dealer's are "d<n>".
    arrival: (key) => sfx.play('deal', { volume: key.startsWith(`${me}/`) ? 1 : key.includes('/') ? ONLOOKER_VOLUME : 0.8 }),
    flip: () => sfx.play('flip'),
  });

  if (me === null || !table) return;
  const mine = table.hands[me] ?? [];
  const sameTable = prevTable !== null && prevTable.round === table.round;
  mine.forEach((hand, i) => {
    const was = sameTable ? prevTable.hands[me]?.[i]?.status : undefined;
    if (hand.status === was) return;
    if (hand.status === 'bust') schedule.at(landedAt(timeline, me, i, hand), () => sfx.play('bust'));
    if (hand.status === 'blackjack') schedule.at(landedAt(timeline, me, i, hand), () => sfx.play('blackjack'));
  });

  const at = outcomesAt(timeline);
  if (table.settled && mine.length > 0 && at !== null && at !== outcomesAt(before)) {
    const net = mine.reduce((sum, h) => sum + (h.payout ?? 0) - h.bet, 0);
    if (net > 0) schedule.at(at, () => sfx.play('collect'));
    else if (net === 0 && mine.some((h) => h.outcome === 'push')) schedule.at(at, () => sfx.play('push'));
  }
}
