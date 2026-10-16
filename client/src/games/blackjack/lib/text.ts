import type { BlackjackPhase, BlackjackView, HandOutcome } from '@shared/games/blackjack/protocol';
import { formatChips } from '../../../platform/lib/format';
import { WATCHING_TEXT } from '../../../platform/lib/watching';
import type { PanelStatus, StatusTone } from '../../../platform/table/ControlPanel';
import type { BjFocus } from './focus';

export { formatChips };

/** "Round 4": the rounds never run out. A hold before the first deal reads as round 1. */
export function roundLabel(round: number): string {
  return `Round ${Math.max(1, round)}`;
}

/**
 * The small line under the round in the top bar. While the settled round's reveal still plays on
 * screen (`dealerPlaying`) it is the dealer's turn, whatever the next phase already is.
 */
export function phaseKicker(view: BlackjackView, turnName: string, mine: boolean, dealerPlaying = false): string {
  if (dealerPlaying && view.phase !== 'held') return "Dealer's turn";
  if (view.endRequested && view.phase === 'acting') return 'Last hand';
  switch (view.phase) {
    case 'betting':
      return 'Place your bets';
    case 'acting':
      return mine ? 'Your turn' : `${turnName}'s turn`;
    case 'results':
      return 'Next round soon';
    case 'held':
      return 'Waiting for players';
    case 'ending':
    case 'gameOver':
      return 'Game over';
  }
}

/** "Pia", "Pia and Quinn", "Pia, Quinn and Hana". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Past this many letters, two or three names read as a count: they would be cut on a small phone. */
const WAITING_NAMES_MAX = 20;

/** "Waiting for Pia", "Waiting for Pia and Quinn"; many names, or long ones, as "Waiting for 4 players". */
export function waitingText(names: readonly string[]): string {
  const joined = joinNames(names);
  if (names.length > 3 || (names.length > 1 && joined.length > WAITING_NAMES_MAX)) return `Waiting for ${names.length} players`;
  return `Waiting for ${joined}`;
}

/** The banner across the table (shown in capitals), with the small rule under it: the house rules are fixed. */
export const RIBBON_TEXT = 'Blackjack pays 3 to 2';
export const DEALER_RULE_TEXT = 'Dealer stands on 17';

const OUTCOME_LABELS: Record<HandOutcome, string> = { win: 'Win', blackjack: 'Blackjack', push: 'Push', loss: 'Lost' };

export function outcomeLabel(outcome: HandOutcome): string {
  return OUTCOME_LABELS[outcome];
}

/** The chips a settled hand put back on the balance: "+220". Nothing on a loss. */
export function payoutText(payout: number): string {
  return payout > 0 ? `+${formatChips(payout)}` : '';
}

export const HOTKEY_HINT = 'Space bet · H hit · S stand · D double · P split';

export type PanelState = 'spectating' | 'out' | 'offline' | 'held' | 'over' | 'dealer' | 'results' | 'next-round' | 'sat-out' | 'bet' | 'waiting' | 'dealing' | 'my-turn' | 'their-turn';

const TONES: Record<PanelState, StatusTone> = {
  spectating: 'quiet',
  out: 'bad',
  offline: 'quiet',
  held: 'quiet',
  over: 'quiet',
  dealer: 'other',
  results: 'quiet',
  'next-round': 'quiet',
  'sat-out': 'quiet',
  bet: 'go',
  waiting: 'quiet',
  dealing: 'quiet',
  'my-turn': 'go',
  'their-turn': 'other',
};

export type { PanelStatus };

export interface PanelStatusInput {
  phase: BlackjackPhase;
  seated: boolean;
  bustedOut: boolean;
  connected: boolean;
  inRound: boolean;
  /** A seat with chips: one not dealt in sat the hand out rather than waiting for a seat. */
  hasChips: boolean;
  betPlaced: boolean;
  /** Chose to sit this hand out while the bets are open. */
  sittingOut: boolean;
  /** Names of the seats the deal still waits for, the viewer left out. */
  pending: string[];
  myTurn: boolean;
  turnName: string;
  /** The hand in play and how many the viewer holds, for "Your turn, hand 2 of 3". */
  handIndex: number;
  handCount: number;
  /** The dealer's reveal is still playing on screen. */
  dealerPlaying: boolean;
}

function line(state: PanelState, text: string): PanelStatus {
  return { state, text, tone: TONES[state] };
}

/** The one line in the panel that says what is happening and whose turn it is. */
export function panelStatus(s: PanelStatusInput): PanelStatus {
  if (!s.seated) return line('spectating', WATCHING_TEXT);
  if (s.phase === 'ending' || s.phase === 'gameOver') return line('over', 'Game over');
  if (s.bustedOut) return line('out', "You're out of chips");
  if (!s.connected) return line('offline', 'Reconnecting…');
  if (s.phase === 'held') return line('held', 'Waiting for players');
  if (s.dealerPlaying) return line('dealer', "Dealer's turn");
  if (s.phase === 'results') return line('results', 'Next round soon');
  if (s.phase === 'betting') {
    if (!s.inRound) return line('next-round', "You're in from the next round");
    if (s.sittingOut) return line('sat-out', 'You sit this hand out');
    if (!s.betPlaced) return line('bet', 'Place your bet');
    if (s.pending.length > 0) return line('waiting', waitingText(s.pending));
    return line('dealing', 'Dealing');
  }
  // Seated with chips but not dealt in: they sat the hand out (a newcomer has no chips yet).
  if (!s.inRound) return line('next-round', s.hasChips ? 'You sit this hand out' : "You're in from the next round");
  if (s.myTurn) return line('my-turn', s.handCount > 1 ? `Your turn, hand ${s.handIndex + 1} of ${s.handCount}` : 'Your turn');
  return line('their-turn', `${s.turnName}'s turn`);
}

/** The line under the ribbon for my settled round: "You win +200", "Blackjack +250", "Push", "You lost". */
export function resultLabel(outcome: HandOutcome, back: number): string {
  switch (outcome) {
    case 'blackjack':
      return `Blackjack ${payoutText(back)}`;
    case 'win':
      return `You win ${payoutText(back)}`;
    case 'push':
      return 'Push';
    case 'loss':
      return 'You lost';
  }
}

/** The line under the ribbon while the bets go down: `waiting` names who the deal waits for, the viewer left out. */
export function betsLabel(meWaiting: boolean, waiting: readonly string[], anyBet: boolean): string {
  if (meWaiting) return 'Place your bet';
  if (waiting.length === 0) return anyBet ? 'Dealing' : 'Waiting for a bet';
  return waitingText(waiting);
}

/** Under "Dealer's turn" while the dealer plays: the rule it plays by. */
const DEALER_DRAWS = 'Draws to 17';

const IDLE_LINES = { held: 'Waiting for players', over: 'Game over', next: 'Next round soon' } as const;

export interface FocusLine {
  /** The state, for data-state: the focus's kind. */
  state: string;
  text: string;
  tone: StatusTone;
  /** A quieter second part: who is next, how many bets are in, the dealer's rule. */
  sub?: string;
}

export interface FocusLineInput {
  nameOf(id: string): string;
  meId: string;
  /** How many hands the player on turn holds, for "hand 2 of 3". */
  handCount: number;
  /** My settled round, for a `result` focus. */
  result?: { outcome: HandOutcome; back: number };
}

/**
 * The short line under the ribbon: whose turn it is ("Pia's turn, hand 2 of 3", with who is next),
 * the dealer playing, the bets going down (and how many are in), or how my round went.
 */
export function focusLine(focus: BjFocus, s: FocusLineInput): FocusLine {
  switch (focus.kind) {
    case 'turn': {
      const which = s.handCount > 1 ? `, hand ${focus.handIndex + 1} of ${s.handCount}` : '';
      if (focus.mine) return { state: 'mine', text: `Your turn${which}`, tone: 'go' };
      const next = focus.next === null ? 'Dealer' : focus.next === s.meId ? 'You' : s.nameOf(focus.next);
      return { state: 'turn', text: `${s.nameOf(focus.playerId)}'s turn${which}`, tone: 'other', sub: `Next: ${next}` };
    }
    case 'dealer':
      return { state: 'dealer', text: "Dealer's turn", tone: 'other', sub: DEALER_DRAWS };
    case 'bets': {
      const names = focus.waiting.filter((id) => id !== s.meId).map(s.nameOf);
      const meWaiting = focus.waiting.includes(s.meId);
      const sub = `${focus.placed.length} of ${focus.placed.length + focus.waiting.length} bets in`;
      return { state: 'bets', text: betsLabel(meWaiting, names, focus.placed.length > 0), tone: meWaiting ? 'go' : 'quiet', sub };
    }
    case 'result': {
      const outcome = s.result?.outcome ?? 'push';
      const tone: StatusTone = outcome === 'loss' ? 'bad' : outcome === 'push' ? 'quiet' : 'go';
      return { state: 'result', text: resultLabel(outcome, s.result?.back ?? 0), tone };
    }
    case 'idle':
      return { state: 'idle', text: IDLE_LINES[focus.reason], tone: 'quiet' };
  }
}
