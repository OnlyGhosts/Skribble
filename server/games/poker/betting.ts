/** The acting player's moves: fold, check, call, bet, raise, all in, and the clock running out. */
import type { PokerActionKind, PokerActions, PokerClientMessage } from '../../../shared/games/poker/protocol.js';
import { adjustChips, bigBlind, contenders, fail, nameOf, ringAfter, snapshot, streetIdle, systemMessage, turnOf, type Gx, type PokerData } from './state.js';
import { endStreet } from './streets.js';

/** A move the player sent themselves (the clock's moves go through actTimedOut). */
export function playerMove(gx: Gx, playerId: string, msg: Extract<PokerClientMessage, { t: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn' }>): void {
  if (turnOf(gx.data) === playerId) gx.data.acted = true;
  switch (msg.t) {
    case 'fold':
      return fold(gx, playerId);
    case 'check':
      return check(gx, playerId);
    case 'call':
      return call(gx, playerId);
    case 'bet':
      return bet(gx, playerId, msg.amount);
    case 'raise':
      return raise(gx, playerId, msg.to);
    case 'allIn':
      return allIn(gx, playerId);
  }
}

const NONE: PokerActions = { canFold: false, canCheck: false, canCall: false, callAmount: 0, canBet: false, minBet: 0, maxBet: 0, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0, canAllIn: false };

/**
 * A seat may raise when it has not answered a bet on this street yet, or the bet has gone up by
 * at least a full raise since it did (short all-ins add up).
 */
function mayRaise(data: PokerData, playerId: string): boolean {
  const answered = data.answered[playerId];
  return answered === undefined || data.highest - answered >= data.minRaise;
}

/** What `playerId` may do right now: everything false unless it is their turn. */
export function actionsFor(data: PokerData, playerId: string): PokerActions {
  const seat = data.seats[playerId];
  if (!seat || turnOf(data) !== playerId || seat.status !== 'in') return NONE;
  const toCall = Math.max(0, data.highest - seat.bet);
  const callAmount = Math.min(toCall, seat.chips);
  const stack = seat.bet + seat.chips;
  const raiseOpen = mayRaise(data, playerId);
  return {
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount,
    canBet: data.highest === 0,
    minBet: Math.min(bigBlind(data), seat.chips),
    maxBet: seat.chips,
    canRaise: data.highest > 0 && seat.chips > toCall && raiseOpen,
    minRaiseTo: Math.min(data.highest + data.minRaise, stack),
    maxRaiseTo: stack,
    // Facing a short all in after acting, going all in for more than the call would be a raise.
    canAllIn: seat.chips > 0 && (raiseOpen || seat.chips <= toCall),
  };
}

/** Moves `amount` chips from the stack to the street's bet; an emptied stack is all in. */
function put(gx: Gx, playerId: string, amount: number): void {
  const seat = gx.data.seats[playerId];
  adjustChips(gx, playerId, -amount);
  seat.bet += amount;
  if (seat.chips === 0) seat.status = 'allIn';
}

function record(gx: Gx, playerId: string, kind: PokerActionKind, amount: number): void {
  gx.data.seats[playerId].lastAction = { kind, amount };
  if (kind !== 'fold') gx.data.answered[playerId] = gx.data.highest;
}

/** The player acted without raising: they leave the queue. */
function passTurn(gx: Gx): void {
  gx.data.toAct.shift();
}

/**
 * A bet or raise reopens the action: every other seat still able to act must answer, in order
 * from the raiser. Whether they may raise again depends on `answered` (see mayRaise).
 */
function reopen(gx: Gx, playerId: string): void {
  const { data } = gx;
  data.toAct = ringAfter(data, data.order.indexOf(playerId)).filter((id) => id !== playerId && data.seats[id].status === 'in');
}

/**
 * After a move: the hand is over when one player is left, the street when nobody is left to bet
 * against, otherwise the next player's clock.
 */
export function afterAction(gx: Gx): void {
  const { data, ctx } = gx;
  if (contenders(data).length <= 1 || streetIdle(data)) return endStreet(gx);
  data.phase = { kind: 'acting', endsAt: ctx.now + ctx.settings.actSeconds * 1000 };
  snapshot(gx);
}

export function fold(gx: Gx, playerId: string): void {
  if (!actionsFor(gx.data, playerId).canFold) return fail(gx, playerId, 'It is not your turn.');
  gx.data.seats[playerId].status = 'folded';
  record(gx, playerId, 'fold', 0);
  passTurn(gx);
  afterAction(gx);
}

export function check(gx: Gx, playerId: string): void {
  const actions = actionsFor(gx.data, playerId);
  if (!actions.canFold) return fail(gx, playerId, 'It is not your turn.');
  if (!actions.canCheck) return fail(gx, playerId, `You cannot check: ${actions.callAmount} to call.`);
  record(gx, playerId, 'check', 0);
  passTurn(gx);
  afterAction(gx);
}

export function call(gx: Gx, playerId: string): void {
  const actions = actionsFor(gx.data, playerId);
  if (!actions.canFold) return fail(gx, playerId, 'It is not your turn.');
  if (!actions.canCall) return fail(gx, playerId, 'There is nothing to call.');
  put(gx, playerId, actions.callAmount);
  const seat = gx.data.seats[playerId];
  record(gx, playerId, seat.status === 'allIn' ? 'allIn' : 'call', seat.bet);
  if (seat.status === 'allIn') systemMessage(gx, `${nameOf(gx.ctx, playerId)} calls all in for ${seat.bet}.`);
  passTurn(gx);
  afterAction(gx);
}

export function bet(gx: Gx, playerId: string, amount: number): void {
  const actions = actionsFor(gx.data, playerId);
  if (!actions.canFold) return fail(gx, playerId, 'It is not your turn.');
  if (!actions.canBet) return fail(gx, playerId, 'There is a bet already: raise instead.');
  if (amount < actions.minBet || amount > actions.maxBet) return fail(gx, playerId, `Bet between ${actions.minBet} and ${actions.maxBet} chips.`);
  open(gx, playerId, amount, 'bet');
}

/** Raises the street's bet to `to` in total; a full raise (at least the last one) sets the new minimum. */
export function raise(gx: Gx, playerId: string, to: number): void {
  const actions = actionsFor(gx.data, playerId);
  if (!actions.canFold) return fail(gx, playerId, 'It is not your turn.');
  if (!actions.canRaise) return fail(gx, playerId, gx.data.highest === 0 ? 'There is no bet to raise: bet instead.' : 'You cannot raise: you can only call or fold.');
  if (to < actions.minRaiseTo || to > actions.maxRaiseTo) return fail(gx, playerId, `Raise to between ${actions.minRaiseTo} and ${actions.maxRaiseTo} chips.`);
  open(gx, playerId, to, 'raise');
}

/** Everything in: a bet when nobody has bet, a call when it does not cover the bet, a raise otherwise. */
export function allIn(gx: Gx, playerId: string): void {
  const actions = actionsFor(gx.data, playerId);
  if (!actions.canFold) return fail(gx, playerId, 'It is not your turn.');
  if (!actions.canAllIn) return fail(gx, playerId, gx.data.seats[playerId].chips > 0 ? 'You cannot raise: you can only call or fold.' : 'You have no chips left.');
  const seat = gx.data.seats[playerId];
  const total = seat.bet + seat.chips;
  if (total <= gx.data.highest) return call(gx, playerId);
  open(gx, playerId, total, 'allIn');
}

/** A bet, raise or all in to `total` on this street. */
function open(gx: Gx, playerId: string, total: number, kind: PokerActionKind): void {
  const { data, ctx } = gx;
  const seat = data.seats[playerId];
  const size = total - data.highest;
  put(gx, playerId, total - seat.bet);
  if (size >= data.minRaise) data.minRaise = size;
  data.highest = total;
  record(gx, playerId, seat.status === 'allIn' ? 'allIn' : kind, total);
  const name = nameOf(ctx, playerId);
  if (seat.status === 'allIn') systemMessage(gx, `${name} is all in for ${total}!`);
  else systemMessage(gx, kind === 'bet' ? `${name} bets ${total}.` : `${name} raises to ${total}.`);
  reopen(gx, playerId);
  afterAction(gx);
}

/** The clock ran out: a check when it is free, a fold otherwise. */
export function actTimedOut(gx: Gx): void {
  const turn = turnOf(gx.data);
  if (turn === null) return;
  const actions = actionsFor(gx.data, turn);
  systemMessage(gx, `${nameOf(gx.ctx, turn)} ran out of time — ${actions.canCheck ? 'checks' : 'folds'}.`);
  if (actions.canCheck) check(gx, turn);
  else fold(gx, turn);
}

/** A seat whose player left mid-hand: folded, its chips left in the pot, the action moving on. */
export function foldGone(gx: Gx, playerId: string): void {
  const { data } = gx;
  const seat = data.seats[playerId];
  if (!seat || !data.order.includes(playerId) || data.phase.kind !== 'acting') return;
  const wasTurn = turnOf(data) === playerId;
  seat.gone = true;
  if (seat.status === 'in' || seat.status === 'allIn') seat.status = 'folded';
  data.toAct = data.toAct.filter((id) => id !== playerId);
  if (wasTurn || contenders(data).length <= 1 || data.toAct.length === 0) return afterAction(gx);
  snapshot(gx);
}
