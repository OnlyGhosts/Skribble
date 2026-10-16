import { chipFigure, type StakeFormat } from './stakes';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

/**
 * The figure in a stack or a stake. `fit` writes both forms and the tile's width picks one
 * (table.css), so 1,040 never reads as "1k" on a tile with room for it.
 */
function Figure({ value, format, className }: { value: number; format: StakeFormat; className: string }) {
  const full = chipFigure(value, 'full');
  const short = chipFigure(value, 'short');
  if (format !== 'fit' || full === short) return <span className={className}>{chipFigure(value, format)}</span>;
  return (
    <span className={`${className} tbl-figure`}>
      <span className="tbl-figure__full">{full}</span>
      <span className="tbl-figure__short">{short}</span>
    </span>
  );
}

interface StackProps {
  value: number;
  format?: StakeFormat;
  className?: string;
  testId?: string;
}

/** A player's stack, in words: the figure large and bold, "chips" after it ("1,000 chips"). */
export function StackCount({ value, format = 'full', className, testId }: StackProps) {
  return (
    <span className={`tbl-stackcount${className ? ` ${className}` : ''}`} data-testid={testId} data-chips={value}>
      <Figure value={value} format={format} className="tbl-stackcount__value" /> <span className="tbl-stackcount__word">{value === 1 ? 'chip' : 'chips'}</span>
    </span>
  );
}

interface StakeProps {
  value: number;
  /** The word before the figure: "Bet", "Pot". */
  word?: string;
  format?: StakeFormat;
  /** `bet` (a stake in front of a player) or `pot` (the middle). */
  kind?: 'bet' | 'pot';
  className?: string;
  testId?: string;
  data?: DataAttrs;
}

/** A stake as its own labelled pill ("Bet 10"), never a bare number beside the stack. */
export function StakePill({ value, word = 'Bet', format = 'full', kind = 'bet', className, testId, data }: StakeProps) {
  return (
    <span className={`tbl-stake tbl-stake--${kind}${className ? ` ${className}` : ''}`} data-testid={testId} data-bet={value} {...data}>
      <span className="tbl-stake__word">{word}</span> <Figure value={value} format={format} className="tbl-stake__value" />
    </span>
  );
}
