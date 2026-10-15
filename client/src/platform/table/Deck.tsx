import { formatChips } from '../lib/format';

/** A few card backs stacked with a small offset: the deck and the discard pile. */
function Stack({ count }: { count: number }) {
  return (
    <span className="tbl-stack" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="tbl-stack__card" style={{ transform: `translate(${i * 2}px, ${-i * 2}px)` }} />
      ))}
    </span>
  );
}

interface DeckProps {
  /** Cards left, shown under the stack; an endless deck (Blackjack's) leaves it out. */
  remaining?: number;
  /** What the deck is called to a screen reader: "shoe", "deck". */
  name: string;
  testId: string;
}

/** The deck (Blackjack's shoe), top right: the cards fly out of it. */
export function Deck({ remaining, name, testId }: DeckProps) {
  const label = remaining === undefined ? `The ${name}` : `${remaining} cards in the ${name}`;
  return (
    <div className="tbl-deck" data-testid={testId} data-remaining={remaining} aria-label={label} role="img">
      <span className="tbl-deck__stack" data-table-deck="">
        <Stack count={3} />
      </span>
      {remaining !== undefined && <span className="tbl-deck__count">{formatChips(remaining)}</span>}
    </div>
  );
}

/** The discard tray (Poker's muck), top left: where the cards go when they leave the table. */
export function DiscardTray({ discarded, label = 'Discards' }: { discarded: number; label?: string }) {
  return (
    <div className="tbl-discard" data-testid="discard-tray" data-discarded={discarded} aria-label={label} role="img">
      <span className="tbl-discard__slot" data-table-discard="">
        {discarded > 0 && <Stack count={Math.min(3, Math.ceil(discarded / 20))} />}
      </span>
    </div>
  );
}
