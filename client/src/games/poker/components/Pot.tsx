import type { PokerPotView } from '@shared/games/poker/protocol';
import { StakePill } from '../../../platform/table/Stakes';
import { formatChips } from '../lib/text';
import { POT_ANCHOR } from '../lib/timeline';

interface Props {
  /** The chips in the middle on show. */
  shown: number;
  /** The chips in the middle in truth. */
  truth: number;
  /** The pots so far: side pots are listed small beside the pill. */
  pots: PokerPotView[];
}

/** Past this many chips the pot reads short ("Pot 12.5k"), so it keeps beside the board on the smallest phones. */
const SHORT_POT = 10_000;

/** The pot over the board as its own pill ("Pot 120"), with any side pots listed small beside it. */
export function Pot({ shown, truth, pots }: Props) {
  const sides = pots.length > 1 ? pots : [];
  return (
    <div className="pk-pot">
      <StakePill value={shown} word="Pot" kind="pot" format={shown >= SHORT_POT ? 'short' : 'full'} className={`pk-pot__pill${shown > 0 ? '' : ' is-empty'}`} testId="pot" data={{ 'data-chips': truth, 'data-shown': shown, 'data-table-anchor': POT_ANCHOR }} />
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
