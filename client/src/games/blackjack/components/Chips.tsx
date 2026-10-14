import { formatChips } from '../lib/text';
import { ChipIcon } from './Icons';

interface Props {
  value: number;
  className?: string;
  size?: number;
  testId?: string;
}

/** A chip count: the coin, then the number. */
export function Chips({ value, className, size = 14, testId }: Props) {
  return (
    <span className={`bj-chips${className ? ` ${className}` : ''}`} data-testid={testId} data-chips={value}>
      <ChipIcon size={size} className="bj-chips__coin" />
      <span className="bj-chips__value">{formatChips(value)}</span>
    </span>
  );
}
