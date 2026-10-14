import type { PokerPotView } from '@shared/games/poker/protocol';
import { ChipIcon } from '../../../platform/components/Chips';
import { formatChips } from '../lib/text';
import { POT_ANCHOR } from '../lib/timeline';

interface Props {
  /** The chips in the middle on show. */
  shown: number;
  /** The chips in the middle in truth. */
  truth: number;
  /** The pots so far: side pots are listed small under the pill. */
  pots: PokerPotView[];
}

/** The pot pill over the board, with any side pots listed small under it. */
export function Pot({ shown, truth, pots }: Props) {
  const sides = pots.length > 1 ? pots : [];
  return (
    <div className="pk-pot">
      <span className={`pk-pot__pill${shown > 0 ? '' : ' is-empty'}`} data-table-anchor={POT_ANCHOR} data-testid="pot" data-chips={truth} data-shown={shown} aria-label={`Pot ${shown} chips`}>
        <span className="pk-pot__label">Pot</span>
        <ChipIcon size={14} className="chip-count__coin" />
        <span className="pk-pot__value">{formatChips(shown)}</span>
      </span>
      {sides.length > 0 && (
        <ul className="pk-pot__sides" aria-label="Pots" data-testid="pots">
          {sides.map((pot, i) => (
            <li key={i} className="pk-pot__side" data-testid="side-pot" data-amount={pot.amount} data-players={pot.playerIds.join(',')}>
              {i === 0 ? 'Main' : `Side ${i}`} {formatChips(pot.amount)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
