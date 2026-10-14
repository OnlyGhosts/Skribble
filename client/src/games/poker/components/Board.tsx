import type { PlayingCardSize } from '../../../platform/components/PlayingCard';
import { PlayingCard } from '../../../platform/components/PlayingCard';
import { TableCard } from '../../../platform/table/TableCard';
import { boardOnScreen, sameCard, winningCards } from '../lib/screen';
import type { PokerTable } from '../lib/table';
import type { Timeline } from '../lib/timeline';

interface Props {
  table: PokerTable | null;
  timeline: Timeline;
  now: number;
  leaving: boolean;
  size: PlayingCardSize;
}

/** The community cards in the centre: five places, empty slots until the board comes out; the cards that win lifted at the end. */
export function Board({ table, timeline, now, leaving, size }: Props) {
  const places = boardOnScreen(table, timeline, now);
  const best = winningCards(table, timeline, now);
  const shown = places.filter((p) => p !== null).length;
  return (
    <section className="pk-board" role="group" aria-label="Community cards" data-testid="board" data-street={table?.street ?? ''} data-cards={shown}>
      {places.map((place, i) =>
        place ? (
          <TableCard
            key={`${timeline.id}:${place.key}`}
            card={place.card}
            size={size}
            motion={place.motion}
            leaving={leaving}
            flipping={place.flipping}
            highlight={place.card !== null && best.some((b) => place.card !== null && sameCard(b, place.card))}
            testId="community-card"
          />
        ) : (
          <PlayingCard key={`slot-${i}`} card={null} size={size} slot testId="community-slot" />
        ),
      )}
    </section>
  );
}
