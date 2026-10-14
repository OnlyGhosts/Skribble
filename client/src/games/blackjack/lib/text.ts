import type { BlackjackPayout, BlackjackPhase, BlackjackView, HandOutcome } from '@shared/games/blackjack/protocol';
import { formatChips } from '../../../platform/lib/format';

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

/** The small line under the round in the top bar. */
export function phaseKicker(view: BlackjackView, turnName: string, mine: boolean): string {
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

export type PanelState = 'spectating' | 'out' | 'offline' | 'held' | 'over' | 'dealer' | 'next-round' | 'bet' | 'waiting' | 'dealing' | 'my-turn' | 'their-turn' | 'idle';

export interface PanelStatus {
  state: PanelState;
  text: string;
}

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

/** The one line in the panel that says what is happening and whose turn it is. */
export function panelStatus(s: PanelStatusInput): PanelStatus {
  if (!s.seated) return { state: 'spectating', text: "You're watching this game" };
  if (s.phase === 'ending' || s.phase === 'gameOver') return { state: 'over', text: 'Game over' };
  if (s.bustedOut) return { state: 'out', text: "You're out of chips" };
  if (!s.connected) return { state: 'offline', text: 'Reconnecting…' };
  if (s.phase === 'held') return { state: 'held', text: 'Waiting for players' };
  if (s.dealerPlaying) return { state: 'dealer', text: "Dealer's turn" };
  if (s.phase === 'betting') {
    if (!s.inRound) return { state: 'next-round', text: "You're in from the next round" };
    if (!s.betPlaced) return { state: 'bet', text: 'Place your bet' };
    if (s.pending.length > 0) return { state: 'waiting', text: `Waiting for ${joinNames(s.pending)}` };
    return { state: 'dealing', text: 'Dealing' };
  }
  if (s.myTurn) return { state: 'my-turn', text: s.handCount > 1 ? `Your turn, hand ${s.handIndex + 1} of ${s.handCount}` : 'Your turn' };
  return { state: 'their-turn', text: `${s.turnName}'s turn` };
}
