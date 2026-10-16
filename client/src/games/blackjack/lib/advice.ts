/**
 * Which move the panel lights as its main one on my turn (pure, for the panel and the tests): the
 * usual sensible play, from my hand and the dealer's up card. It only moves the emphasis; every
 * move on offer stays a tap away.
 */
import { cardValue, handTotal, isPair } from '@shared/games/blackjack/cards';
import type { BlackjackActions, Card } from '@shared/games/blackjack/protocol';

export type MoveId = 'hit' | 'stand' | 'split' | 'double';

const OFFERED: Record<MoveId, keyof BlackjackActions> = { hit: 'canHit', stand: 'canStand', split: 'canSplit', double: 'canDouble' };

/** The play for a hand against the dealer's up card, before asking what is on offer. */
function play(cards: readonly Card[], up: number): MoveId {
  const { total, soft } = handTotal(cards);
  if (isPair(cards) && (cards[0].rank === 'A' || cards[0].rank === '8')) return 'split';
  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) return up >= 9 ? 'hit' : 'stand';
    return 'hit';
  }
  if (total === 11 || (total === 10 && up <= 9)) return 'double';
  if (total >= 17) return 'stand';
  if (total >= 13) return up <= 6 ? 'stand' : 'hit';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  return 'hit';
}

/** The move to light, or null when none is on offer. A play not on offer (Double after a hit) falls back to Hit, then Stand. */
export function suggestedMove(cards: readonly Card[], dealerUp: Card | null | undefined, actions: BlackjackActions): MoveId | null {
  const offered = (m: MoveId) => actions[OFFERED[m]];
  if (cards.length === 0 || !dealerUp) return offered('hit') ? 'hit' : offered('stand') ? 'stand' : null;
  // An ace showing counts high: the dealer is strong.
  const pick = play(cards, dealerUp.rank === 'A' ? 11 : cardValue(dealerUp.rank));
  if (offered(pick)) return pick;
  return offered('hit') ? 'hit' : offered('stand') ? 'stand' : null;
}
