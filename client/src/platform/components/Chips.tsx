import { formatChips } from '../lib/format';
import { Icon, type IconProps } from './Icons';

/** A casino chip: the coin in front of every chip count. */
export const ChipIcon = (p: IconProps) => <Icon {...p} paths={['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M12 3v5M12 16v5M3 12h5M16 12h5']} />;

interface Props {
  value: number;
  className?: string;
  size?: number;
  testId?: string;
}

/** A chip count (cards.css): the coin, then the number. */
export function Chips({ value, className, size = 14, testId }: Props) {
  return (
    <span className={`chip-count${className ? ` ${className}` : ''}`} data-testid={testId} data-chips={value}>
      <ChipIcon size={size} className="chip-count__coin" />
      <span className="chip-count__value">{formatChips(value)}</span>
    </span>
  );
}
