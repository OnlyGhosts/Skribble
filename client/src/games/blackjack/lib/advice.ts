/**
 * Which move the panel lights as its main one on my turn (pure, for the panel and the tests): basic
 * strategy as a casino's strategy card prints it, from my hand and the dealer's up card. It only
 * moves the emphasis; every move on offer stays a tap away.
 *
 * The card is the standard one for six to eight decks with the dealer standing on soft 17, double
 * after split and no surrender, which are this table's rules (blackjack pays 3 to 2, pairs re-split
 * with no cap, aces included). The endless deck plays like an infinite deck, whose chart differs in
 * two close cells (it hits soft 13 against a 5 and soft 15 against a 4); the casino card is kept.
 */
import { cardValue, handTotal, isPair } from '@shared/games/blackjack/cards';
import type { BlackjackActions, Card } from '@shared/games/blackjack/protocol';

export type MoveId = 'hit' | 'stand' | 'split' | 'double';

const OFFERED: Record<MoveId, keyof BlackjackActions> = { hit: 'canHit', stand: 'canStand', split: 'canSplit', double: 'canDouble' };

/**
 * One letter per dealer up card, 2 to 10 then the ace. H hit, S stand, P split, D double (hit when
 * a double is not on offer), X double (stand when it is not).
 */
type Row = string;

/** Hard totals; 8 and under always hit, 17 and over always stand. */
const HARD: Record<number, Row> = {
  9: 'HDDDDHHHHH',
  10: 'DDDDDDDDHH',
  11: 'DDDDDDDDDH',
  12: 'HHSSSHHHHH',
  13: 'SSSSSHHHHH',
  14: 'SSSSSHHHHH',
  15: 'SSSSSHHHHH',
  16: 'SSSSSHHHHH',
};

/** Soft totals (an ace counted as 11); 19 and over always stand. */
const SOFT: Record<number, Row> = {
  13: 'HHHDDHHHHH',
  14: 'HHHDDHHHHH',
  15: 'HHDDDHHHHH',
  16: 'HHDDDHHHHH',
  17: 'HDDDDHHHHH',
  18: 'SXXXXSSHHH',
};

/** Pairs by card value (an ace is 1); fives play as a hard 10 and tens as a hard 20. */
const PAIRS: Record<number, Row> = {
  1: 'PPPPPPPPPP',
  2: 'PPPPPPHHHH',
  3: 'PPPPPPHHHH',
  4: 'HHHPPHHHHH',
  6: 'PPPPPHHHHH',
  7: 'PPPPPPHHHH',
  8: 'PPPPPPPPPP',
  9: 'PPPPPSPPSS',
};

/** The chart's letter for a hand, before asking what is on offer. `column` is 0 for a 2 up to 9 for an ace. */
function chart(cards: readonly Card[], column: number, canSplit: boolean): string {
  const pair = isPair(cards) ? PAIRS[cardValue(cards[0].rank)] : undefined;
  if (pair && canSplit && pair[column] === 'P') return 'P';
  const { total, soft } = handTotal(cards);
  if (soft) return total >= 19 ? 'S' : (SOFT[total]?.[column] ?? 'H');
  if (total >= 17) return 'S';
  return HARD[total]?.[column] ?? 'H';
}

/** The move to light, or null when none is on offer. A play not on offer falls back as the chart says, then to Hit, then Stand. */
export function suggestedMove(cards: readonly Card[], dealerUp: Card | null | undefined, actions: BlackjackActions): MoveId | null {
  const offered = (m: MoveId) => actions[OFFERED[m]];
  const fallback = (): MoveId | null => (offered('hit') ? 'hit' : offered('stand') ? 'stand' : null);
  if (cards.length === 0 || !dealerUp) return fallback();
  const up = cardValue(dealerUp.rank);
  const column = up === 1 ? 9 : up - 2;
  const letter = chart(cards, column, offered('split'));
  const pick: MoveId =
    letter === 'P' ? 'split'
    : letter === 'D' ? (offered('double') ? 'double' : 'hit')
    : letter === 'X' ? (offered('double') ? 'double' : 'stand')
    : letter === 'S' ? 'stand'
    : 'hit';
  return offered(pick) ? pick : fallback();
}
