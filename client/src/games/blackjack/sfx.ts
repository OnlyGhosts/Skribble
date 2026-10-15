/**
 * When Blackjack's sounds play. Every card that moves makes a sound timed to its animation: each
 * card dealt, hit or doubled as it slides in, the half of a split as it slides to its new hand, the
 * dealer's draws, the hole card turning over, and a soft swoosh as the last round goes to the
 * discards. Chips as bets go down, a reshuffle, the viewer's own bust and settle, and the blackjack
 * sting: full on the viewer's own natural, quieter on someone else's, at most one per deal.
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

/** When the hand's newest card has landed. */
function landedAt(timeline: Timeline, playerId: string, index: number, hand: TableHand): number {
  const last = hand.cards.length - 1;
  const at = last >= 0 ? timeline.arrivals[cardKey(playerId, index, last, hand.cards[last])] : undefined;
  return at === undefined ? Date.now() : at + DEAL_MS;
}

/** The level for a card landing: mine in full, the dealer's a little under, other seats at half. */
function cardVolume(key: string, me: string | null): number {
  if (me !== null && key.startsWith(`${me}/`)) return 1;
  return key.includes('/') ? ONLOOKER_VOLUME : 0.8;
}

/** Hands whose status just became `status`, seat by seat in play order. */
function newlyStatus(table: TableModel, prevTable: TableModel | null, status: TableHand['status']): { playerId: string; index: number; hand: TableHand }[] {
  const sameTable = prevTable !== null && prevTable.round === table.round;
  const out: { playerId: string; index: number; hand: TableHand }[] = [];
  for (const playerId of table.order) {
    (table.hands[playerId] ?? []).forEach((hand, index) => {
      const was = sameTable ? prevTable.hands[playerId]?.[index]?.status : undefined;
      if (hand.status === status && was !== status) out.push({ playerId, index, hand });
    });
  }
  return out;
}

export function playBlackjackSounds({ view, prevView, table, prevTable, before, timeline, me }: BlackjackMoment): void {
  const sameRound = prevView.round === view.round;
  if (view.reshuffled && (!prevView.reshuffled || !sameRound)) sfx.play('shuffle');
  // One chip sound a snapshot, however many stakes went down in it: mine in full, otherwise softer.
  const grew = Object.keys(view.players).filter((id) => staked(view, id) > (sameRound ? staked(prevView, id) : 0));
  if (grew.length > 0) sfx.play('bet', { volume: me !== null && grew.includes(me) ? 1 : ONLOOKER_VOLUME });

  if (timeline !== before && timeline.discard && timeline.discard !== before.discard) schedule.at(timeline.discard.from, () => sfx.play('sweep'));
  scheduleTimelineSounds(schedule, before, timeline, {
    arrival: (key) => sfx.play(timeline.moved[key] ? 'slide' : 'deal', { volume: cardVolume(key, me) }),
    flip: () => sfx.play('flip'),
  });

  if (!table) return;
  const naturals = newlyStatus(table, prevTable, 'blackjack');
  const natural = naturals.find((n) => n.playerId === me) ?? naturals[0];
  if (natural) schedule.at(landedAt(timeline, natural.playerId, natural.index, natural.hand), () => sfx.play('blackjack', { volume: natural.playerId === me ? 1 : ONLOOKER_VOLUME }));

  if (me === null) return;
  for (const bust of newlyStatus(table, prevTable, 'bust')) {
    if (bust.playerId === me) schedule.at(landedAt(timeline, me, bust.index, bust.hand), () => sfx.play('bust'));
  }

  const mine = table.hands[me] ?? [];
  const at = outcomesAt(timeline);
  if (table.settled && mine.length > 0 && at !== null && at !== outcomesAt(before)) {
    const net = mine.reduce((sum, h) => sum + (h.payout ?? 0) - h.bet, 0);
    if (net > 0) schedule.at(at, () => sfx.play('collect'));
    else if (net === 0 && mine.some((h) => h.outcome === 'push')) schedule.at(at, () => sfx.play('push'));
  }
}
