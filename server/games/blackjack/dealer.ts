/** The play passing from hand to hand, the dealer's turn and the settle that sends the table to `lastRound`. */
import { dealerShouldHit, handTotal, revealAllowanceMs, settleHand } from '../../../shared/games/blackjack/cards.js';
import type { HandOutcome, HandStatus } from '../../../shared/games/blackjack/protocol.js';
import { afterSettle } from './round.js';
import { adjustChips, autoStatus, draw, isConnected, nameOf, noticeMessage, snapshot, systemMessage, type Gx, type SettledHand } from './state.js';

export function awayLine(gx: Gx, playerId: string): string {
  return `${nameOf(gx.ctx, playerId)} is away and stands.`;
}

/**
 * Hands the play to the next hand waiting, one at a time like a table: seats in order, each seat's
 * hands left to right. A hand that needs no decision is settled on the way, and so is the hand of
 * a player who is away (it stands, said once a player in `away`); none left means the dealer.
 * There is no clock: the player in play acts when ready.
 */
export function nextHand(gx: Gx, away: Set<string> = new Set()): void {
  const { data, ctx } = gx;
  for (const id of data.order) {
    const seat = data.seats[id];
    for (let index = 0; index < seat.hands.length; index++) {
      const hand = seat.hands[index];
      if (hand.status !== 'waiting') continue;
      const auto = autoStatus(seat, hand);
      if (auto) {
        hand.status = auto;
        continue;
      }
      if (!isConnected(ctx, id)) {
        hand.status = 'stood';
        if (!away.has(id)) noticeMessage(gx, awayLine(gx, id));
        away.add(id);
        continue;
      }
      hand.status = 'acting';
      data.phase = { kind: 'acting', playerId: id, handIndex: index };
      return snapshot(gx);
    }
  }
  dealerPlays(gx);
}

/** The hole card shows; the dealer draws only while a standing hand is waiting on the outcome. */
function dealerPlays(gx: Gx): void {
  const { data } = gx;
  data.holeHidden = false;
  const standing = data.order.some((id) => data.seats[id].hands.some((h) => h.status === 'stood'));
  if (standing) {
    while (dealerShouldHit(data.dealer)) data.dealer.push(draw(gx));
  }
  const house = handTotal(data.dealer).total;
  systemMessage(gx, house > 21 ? `The dealer busts with ${house}.` : `The dealer ${standing ? 'stands on' : 'shows'} ${house}.`);
  settleRound(gx, false);
}

const STATUS_OF: Record<HandOutcome, HandStatus> = { win: 'won', blackjack: 'blackjack', push: 'push', loss: 'lost' };

/**
 * Pays every hand against the dealer's cards, puts out whoever has no chips left, moves the
 * table to `lastRound` (cleared from the seats) and goes on to the next round or the end.
 */
export function settleRound(gx: Gx, peeked: boolean): void {
  const { data, ctx } = gx;
  const lines: string[] = [];
  const out: string[] = [];
  const settled: Record<string, SettledHand[]> = {};
  for (const id of data.order) {
    const seat = data.seats[id];
    settled[id] = seat.hands.map((hand) => {
      const { outcome, payout } = settleHand(hand.cards, hand.bet, hand.fromSplit, data.dealer);
      adjustChips(gx, id, payout);
      return { ...hand, cards: [...hand.cards], status: hand.status === 'bust' ? 'bust' : STATUS_OF[outcome], outcome, payout };
    });
    const staked = settled[id].reduce((sum, h) => sum + h.bet, 0);
    const back = settled[id].reduce((sum, h) => sum + h.payout, 0);
    const name = nameOf(ctx, id);
    lines.push(back > staked ? `${name} wins ${back - staked}` : back === staked ? `${name} pushes` : `${name} loses ${staked - back}`);
    if (seat.chips === 0) {
      seat.bustedOut = true;
      out.push(id);
    }
    seat.hands = [];
    seat.bet = 0;
  }
  if (lines.length > 0) systemMessage(gx, `${lines.join(', ')}.`);
  for (const id of out) systemMessage(gx, `${nameOf(ctx, id)} is out of chips.`);
  const reveal = revealAllowanceMs(data.dealer.length);
  data.lastRound = { round: data.round, order: [...data.order], dealer: data.dealer, hands: settled, peeked, revealEndsAt: ctx.now + reveal };
  data.order = [];
  data.dealer = [];
  data.holeHidden = true;
  afterSettle(gx, reveal);
}
