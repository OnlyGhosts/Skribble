import type { ReactNode } from 'react';

interface Props {
  /** The table's main rule, on the banner ("Blackjack pays 3 to 2"); shown in capitals. */
  main: string;
  /** A smaller rule under it ("Dealer stands on 17"). */
  sub?: string;
  /** A short line under the banner: whose turn it is. */
  note?: ReactNode;
  testId?: string;
}

/**
 * The banner across the middle of the table: a low-contrast ribbon with folded ends carrying the
 * main rule in bold capitals, a smaller rule under it, and whose turn it is under that.
 */
export function TableRibbon({ main, sub, note, testId = 'table-ribbon' }: Props) {
  return (
    <div className="tbl-ribbon" data-testid={testId}>
      <span className="tbl-ribbon__band">
        <span className="tbl-ribbon__main">{main}</span>
      </span>
      {sub && <span className="tbl-ribbon__sub">{sub}</span>}
      {note}
    </div>
  );
}
