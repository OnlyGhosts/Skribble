import { evaluateBest, handName, rankValue, type HandCategory, type HandRank } from '@shared/games/poker/hands';
import type { Card, PokerLastAction, PokerPhase, PokerResults, PokerStreet, PokerView } from '@shared/games/poker/protocol';
import { formatChips } from '../../../platform/lib/format';
import type { PanelStatus, StatusTone } from '../../../platform/table/ControlPanel';

export { formatChips };

/** "Hand 3 of 10", or "Hand 3" when the game runs until one stack is left. */
export function handLabel(view: Pick<PokerView, 'hand' | 'totalHands'>): string {
  const hand = Math.max(1, view.hand);
  return view.totalHands === 0 ? `Hand ${hand}` : `Hand ${hand} of ${view.totalHands}`;
}

const STREETS: Record<PokerStreet, string> = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River' };

export function streetLabel(street: PokerStreet | null): string {
  return street ? STREETS[street] : 'Dealing';
}

export function blindsLabel(view: Pick<PokerView, 'blinds'>): string {
  return `${formatChips(view.blinds.small)}/${formatChips(view.blinds.big)}`;
}

/**
 * The small line under the hand in the top bar: the blinds first (a narrow phone cuts the end of
 * the line, and the board already shows the street), then the street or how the hand ended.
 */
export function phaseKicker(view: PokerView): string {
  const blinds = `Blinds ${blindsLabel(view)}`;
  switch (view.phase) {
    case 'acting':
      return `${blinds} · ${streetLabel(view.street)}`;
    case 'results':
      if (view.paused) return 'Paused';
      return `${blinds} · ${view.results?.uncontested ? 'Hand over' : 'Showdown'}`;
    case 'gameOver':
      return 'Game over';
  }
}

export const RIBBON_TEXT = "NO LIMIT TEXAS HOLD'EM";

export function chatPlaceholderFor(phase: PokerPhase | undefined, inHand: boolean): string | undefined {
  switch (phase) {
    case 'acting':
      return inHand ? 'Table talk…' : 'Watching this hand…';
    case 'results':
      return 'Nice hand…';
    default:
      return undefined;
  }
}

/** What a seat did last: "Check", "Call 20", "Raise to 80", "All in 300", "BB 10". */
export function lastActionLabel(action: PokerLastAction | null): string {
  if (!action) return '';
  const n = formatChips(action.amount);
  switch (action.kind) {
    case 'fold':
      return 'Fold';
    case 'check':
      return 'Check';
    case 'call':
      return `Call ${n}`;
    case 'bet':
      return `Bet ${n}`;
    case 'raise':
      return `Raise to ${n}`;
    case 'allIn':
      return `All in ${n}`;
    case 'smallBlind':
      return `SB ${n}`;
    case 'bigBlind':
      return `BB ${n}`;
  }
}

/** The chips a winner took back ("+300"). */
export function payoutText(amount: number): string {
  return `+${formatChips(amount)}`;
}

const lower = (name: string): string => `${name.charAt(0).toLowerCase()}${name.slice(1)}`;

/** "a straight", "a pair of kings", but "two pair", "three of a kind", "ace high" as they are. */
const withArticle = (name: string): string => (/^(straight|flush|full house|pair|royal flush)/.test(name) ? `a ${name}` : name);

/**
 * How the hand ended, for the panel: "Pia wins 300 with a flush", "You take the pot", "Split pot
 * with two pair". `nameOf` names a player ("You" for the viewer).
 */
export function resultText(results: PokerResults, nameOf: (id: string) => string): string {
  const main = results.pots[0];
  if (!main || main.winners.length === 0) return 'The hand is over';
  const names = main.winners.map((w) => nameOf(w.playerId));
  const you = names[0] === 'You';
  if (results.uncontested) return `${names[0]} ${you ? 'take' : 'takes'} the pot`;
  const hand = main.handName ? ` with ${withArticle(lower(main.handName))}` : '';
  if (names.length > 1) return `Split pot${hand}`;
  return `${names[0]} ${you ? 'win' : 'wins'} ${formatChips(main.amount)}${hand}`;
}

/**
 * What my cards make right now, for the pill over them: the best five of everything once five
 * are out ("Two pair, kings and fives"), a pocket pair or the high card before the flop.
 */
export function handHint(myCards: readonly Card[], community: readonly Card[]): string | null {
  if (myCards.length < 2) return null;
  const all = [...myCards, ...community];
  if (all.length >= 5) return handName(evaluateBest(all));
  const values = myCards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const hand: HandRank = values[0] === values[1] ? { category: 'pair', ranks: [values[0]], cards: [...myCards] } : { category: 'highCard', ranks: values, cards: [...myCards] };
  return handName(hand);
}

export const HOTKEY_HINT = 'F fold · C check or call · R raise · A all in';

export type PanelState = 'spectating' | 'over' | 'no-seat' | 'out' | 'offline' | 'held' | 'next-hand' | 'showdown' | 'result' | 'my-turn' | 'their-turn' | 'dealing';

const TONES: Record<PanelState, StatusTone> = {
  spectating: 'quiet',
  over: 'quiet',
  'no-seat': 'quiet',
  out: 'bad',
  offline: 'quiet',
  held: 'quiet',
  'next-hand': 'quiet',
  showdown: 'other',
  result: 'go',
  'my-turn': 'go',
  'their-turn': 'other',
  dealing: 'quiet',
};

export interface PanelStatusInput {
  phase: PokerPhase;
  seated: boolean;
  /** Every seat at the table is taken: watching until one frees up. */
  waitingForSeat: boolean;
  busted: boolean;
  connected: boolean;
  /** The next hand waits for players. */
  held: boolean;
  /** Dealt into the hand on the table. */
  inHand: boolean;
  myTurn: boolean;
  /** Whose turn it is, when it is somebody's. */
  turnName: string | null;
  /** How the hand ended, once the table shows it; null before. */
  result: string | null;
  /** I took chips from the pot. */
  won: boolean;
}

function line(state: PanelState, text: string): PanelStatus {
  return { state, text, tone: TONES[state] };
}

/** The one line in the panel that says what is happening and whose turn it is. */
export function panelStatus(s: PanelStatusInput): PanelStatus {
  if (!s.seated) return line('spectating', "You're watching this game");
  if (s.phase === 'gameOver') return line('over', 'Game over');
  if (s.waitingForSeat) return line('no-seat', 'Table full. You get the next free seat');
  if (s.busted) return line('out', "You're out of chips");
  if (!s.connected) return line('offline', 'Reconnecting…');
  if (s.phase === 'results') {
    if (s.result) return { ...line('result', s.result), tone: s.won ? 'go' : 'other' };
    if (s.held) return line('held', 'Waiting for players');
    return line('showdown', 'Showdown');
  }
  if (s.myTurn) return line('my-turn', 'Your turn');
  if (s.turnName) return line('their-turn', `${s.turnName}'s turn`);
  if (!s.inHand) return line('next-hand', "You're in from the next hand");
  return line('dealing', 'Dealing');
}

const CATEGORY_LABELS: Record<HandCategory, string> = {
  highCard: 'High card',
  pair: 'Pair',
  twoPair: 'Two pair',
  threeOfAKind: 'Trips',
  straight: 'Straight',
  flush: 'Flush',
  fullHouse: 'Full house',
  fourOfAKind: 'Quads',
  straightFlush: 'Straight flush',
};

/** A shown hand in a word or two, for a seat's tile: "Two pair", "Flush". */
export function categoryLabel(category: HandCategory): string {
  return CATEGORY_LABELS[category];
}
