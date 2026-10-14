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
    case 'ending':
    case 'gameOver':
      return 'Good game…';
    default:
      return undefined;
  }
}

/** "Round 4 of 10", or "Round 4" when the rounds are unlimited. */
export function roundLabel(round: number, totalRounds: number): string {
  return totalRounds > 0 ? `Round ${round} of ${totalRounds}` : `Round ${round}`;
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
      return view.totalRounds > 0 && view.round === view.totalRounds ? 'Last round' : 'Place your bets';
    case 'acting':
      return mine ? 'Your turn' : `${turnName}'s turn`;
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

export type PanelState = 'spectating' | 'out' | 'offline' | 'held' | 'over' | 'dealer' | 'next-round' | 'bet' | 'waiting' | 'dealing' | 'my-turn' | 'their-turn';

const TONES: Record<PanelState, StatusTone> = {
  spectating: 'quiet',
  out: 'bad',
  offline: 'quiet',
  held: 'quiet',
  over: 'quiet',
  dealer: 'other',
  'next-round': 'quiet',
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
  betPlaced: boolean;
  /** Names of the seats still to bet, the viewer left out. */
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
  if (s.phase === 'betting') {
    if (!s.inRound) return line('next-round', "You're in from the next round");
    if (!s.betPlaced) return line('bet', 'Place your bet');
    if (s.pending.length > 0) return line('waiting', `Waiting for ${joinNames(s.pending)}`);
    return line('dealing', 'Dealing');
  }
  if (s.myTurn) return line('my-turn', s.handCount > 1 ? `Your turn, hand ${s.handIndex + 1} of ${s.handCount}` : 'Your turn');
  return line('their-turn', `${s.turnName}'s turn`);
}
