/** Blackjack's How to play, written from the table rules; every number is the shared constant. */
import { BLACKJACK, DEALER_STANDS_AT, NATURAL_PAYOUT } from '@shared/games/blackjack/cards';
import { BLACKJACK_SETTINGS_LIMITS as L } from '@shared/games/blackjack/protocol';
import type { GameRules } from '../../platform/game';
import { thousands } from '../../platform/lib/format';
import { JOIN_MID_GAME_TEXT } from '../../platform/lib/rules';

export const blackjackRules: GameRules = {
  unit: 'hand',
  summary: `Beat the dealer without going over ${BLACKJACK}.`,
  round: `Bet 1 chip to your whole stack, or sit out. Cards go out once all have bet. Ace or ten up, the dealer checks for blackjack, which ends the hand. Then hit, stand, double your first two cards for one more, or split a pair (again while chips last; split aces get one card). Over ${BLACKJACK} busts. The dealer draws to ${DEALER_STANDS_AT - 1} and stands on every ${DEALER_STANDS_AT}.`,
  scoring: `Beat the dealer to win your bet; blackjack pays ${NATURAL_PAYOUT.wins} to ${NATURAL_PAYOUT.stake}, rounded down. A tie returns your bet. A bust loses even if the dealer busts.`,
  end: 'Out of chips, you watch. It ends with one stack left, or none, or at the host’s word, after the hand. Most chips wins.',
  settings: `Starting chips (${thousands(L.startingChips.min)} to ${thousands(L.startingChips.max)}).`,
  watchers: JOIN_MID_GAME_TEXT,
};
