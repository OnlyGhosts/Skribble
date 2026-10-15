/**
 * The colours a hand takes on a table: lit while in play, then a solid outline and pill in its
 * outcome's colour (lime win, gold blackjack, red loss or bust, grey push). No glow.
 */
export type Tone = 'neutral' | 'active' | 'bust' | 'win' | 'blackjack' | 'loss' | 'push';

/** The outline class for a hand or a seat in `tone` (table.css). */
export function outlineClass(tone: Tone): string {
  return `tbl-outline tbl-outline--${tone}`;
}

/** A total pill over a hand (or a hand's name), in the hand's tone; a long one ("10/20") is marked `data-long`. */
export function TotalPill({ tone, children, testId }: { tone: Tone; children: string; testId?: string }) {
  return (
    <span className={`tbl-pill tbl-pill--${tone}`} data-testid={testId} data-long={children.length > 3 || undefined}>
      {children}
    </span>
  );
}

/** The chips a hand took back ("+220") rising out of it and fading. Hidden from screen readers: the hand says it in words. */
export function PayoutFloat({ text, tone = 'win' }: { text: string; tone?: Tone }) {
  return (
    <span className={`tbl-payout tbl-payout--${tone}`} aria-hidden="true">
      {text}
    </span>
  );
}
