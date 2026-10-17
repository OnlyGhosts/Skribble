import type { BlackjackPhase, BlackjackView, HandOutcome } from '@shared/games/blackjack/protocol';
import { formatChips } from '../../../platform/lib/format';
import type { TurnTone } from '../../../platform/table/TurnLine';
import type { BjFocus } from './focus';

export { formatChips };

/** "Round 4": the rounds never run out. A hold before the first deal reads as round 1. */
export function roundLabel(round: number): string {
  return `Round ${Math.max(1, round)}`;
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

/** The banner across the table, with the small rule under it beside the round: the house rules are fixed. */
export const RIBBON_TEXT = 'Blackjack pays 3 to 2';
export const DEALER_RULE_TEXT = 'Dealer stands on 17';

/** Beside the round under the banner: the dealer's rule, or "Last hand" once the host has ended the game mid-hand. */
export function ruleText(view: Pick<BlackjackView, 'endRequested' | 'phase'>): string {
  return view.endRequested && view.phase === 'acting' ? 'Last hand' : DEALER_RULE_TEXT;
}

const OUTCOME_LABELS: Record<HandOutcome, string> = { win: 'Win', blackjack: 'Blackjack', push: 'Push', loss: 'Lost' };

export function outcomeLabel(outcome: HandOutcome): string {
  return OUTCOME_LABELS[outcome];
}

/** The chips a settled hand put back on the balance: "+220". Nothing on a loss. */
export function payoutText(payout: number): string {
  return payout > 0 ? `+${formatChips(payout)}` : '';
}

/**
 * Where I stand at the table when I am not simply playing the round: watching the game, out of
 * chips, sitting this hand out, or in from the next round (a newcomer). The line under the ribbon
 * says it, since the panel has no line of its own.
 */
export type Standing = 'playing' | 'watching' | 'out' | 'sat-out' | 'next-round';

export interface StandingInput {
  phase: BlackjackPhase;
  seated: boolean;
  bustedOut: boolean;
  /** Dealt into the round in play (the bets: seated for it). */
  inRound: boolean;
  /** A seat with chips: one not dealt in sat the hand out rather than waiting for a seat. */
  hasChips: boolean;
  /** Chose to sit this hand out while the bets are open. */
  sittingOut: boolean;
}

export function standingOf(s: StandingInput): Standing {
  if (!s.seated) return 'watching';
  if (s.bustedOut) return 'out';
  if (s.phase === 'betting') return !s.inRound ? 'next-round' : s.sittingOut ? 'sat-out' : 'playing';
  if (s.phase === 'acting' && !s.inRound) return s.hasChips ? 'sat-out' : 'next-round';
  return 'playing';
}

const STANDING_LINES: Record<Exclude<Standing, 'playing' | 'watching'>, string> = {
  out: "You’re out of chips",
  'sat-out': 'You sit this hand out',
  'next-round': "You’re in from the next round",
};

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
  /** The state, for data-state: the focus's kind, or where I stand when that is the news. */
  state: string;
  text: string;
  tone: TurnTone;
  /** A quieter second part: who is next, how many bets are in, the dealer's rule, where I stand. */
  sub?: string;
}

export interface FocusLineInput {
  nameOf(id: string): string;
  meId: string;
  /** How many hands the player on turn holds, for "hand 2 of 3". */
  handCount: number;
  /** My settled round, for a `result` focus. */
  result?: { outcome: HandOutcome; back: number };
  /** Where I stand when I am not simply playing (playing by default). */
  standing?: Standing;
  /** The player on turn has gone quiet (asleep, frozen, in the background). */
  turnAway?: boolean;
  /** My bet is queued for the bets about to open. */
  betQueued?: boolean;
}

/**
 * The one line on the table that says what is happening, under the ribbon: whose turn it is
 * ("Pia's turn, hand 2 of 3", with who is next), the dealer playing, the bets going down (and how
 * many are in), or how my round went; where I stand when that matters more (sitting a hand out,
 * out of chips), in the second part while somebody plays.
 */
export function focusLine(focus: BjFocus, s: FocusLineInput): FocusLine {
  const standing = s.standing ?? 'playing';
  const note = standing === 'playing' || standing === 'watching' ? undefined : STANDING_LINES[standing];
  switch (focus.kind) {
    case 'turn': {
      const which = s.handCount > 1 ? `, hand ${focus.handIndex + 1} of ${s.handCount}` : '';
      if (focus.mine) return { state: 'mine', text: `Your turn${which}`, tone: 'go' };
      const next = focus.next === null ? 'Dealer' : focus.next === s.meId ? 'You' : s.nameOf(focus.next);
      const name = s.nameOf(focus.playerId);
      return { state: 'turn', text: s.turnAway ? `${name} is away` : `${name}’s turn${which}`, tone: 'other', sub: note ?? `Next: ${next}` };
    }
    case 'dealer':
      return { state: 'dealer', text: "Dealer’s turn", tone: 'other', sub: DEALER_DRAWS };
    case 'bets': {
      const sub = `${focus.placed.length} of ${focus.placed.length + focus.waiting.length} bets in`;
      if (note) return { state: standing, text: note, tone: standing === 'out' ? 'bad' : 'quiet', sub };
      const names = focus.waiting.filter((id) => id !== s.meId).map(s.nameOf);
      const meWaiting = focus.waiting.includes(s.meId);
      return { state: 'bets', text: betsLabel(meWaiting, names, focus.placed.length > 0), tone: meWaiting ? 'go' : 'quiet', sub };
    }
    case 'result': {
      const outcome = s.result?.outcome ?? 'push';
      const tone: TurnTone = outcome === 'loss' ? 'bad' : outcome === 'push' ? 'quiet' : 'go';
      return { state: 'result', text: resultLabel(outcome, s.result?.back ?? 0), tone, sub: s.betQueued ? 'Bet placed' : undefined };
    }
    case 'idle':
      if (focus.reason === 'next' && standing === 'out') return { state: 'out', text: STANDING_LINES.out, tone: 'bad' };
      return { state: 'idle', text: IDLE_LINES[focus.reason], tone: 'quiet', sub: focus.reason === 'next' && s.betQueued ? 'Bet placed' : undefined };
  }
}
