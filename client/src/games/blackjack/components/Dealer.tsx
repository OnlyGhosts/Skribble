import type { CSSProperties } from 'react';
import type { Card } from '@shared/games/blackjack/protocol';
import { PlayingCard, type PlayingCardSize } from '../../../platform/components/PlayingCard';
import { TotalPill } from '../../../platform/table/Outcome';
import { TableCard } from '../../../platform/table/TableCard';
import { dealerKey, shownTotal, totalText, type TableModel } from '../lib/table';
import { cardMotion, cardShown, holeFaceDown, holeFlipping, landed, type Timeline } from '../lib/timeline';

interface Props {
  table: TableModel | null;
  timeline: Timeline;
  now: number;
  leaving: boolean;
  size: PlayingCardSize;
}

/** The dealer's cards as they stand at `now`: the hole card face down until it turns over; `landed` once in its slot. */
export function dealerOnScreen(table: TableModel | null, timeline: Timeline, now: number) {
  const cards: { key: string; card: Card | null; flipping: boolean; landed: boolean }[] = [];
  (table?.dealer ?? []).forEach((card, i) => {
    const key = dealerKey(i);
    if (!cardShown(timeline, key, now)) return;
    const down = card === null || (i === 1 && holeFaceDown(timeline, now));
    cards.push({ key, card: down ? null : card, flipping: i === 1 && !down && holeFlipping(timeline, now), landed: landed(timeline, key, now) });
  });
  return cards;
}

/**
 * The house, always in the same place: the top of the table, the same size through every phase.
 * The total sits beside the cards (the "Dealer" label before the deal), and the cards fan out to
 * the right from a fixed spot, so a draw never moves the cards already down.
 */
export function Dealer({ table, timeline, now, leaving, size }: Props) {
  const cards = dealerOnScreen(table, timeline, now);
  const holeHidden = cards.some((c) => c.card === null);
  // The total counts a card once it lands, not while it slides in.
  const total = shownTotal(cards.filter((c) => c.landed).map((c) => c.card));
  const blackjack = !holeHidden && cards.length === 2 && total?.total === 21;
  const tone = total && total.total > 21 ? 'bust' : blackjack ? 'blackjack' : 'neutral';
  return (
    <section className="bj-dealer" aria-label="Dealer" data-testid="dealer-area" style={{ '--fan': Math.max(2, cards.length) } as CSSProperties}>
      <div className="bj-hand bj-hand--big bj-dealer__hand" data-testid="dealer-hand" data-hole-hidden={holeHidden} data-total={total?.total ?? 0} data-cards={cards.length} data-settled={table?.settled ?? false}>
        <div className="bj-hand__top">
          {total ? (
            <TotalPill tone={tone} testId="dealer-total">
              {totalText(total, holeHidden)}
            </TotalPill>
          ) : (
            <span className="bj-dealer__label">Dealer</span>
          )}
        </div>
        <div className="bj-hand__cards bj-dealer__cards">
          {cards.length > 0 ? (
            cards.map(({ key, card, flipping }) => <TableCard key={`${timeline.id}:${key}`} card={card} size={size} motion={cardMotion(timeline, key, now)} leaving={leaving} flipping={flipping} testId="dealer-card" />)
          ) : (
            <>
              <PlayingCard card={null} size={size} slot testId="dealer-slot" />
              <PlayingCard card={null} size={size} slot testId="dealer-slot" />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
