import type { Card, CardSuit } from '@shared/platform/cards';

const SUIT_GLYPHS: Record<CardSuit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAMES: Record<CardSuit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANK_NAMES: Record<string, string> = { A: 'ace', J: 'jack', Q: 'queen', K: 'king' };

/** "queen of hearts": the card's accessible name. */
export function cardName(card: Card): string {
  return `${RANK_NAMES[card.rank] ?? card.rank} of ${SUIT_NAMES[card.suit]}`;
}

export type PlayingCardSize = 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  card: Card | null;
  size?: PlayingCardSize;
  testId?: string;
  /** An empty place on the table before the deal rather than a card. */
  slot?: boolean;
  /** Lifted out of a row of cards (the five that make a hand). */
  highlight?: boolean;
  className?: string;
}

/**
 * A CSS playing card (cards.css): a bold rank at the top left with one big suit under it, red or
 * near-black, nothing else on the face, so a card fanned under the next still reads. `null` is a
 * face-down card (the boredgames back) whose markup carries no rank or suit at all.
 */
export function PlayingCard({ card, size = 'md', testId = 'card', slot = false, highlight = false, className }: Props) {
  const extra = `${highlight ? ' playing-card--highlight' : ''}${className ? ` ${className}` : ''}`;
  if (!card) {
    return (
      <span className={`playing-card playing-card--${size} ${slot ? 'playing-card--slot' : 'playing-card--down'}${extra}`} role="img" aria-label={slot ? 'Empty card slot' : 'Face-down card'} data-testid={testId} data-face="down">
        <span className="playing-card__back" aria-hidden="true" />
      </span>
    );
  }
  const red = card.suit === 'H' || card.suit === 'D';
  return (
    <span className={`playing-card playing-card--${size}${red ? ' playing-card--red' : ''}${extra}`} role="img" aria-label={cardName(card)} data-testid={testId} data-face="up" data-rank={card.rank} data-suit={card.suit}>
      <span className="playing-card__corner" aria-hidden="true">
        <span className={`playing-card__rank${card.rank === '10' ? ' playing-card__rank--wide' : ''}`}>{card.rank}</span>
        <span className="playing-card__suit">{SUIT_GLYPHS[card.suit]}</span>
      </span>
    </span>
  );
}
