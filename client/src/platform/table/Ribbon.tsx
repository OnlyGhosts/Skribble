/** The line printed across the middle of the felt, in the mono label style: the table's main rule and a smaller one under it. */
export function TableRibbon({ main, sub, testId = 'table-ribbon' }: { main: string; sub?: string; testId?: string }) {
  return (
    <div className="tbl-ribbon" data-testid={testId}>
      <span className="tbl-ribbon__main">{main}</span>
      {sub && <span className="tbl-ribbon__sub">{sub}</span>}
    </div>
  );
}
