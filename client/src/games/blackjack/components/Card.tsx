import type { Card, CardSuit } from '@shared/games/blackjack/protocol';

const SUIT_GLYPHS: Record<CardSuit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAMES: Record<CardSuit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANK_NAMES: Record<string, string> = { A: 'ace', J: 'jack', Q: 'queen', K: 'king' };

export function cardName(card: Card): string {
  return `${RANK_NAMES[card.rank] ?? card.rank} of ${SUIT_NAMES[card.suit]}`;
}

interface Props {
  card: Card | null;
  size?: 'sm' | 'md' | 'lg';
  testId?: string;
  /** An empty place on the table before the deal rather than a card. */
  slot?: boolean;
}

/** A CSS playing card: rank and suit in the corner and the middle, red or black; `null` is a face-down card. */
export function PlayingCard({ card, size = 'md', testId = 'card', slot = false }: Props) {
  if (!card) {
    return (
      <span className={`bj-card bj-card--${size} ${slot ? 'bj-card--slot' : 'bj-card--down'}`} role="img" aria-label={slot ? 'Empty card slot' : 'Face-down card'} data-testid={testId} data-face="down">
        <span className="bj-card__back" aria-hidden="true" />
      </span>
    );
  }
  const red = card.suit === 'H' || card.suit === 'D';
  const glyph = SUIT_GLYPHS[card.suit];
  return (
    <span className={`bj-card bj-card--${size}${red ? ' bj-card--red' : ''}`} role="img" aria-label={cardName(card)} data-testid={testId} data-face="up" data-rank={card.rank} data-suit={card.suit}>
      <span className="bj-card__corner" aria-hidden="true">
        <span className="bj-card__rank">{card.rank}</span>
        <span className="bj-card__suit">{glyph}</span>
      </span>
      <span className="bj-card__pip" aria-hidden="true">
        {glyph}
      </span>
      <span className="bj-card__corner bj-card__corner--flip" aria-hidden="true">
        <span className="bj-card__rank">{card.rank}</span>
        <span className="bj-card__suit">{glyph}</span>
      </span>
    </span>
  );
}
