import { Children, isValidElement, type CSSProperties, type ReactNode } from 'react';
import { TotalPill, type Tone } from './Outcome';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface Props {
  /** The hand's colour: lit while in play, then its outcome (an outline on every card and the pill). */
  tone: Tone;
  /** The total (or the hand's name) in the pill over the top right corner; null before a card lands. */
  total: string | null;
  totalTestId?: string;
  /** In words, left of the pill: how the hand ended ("Win +20"). */
  flag?: ReactNode;
  /** In words inside the pill, before the total, where there is no room beside it. */
  lead?: ReactNode;
  /** Laid over the hand: the payout rising out of it. */
  float?: ReactNode;
  /** `big`: a hand on its own place on the table; `mini`: on a seat, the pill beside the cards. */
  size?: 'big' | 'mini';
  /** The cards (TableCards or slots), left to right. */
  children: ReactNode;
  label: string;
  className?: string;
  testId: string;
  data?: DataAttrs;
}

/**
 * A hand as a stepped fan (table.css): each card a little right of and below the one before, its
 * rank and suit left in view, the total in a pill over the top right corner. The fan keeps one
 * height however many cards it holds (the step shrinks past four), so a hit never moves the table.
 */
export function HandFan({ tone, total, totalTestId, flag, lead, float, size = 'big', children, label, className, testId, data }: Props) {
  const cards = Children.toArray(children);
  const style = { '--fan': Math.max(2, cards.length) } as CSSProperties;
  return (
    <div role="group" className={`tbl-hand tbl-hand--${size} tbl-hand--${tone}${lead && total !== null ? ' tbl-hand--lead' : ''}${className ? ` ${className}` : ''}`} style={style} aria-label={label} data-testid={testId} data-tone={tone} {...data}>
      <div className="tbl-hand__head">
        {flag}
        {total !== null && (
          <TotalPill tone={tone} testId={totalTestId} lead={lead}>
            {total}
          </TotalPill>
        )}
      </div>
      <div className="tbl-fan">
        {cards.map((card, i) => (
          <span key={isValidElement(card) && card.key !== null ? card.key : i} className="tbl-fan__card" style={{ '--i': i } as CSSProperties}>
            {card}
          </span>
        ))}
      </div>
      {float}
    </div>
  );
}

/** The outcome in words beside the pill: "Win +20", "Bust", "Push"; `testId` on the word alone. */
export function OutcomeFlag({ tone, word, extra, testId }: { tone: Tone; word: string; extra?: string; testId?: string }) {
  return (
    <span className={`tbl-flag tbl-flag--${tone}`}>
      <span data-testid={testId}>{word}</span>
      {extra ? ` ${extra}` : ''}
    </span>
  );
}
