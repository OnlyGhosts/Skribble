import { useMediaQuery } from '../lib/media';
import { tileTier } from './grid';

/** A phone this short (an SE, a phone on its side) packs the table tight whatever its size. */
export const SHORT_PHONE_QUERY = '(max-height: 680px)';
/** A phone this short (360x740 and the like) packs a table of five or more others tight. */
export const MID_PHONE_QUERY = '(max-height: 780px)';

/**
 * Whether the table packs tight: the spotlight in one row, so the players keep the height (a
 * game may pack more). Blackjack's dealer and my hands never move: they keep their own fixed rows
 * whatever this says. A short phone always does; a
 * shorter phone once the tiles go compact (five or more others); any phone, and a desktop too,
 * once the table has ten or more other players.
 */
export function isTight(isPhone: boolean, short: boolean, others: number, mid = false): boolean {
  const tier = others > 0 ? tileTier(others) : null;
  if (tier === 'small' || tier === 'dense') return true;
  if (!isPhone) return false;
  return short || (mid && tier === 'compact');
}

export function useTightStage(isPhone: boolean, others: number): boolean {
  const short = useMediaQuery(SHORT_PHONE_QUERY);
  const mid = useMediaQuery(MID_PHONE_QUERY);
  return isTight(isPhone, short, others, mid);
}
