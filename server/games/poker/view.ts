/** Per-recipient projection of PokerData: the board and every stack are public, hole cards only reach their owner until a showdown reveals them. */
import type { PokerPlayerView, PokerPotView, PokerSeatStatus, PokerSettings, PokerView } from '../../../shared/games/poker/protocol.js';
import type { GameViewCtx } from '../../platform/game.js';
import { actionsFor } from './betting.js';
import { buildPots } from './pots.js';
import { bigBlind, potTotal, turnOf, type PokerData, type SeatData } from './state.js';

function statusOf(seat: SeatData, isTurn: boolean): PokerSeatStatus {
  switch (seat.status) {
    case 'in':
      return isTurn ? 'acting' : 'waiting';
    case 'folded':
    case 'allIn':
    case 'out':
      return seat.status;
  }
}

/** The pots settled so far (the current street's bets join them when it closes). */
function potsOf(data: PokerData): PokerPotView[] {
  const entries = data.order.flatMap((id) => {
    const seat = data.seats[id];
    return seat ? [{ id, committed: seat.committed, contender: seat.status === 'in' || seat.status === 'allIn' }] : [];
  });
  return buildPots(entries).map((pot) => ({ amount: pot.amount, playerIds: pot.eligible }));
}

export function viewFor(data: PokerData, viewerId: string | null, ctx: GameViewCtx<PokerSettings>): PokerView {
  const turn = turnOf(data);
  const players: Record<string, PokerPlayerView> = {};
  for (const p of ctx.players) {
    const seat = data.seats[p.id];
    players[p.id] = seat
      ? {
          chips: seat.chips,
          bet: seat.bet,
          committed: seat.committed + seat.bet,
          status: statusOf(seat, turn === p.id),
          isDealer: data.dealerId === p.id,
          isTurn: turn === p.id,
          lastAction: seat.lastAction ? { ...seat.lastAction } : null,
          busted: seat.chips === 0 && seat.bet + seat.committed === 0,
        }
      : { chips: 0, bet: 0, committed: 0, status: 'out', isDealer: false, isTurn: false, lastAction: null, busted: false };
  }
  const mine = viewerId === null ? undefined : data.seats[viewerId];
  return {
    phase: data.phase.kind,
    street: data.street,
    hand: data.hand,
    totalHands: ctx.settings.hands,
    blinds: { small: data.smallBlind, big: bigBlind(data) },
    dealerId: data.dealerId !== null && ctx.players.some((p) => p.id === data.dealerId) ? data.dealerId : null,
    community: data.community.map((c) => ({ ...c })),
    pot: potTotal(data),
    pots: potsOf(data),
    order: [...data.order],
    turn,
    endsAt: endsAtOf(data),
    paused: data.phase.kind === 'results' && data.phase.held,
    players,
    myCards: mine && !mine.gone ? mine.cards.map((c) => ({ ...c })) : [],
    actions: actionsFor(data, viewerId ?? ''),
    results: data.results ? structuredClone(data.results) : null,
  };
}

function endsAtOf(data: PokerData): number | null {
  switch (data.phase.kind) {
    case 'acting':
      return data.phase.endsAt;
    case 'results':
      return data.phase.held ? null : data.phase.endsAt;
    case 'gameOver':
      return null;
  }
}
