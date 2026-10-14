import type { BlackjackActions, BlackjackPhase, BlackjackSettings, BlackjackView, DealerView, HandOutcome, HandStatus, HandView } from '@shared/games/blackjack/protocol';

export function formatChips(n: number): string {
  return n.toLocaleString('en-US');
}

/** A typed chip amount clamped to the limits, or null for a blank or unreadable entry (the field keeps its value). */
export function parseChipAmount(text: string, min: number, max: number): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function chatPlaceholderFor(phase: BlackjackPhase | undefined, inRound: boolean): string | undefined {
  switch (phase) {
    case 'betting':
      return inRound ? 'Place your bet, then chat…' : 'Watching this round…';
    case 'acting':
      return 'Hit or stand? Talk it over…';
    case 'results':
      return 'Rub it in…';
    default:
      return undefined;
  }
}

export function roundLabel(view: BlackjackView, long: boolean): string {
  return long ? `Round ${view.round} of ${view.totalRounds}` : `Round ${view.round}/${view.totalRounds}`;
}

/** The phase in a few words; `short` is the phone header's narrow slot. */
export function phaseKicker(view: BlackjackView, turnName: string, mine: boolean, short = false): string {
  switch (view.phase) {
    case 'betting':
      return short ? 'Bet now' : 'Place your bets';
    case 'acting':
      if (mine) return short ? 'Your move' : 'Your move — hit or stand?';
      return short ? `${turnName}'s move` : `${turnName} is playing`;
    case 'results':
      return view.paused ? 'Paused' : 'Results';
    case 'gameOver':
      return 'Game over';
  }
}

const STATUS_LABELS: Record<HandStatus, string> = {
  waiting: 'Waiting',
  acting: 'Playing',
  stood: 'Stands',
  bust: 'Bust',
  blackjack: 'Blackjack!',
  won: 'Won',
  lost: 'Lost',
  push: 'Push',
};

export function statusLabel(status: HandStatus): string {
  return STATUS_LABELS[status];
}

const OUTCOME_LABELS: Record<HandOutcome, string> = { win: 'Win', blackjack: 'Blackjack!', push: 'Push', loss: 'Loss' };

export function outcomeLabel(outcome: HandOutcome): string {
  return OUTCOME_LABELS[outcome];
}

/** "Soft 17", "Hard 12", "Bust 23", "Blackjack". */
export function totalLabel(hand: Pick<HandView, 'total' | 'soft' | 'cards'>, natural = false): string {
  if (natural) return 'Blackjack';
  if (hand.total > 21) return `Bust ${hand.total}`;
  if (hand.cards.length < 2) return String(hand.total);
  return `${hand.soft ? 'Soft' : 'Hard'} ${hand.total}`;
}

export function dealerTotalLabel(dealer: DealerView): string {
  if (dealer.holeHidden) return `Shows ${dealer.total}`;
  if (dealer.blackjack) return 'Blackjack';
  if (dealer.total > 21) return `Bust ${dealer.total}`;
  return `${dealer.soft ? 'Soft' : 'Hard'} ${dealer.total}`;
}

/** The chips a settled hand moved: "+150", "−50", "±0". */
export function netLabel(net: number): string {
  if (net > 0) return `+${formatChips(net)}`;
  if (net < 0) return `−${formatChips(-net)}`;
  return '±0';
}

/** Why a greyed-out move is not on offer; empty when it is. */
export function actionReason(action: keyof BlackjackActions, actions: BlackjackActions, hand: HandView | undefined, chips: number, settings: BlackjackSettings, myTurn: boolean): string {
  if (actions[action]) return '';
  if (!myTurn || !hand) return 'Not your turn';
  switch (action) {
    case 'canHit':
    case 'canStand':
      return 'Not your turn';
    case 'canDouble':
      if (!settings.allowDouble) return 'Off at this table';
      if (hand.cards.length !== 2) return 'First two cards only';
      if (chips < hand.bet) return 'Not enough chips';
      return 'Not now';
    case 'canSplit':
      if (!settings.allowSplit) return 'Off at this table';
      if (hand.fromSplit) return 'One split per round';
      if (hand.cards.length !== 2) return 'First two cards only';
      if (chips < hand.bet) return 'Not enough chips';
      return 'Needs a pair';
  }
}
