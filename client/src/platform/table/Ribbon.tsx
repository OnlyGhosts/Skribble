import type { ReactNode } from 'react';

interface Props {
  /** The table's main rule, on the banner ("Blackjack pays 3 to 2", "Blinds 5/10"). */
  main: ReactNode;
  /** The small line under it: the round or hand and a rule or the street ("Round 1 · Dealer stands on 17"). */
  sub?: ReactNode;
  /** Under that: the line that says whose turn it is (TurnLine), read out as it changes. */
  note?: ReactNode;
  testId?: string;
}

/**
 * The banner across the middle of the table: a low-contrast ribbon with folded ends carrying the
 * main rule, the round and a smaller rule under it, and whose turn it is under that.
 */
export function TableRibbon({ main, sub, note, testId = 'table-ribbon' }: Props) {
  return (
    <div className="tbl-ribbon" data-testid={testId}>
      <span className="tbl-ribbon__band">
        <span className="tbl-ribbon__main">{main}</span>
      </span>
      {sub && <span className="tbl-ribbon__sub">{sub}</span>}
      {note && (
        <div className="tbl-ribbon__note" role="status" aria-live="polite">
          {note}
        </div>
      )}
    </div>
  );
}
