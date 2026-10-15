import type { BlackjackPayout, BlackjackPhase, BlackjackView, HandOutcome } from '@shared/games/blackjack/protocol';
import { formatChips } from '../../../platform/lib/format';
import type { PanelStatus, StatusTone } from '../../../platform/table/ControlPanel';

export { formatChips };

export function chatPlaceholderFor(phase: BlackjackPhase | undefined, inRound: boolean): string | undefined {
  switch (phase) {
    case 'betting':
      return inRound ? 'Bet, then chat…' : 'Watching this round…';
    case 'acting':
      return 'Hit or stand? Talk it over…';
    case 'results':
      return 'Good hand? Talk it over…';
    case 'ending':
    case 'gameOver':
      return 'Good game…';
    default:
      return undefined;
  }
}

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

const PAYS: Record<BlackjackPayout, string> = { '3:2': '3 TO 2', '6:5': '6 TO 5' };

export function ribbonText(payout: BlackjackPayout): string {
  return `BLACKJACK PAYS ${PAYS[payout]}`;
}

export function dealerRuleText(hitsSoft17: boolean): string {
  return hitsSoft17 ? 'DEALER HITS SOFT 17' : 'DEALER STANDS ON 17';
}

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
  if (!s.seated) return line('spectating', "You're watching this game");
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

/** The spotlight's label for my settled round: "You win +200", "Blackjack +250", "Push", "You lost". */
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

/** The spotlight's label while the bets go down: `waiting` names who the deal waits for, the viewer left out. */
export function betsLabel(meWaiting: boolean, waiting: readonly string[], anyBet: boolean): string {
  if (meWaiting) return 'Place your bet';
  if (waiting.length === 0) return anyBet ? 'Dealing' : 'Waiting for a bet';
  return waitingText(waiting);
}

/** Which of a seat's hands is in play, for a seat holding more than one: "Hand 3 of 7". */
export function handMarker(handIndex: number, handCount: number): string {
  return `Hand ${handIndex + 1} of ${handCount}`;
}

/** Under "Dealer's turn" while the dealer plays: the rule it plays by. */
export function dealerRule(hitsSoft17: boolean): string {
  return hitsSoft17 ? 'Draws to 17, hits a soft 17' : 'Draws to 17';
}

/** The spotlight's label on a turn (the hand in play goes under it, as a marker). */
export function turnLabel(mine: boolean, name: string): string {
  return mine ? 'Your turn' : `${name}'s turn`;
}
