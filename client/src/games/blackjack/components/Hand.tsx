import type { HandView } from '@shared/games/blackjack/protocol';
import { statusLabel, totalLabel } from '../lib/text';
import { PlayingCard } from '../../../platform/components/PlayingCard';
import { Chips } from '../../../platform/components/Chips';

interface Props {
  hand: HandView;
  index: number;
  size: 'sm' | 'md' | 'lg';
  /** The hand in play right now. */
  active: boolean;
  testId?: string;
}

/** One hand: its cards fanned, the total, the stake and where it stands. */
export function Hand({ hand, index, size, active, testId = 'hand' }: Props) {
  const natural = hand.status === 'blackjack';
  return (
    <div
      role="group"
      className={`bj-hand bj-hand--${size} bj-hand--${hand.status}${active ? ' bj-hand--active' : ''}`}
      data-testid={testId}
      data-index={index}
      data-status={hand.status}
      data-total={hand.total}
      data-bet={hand.bet}
      aria-label={`Hand ${index + 1}: ${totalLabel(hand, natural)}, ${statusLabel(hand.status)}`}
    >
      <div className="bj-hand__cards">
        {hand.cards.map((card, i) => (
          <PlayingCard key={`${i}-${card.rank}${card.suit}`} card={card} size={size} />
        ))}
      </div>
      <div className="bj-hand__meta">
        <span className="bj-total" data-testid="hand-total">
          {totalLabel(hand, natural)}
        </span>
        <span className={`bj-status bj-status--${hand.status}`} data-testid="hand-status">
          {statusLabel(hand.status)}
        </span>
        {size !== 'sm' && <Chips value={hand.bet} className="bj-hand__bet" />}
        {hand.doubled && <span className="bj-tag">doubled</span>}
        {hand.fromSplit && size !== 'sm' && <span className="bj-tag">split</span>}
      </div>
    </div>
  );
}
