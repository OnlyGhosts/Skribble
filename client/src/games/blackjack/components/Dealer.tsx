import type { BlackjackView } from '@shared/games/blackjack/protocol';
import { dealerTotalLabel, formatChips } from '../lib/text';
import { PlayingCard } from '../../../platform/components/PlayingCard';

interface Props {
  view: BlackjackView;
  size: 'md' | 'lg';
}

/** The house: its cards (the hole card face down until the dealer acts), the total it shows and the shoe. */
export function Dealer({ view, size }: Props) {
  const { dealer } = view;
  const dealt = dealer.cards.length > 0;
  return (
    <section className="bj-dealer card" aria-label="Dealer" data-testid="dealer-hand" data-hole-hidden={dealer.holeHidden} data-total={dealer.total} data-cards={dealer.cards.length}>
      <div className="bj-dealer__head">
        <span className="bj-dealer__title">Dealer</span>
        {dealt && (
          <span className={`bj-total${dealer.total > 21 && !dealer.holeHidden ? ' bj-total--bust' : ''}`} data-testid="dealer-total">
            {dealerTotalLabel(dealer)}
          </span>
        )}
        <span className="bj-dealer__shoe" data-testid="shoe" data-remaining={view.shoeRemaining}>
          {view.reshuffled && (
            <span className="pill pill--accent bj-dealer__reshuffled" data-testid="reshuffled">
              Reshuffled
            </span>
          )}
          <span>{formatChips(view.shoeRemaining)} in the shoe</span>
        </span>
      </div>
      <div className="bj-hand__cards bj-dealer__cards">
        {dealt ? (
          <>
            {dealer.cards.map((card, i) => (
              <PlayingCard key={`${i}-${card.rank}${card.suit}`} card={card} size={size} testId="dealer-card" />
            ))}
            {dealer.holeHidden && <PlayingCard card={null} size={size} testId="dealer-card" />}
          </>
        ) : (
          <>
            <PlayingCard card={null} size={size} testId="dealer-slot" slot />
            <PlayingCard card={null} size={size} testId="dealer-slot" slot />
          </>
        )}
      </div>
    </section>
  );
}
