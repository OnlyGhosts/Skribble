/** The dealer button: a small "D" disc on the dealer's seat. */
export function DealerButton({ testId = 'dealer-button' }: { testId?: string }) {
  return (
    <span className="pk-dealer" title="Dealer" aria-label="Dealer" data-testid={testId}>
      D
    </span>
  );
}
