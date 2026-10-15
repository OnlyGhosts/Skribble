import { useMediaQuery } from '../lib/media';
import { tileTier } from './grid';

/** A phone this short (an SE, a phone on its side) packs the table tight whatever its size. */
export const SHORT_PHONE_QUERY = '(max-height: 680px)';

/**
 * Whether a phone's table packs tight: the spotlight in one row, and (Blackjack) the dealer and
 * my hand side by side in the top row, so the players keep the height. A short phone always does;
 * a taller one once the table has ten or more other players.
 */
export function isTight(isPhone: boolean, short: boolean, others: number): boolean {
  if (!isPhone) return false;
  return short || (others > 0 && tileTier(others) !== 'full' && tileTier(others) !== 'compact');
}

export function useTightStage(isPhone: boolean, others: number): boolean {
  const short = useMediaQuery(SHORT_PHONE_QUERY);
  return isTight(isPhone, short, others);
}
