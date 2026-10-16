import { formatChips } from '../lib/format';

/** A few card backs stacked with a small offset: the deck. */
function Stack({ count }: { count: number }) {
  return (
    <span className="tbl-stack" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="tbl-stack__card" style={{ transform: `translate(${i * 2}px, ${-i * 2}px)` }}>
          <span className="playing-card__back" />
        </span>
      ))}
    </span>
  );
}

interface DeckProps {
  /** Cards left (said to a screen reader; shown under a deck in a grid cell); an endless deck (Blackjack's) leaves it out. */
  remaining?: number;
  /** What the deck is called to a screen reader: "shoe", "deck". */
  name: string;
  testId: string;
  /** Tucked into the table's top right corner, peeking down from its top edge, rather than in a grid cell. */
  corner?: boolean;
}

/** The deck (Blackjack's shoe), top right: the cards fly out of it. */
export function Deck({ remaining, name, testId, corner = false }: DeckProps) {
  const label = remaining === undefined ? `The ${name}` : `${remaining} cards in the ${name}`;
  return (
    <div className={`tbl-deck${corner ? ' tbl-deck--corner' : ''}`} data-testid={testId} data-remaining={remaining} aria-label={label} role="img">
      <span className="tbl-deck__stack" data-table-deck="">
        <Stack count={3} />
      </span>
      {remaining !== undefined && !corner && <span className="tbl-deck__count">{formatChips(remaining)}</span>}
    </div>
  );
}

/**
 * Where the cards go on a calm table with no tray on it: just past its top left corner, so a
 * round's cards sweep off the edge of the felt. Nothing is drawn; the count stays as data.
 */
export function DiscardCorner({ discarded }: { discarded: number }) {
  return <span className="tbl-discard-corner" data-testid="discard-tray" data-discarded={discarded} data-table-discard="" aria-hidden="true" />;
}
