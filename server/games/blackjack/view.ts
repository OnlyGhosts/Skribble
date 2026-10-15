/** Per-recipient projection of BlackjackData: everything is public but the dealer's hole card until the dealer acts. */
import { handTotal, isNatural } from '../../../shared/games/blackjack/cards.js';
import type { BlackjackPlayerView, BlackjackSettings, BlackjackView, Card, DealerView, HandView, LastRoundView, SettledHandView } from '../../../shared/games/blackjack/protocol.js';
import type { GameViewCtx } from '../../platform/game.js';
import { actionsFor, shoeSizeOf, type BlackjackData, type HandData, type LastRoundData, type SettledHand } from './state.js';

function handView(hand: HandData): HandView {
  const { total, soft } = handTotal(hand.cards);
  return { cards: [...hand.cards], total, soft, bet: hand.bet, status: hand.status, doubled: hand.doubled, fromSplit: hand.fromSplit, splitAces: hand.splitAces };
}

function settledView(hand: SettledHand): SettledHandView {
  return { ...handView(hand), outcome: hand.outcome, payout: hand.payout };
}

function dealerView(cards: Card[], holeHidden: boolean): DealerView {
  const shown = holeHidden ? cards.slice(0, 1) : [...cards];
  const { total, soft } = handTotal(shown);
  return { cards: shown, holeHidden, total, soft, blackjack: !holeHidden && isNatural(cards) };
}

function lastRoundView(last: LastRoundData, present: ReadonlySet<string>): LastRoundView {
  const hands: Record<string, SettledHandView[]> = {};
  for (const id of last.order) if (present.has(id)) hands[id] = last.hands[id].map(settledView);
  return {
    round: last.round,
    order: last.order.filter((id) => present.has(id)),
    dealer: dealerView(last.dealer, false),
    hands,
    peeked: last.peeked,
    revealEndsAt: last.revealEndsAt,
  };
}

export function viewFor(data: BlackjackData, viewerId: string | null, ctx: GameViewCtx<BlackjackSettings>): BlackjackView {
  const { phase } = data;
  const players: Record<string, BlackjackPlayerView> = {};
  for (const p of ctx.players) {
    const seat = data.seats[p.id];
    players[p.id] = seat
      ? { chips: seat.chips, bet: seat.bet, hands: seat.hands.map(handView), inRound: data.order.includes(p.id), bustedOut: seat.bustedOut }
      : { chips: 0, bet: 0, hands: [], inRound: false, bustedOut: false };
  }
  return {
    phase: phase.kind,
    round: data.round,
    order: [...data.order],
    turn: phase.kind === 'acting' ? { playerId: phase.playerId, handIndex: phase.handIndex } : null,
    endsAt: phase.kind === 'betting' || phase.kind === 'acting' || phase.kind === 'ending' ? phase.endsAt : null,
    dealer: dealerView(data.dealer, data.holeHidden),
    players,
    actions: actionsFor(data, ctx.settings, viewerId ?? ''),
    lastRound: data.lastRound ? lastRoundView(data.lastRound, new Set(ctx.players.map((p) => p.id))) : null,
    endRequested: data.endRequested,
    shoeRemaining: data.shoe.length,
    shoeSize: shoeSizeOf(data, ctx.settings),
    reshuffled: data.reshuffled,
  };
}
