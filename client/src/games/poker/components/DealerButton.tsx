/** The dealer button: a small "D" disc next to the dealer's name. */
export function DealerButton({ testId = 'dealer-button' }: { testId?: string }) {
  return (
    <span className="pk-dealer" title="Dealer" aria-label="Dealer" data-testid={testId}>
      D
    </span>
  );
}
