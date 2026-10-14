/** Per-recipient projection of BlackjackData: everything is public but the dealer's hole card until the dealer acts. */
import { handTotal, isNatural } from '../../../shared/games/blackjack/cards.js';
import type { BlackjackPlayerView, BlackjackSettings, BlackjackView, HandView } from '../../../shared/games/blackjack/protocol.js';
import type { GameViewCtx } from '../../platform/game.js';
import { actionsFor, type BlackjackData, type HandData } from './state.js';

function handView(hand: HandData): HandView {
  const { total, soft } = handTotal(hand.cards);
  return { cards: [...hand.cards], total, soft, bet: hand.bet, status: hand.status, doubled: hand.doubled, fromSplit: hand.fromSplit };
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
  const shown = data.holeHidden ? data.dealer.slice(0, 1) : [...data.dealer];
  const dealerTotal = handTotal(shown);
  return {
    phase: phase.kind,
    round: data.round,
    totalRounds: ctx.settings.rounds,
    order: [...data.order],
    turn: phase.kind === 'acting' ? { playerId: phase.playerId, handIndex: phase.handIndex } : null,
    endsAt: endsAtOf(data),
    paused: phase.kind === 'results' && phase.held,
    dealer: { cards: shown, holeHidden: data.holeHidden, total: dealerTotal.total, soft: dealerTotal.soft, blackjack: !data.holeHidden && isNatural(data.dealer) },
    players,
    actions: actionsFor(data, ctx.settings, viewerId ?? ''),
    results: data.results.map((r) => ({ ...r })),
    shoeRemaining: data.shoe.length,
    reshuffled: data.reshuffled,
  };
}

function endsAtOf(data: BlackjackData): number | null {
  switch (data.phase.kind) {
    case 'betting':
    case 'acting':
      return data.phase.endsAt;
    case 'results':
      return data.phase.held ? null : data.phase.endsAt;
    case 'gameOver':
      return null;
  }
}
