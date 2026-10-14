/** The end of a hand: the showdown with its side pots and payouts, the uncontested pot, and the results phase. */
import { compareHands, evaluateBest, handName, type HandRank } from '../../../shared/games/poker/hands.js';
import type { PokerPotResult, PokerRevealedHand } from '../../../shared/games/poker/protocol.js';
import { settleRevealMs } from '../../../shared/games/poker/reveal.js';
import { buildPots, splitPot } from './pots.js';
import { adjustChips, contenders, nameOf, ringAfter, snapshot, systemMessage, type Gx } from './state.js';

/** The bets of the current street join the pots. */
function collectBets(gx: Gx): void {
  for (const id of gx.data.order) {
    const seat = gx.data.seats[id];
    seat.committed += seat.bet;
    seat.bet = 0;
  }
}

/** Winners in payout order: the first eligible player left of the dealer takes the odd chip. */
function payoutOrder(gx: Gx, ids: readonly string[]): string[] {
  const { data } = gx;
  const dealerIndex = data.dealerId === null ? -1 : data.order.indexOf(data.dealerId);
  return ringAfter(data, dealerIndex).filter((id) => ids.includes(id));
}

/** Pays the pots out, builds the results and opens the results phase; `committed` is spent. */
function settle(gx: Gx, pots: PokerPotResult[], revealed: Record<string, PokerRevealedHand>, uncontested: boolean): void {
  const { data } = gx;
  const net: Record<string, number> = {};
  for (const id of data.order) net[id] = 0 - data.seats[id].committed || 0;
  for (const pot of pots) {
    for (const w of pot.winners) {
      adjustChips(gx, w.playerId, w.amount);
      net[w.playerId] = (net[w.playerId] ?? 0) + w.amount;
    }
  }
  for (const id of data.order) data.seats[id].committed = 0;
  data.results = { pots, revealed, uncontested, net };
  data.toAct = [];
  data.idleHands = data.acted ? 0 : data.idleHands + 1;
  const busted = data.order.filter((id) => data.seats[id].chips === 0 && !data.seats[id].gone);
  for (const id of busted) systemMessage(gx, `${nameOf(gx.ctx, id)} is out of chips.`);
  // The pause starts once the clients have shown the end of the hand (a run-out deals the rest of the board first).
  const newHand = gx.shown.hand !== data.hand;
  const reveal = settleRevealMs({
    holeCards: newHand ? data.order.reduce((n, id) => n + data.seats[id].cards.length, 0) : 0,
    boardFrom: newHand ? 0 : gx.shown.board,
    boardTo: data.community.length,
    contested: !uncontested,
  });
  data.phase = { kind: 'results', endsAt: gx.ctx.now + reveal + gx.ctx.settings.resultsSeconds * 1000, held: false, resumeAt: null };
  snapshot(gx);
}

/** Everyone else folded: the last player holding cards takes everything, cards unseen. */
export function awardUncontested(gx: Gx): void {
  const { data, ctx } = gx;
  collectBets(gx);
  const [winner] = contenders(data);
  const amount = data.order.reduce((sum, id) => sum + data.seats[id].committed, 0);
  systemMessage(gx, `${nameOf(ctx, winner)} takes the pot (${amount}).`);
  settle(gx, [{ amount, winners: [{ playerId: winner, amount }], handName: null }], {}, true);
}

/** Every contender shows; each pot goes to the best five of seven among those eligible for it. */
export function showdown(gx: Gx): void {
  const { data, ctx } = gx;
  collectBets(gx);
  const hands: Record<string, HandRank> = {};
  const revealed: Record<string, PokerRevealedHand> = {};
  for (const id of contenders(data)) {
    const seat = data.seats[id];
    const hand = evaluateBest([...seat.cards, ...data.community]);
    hands[id] = hand;
    revealed[id] = { cards: [...seat.cards], category: hand.category, name: handName(hand), best: [...hand.cards] };
  }
  const pots = buildPots(data.order.map((id) => ({ id, committed: data.seats[id].committed, contender: id in hands })));
  const results: PokerPotResult[] = pots.map((pot) => {
    let best: string[] = [];
    for (const id of pot.eligible) {
      const cmp = best.length === 0 ? 1 : compareHands(hands[id], hands[best[0]]);
      if (cmp > 0) best = [id];
      else if (cmp === 0) best.push(id);
    }
    const winners = payoutOrder(gx, best);
    return { amount: pot.amount, winners: splitPot(pot.amount, winners), handName: handName(hands[winners[0]]) };
  });
  results.forEach((pot, i) => {
    const label = results.length > 1 ? (i === 0 ? 'the main pot' : `side pot ${i}`) : 'the pot';
    if (pot.winners.length === 1) systemMessage(gx, `${nameOf(ctx, pot.winners[0].playerId)} wins ${label} (${pot.amount}) with ${pot.handName?.toLowerCase()}.`);
    else systemMessage(gx, `${pot.winners.map((w) => nameOf(ctx, w.playerId)).join(' and ')} split ${label} (${pot.amount}) with ${pot.handName?.toLowerCase()}.`);
  });
  settle(gx, results, revealed, false);
}
