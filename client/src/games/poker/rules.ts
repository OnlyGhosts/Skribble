/** Poker's How to play, written from the server's rules; every number is the shared constant. */
import { POKER_ACT_SECONDS } from '@shared/games/poker/protocol';
import { gameById } from '@shared/platform/games';
import type { GameRules } from '../../platform/game';
import { JOIN_MID_GAME_TEXT } from '../../platform/lib/rules';

export const pokerRules: GameRules = {
  unit: 'hand',
  summary: 'No-limit Texas Hold’em, best five of seven cards.',
  round: `Blinds rotate with the button; the big blind is twice the small. Two private cards each, then betting before the flop and after the flop, turn and river: fold, check, call, bet, raise or all in. After ${POKER_ACT_SECONDS} seconds you check or fold. Betting ends once everyone has matched or is all in.`,
  scoring: 'If everyone else folds, the last player takes the pot. Otherwise the best hand at the showdown wins; ties split.',
  end: 'Out of chips and you watch. It ends when one player has every chip, after the set hands, or at the host’s word. Most chips wins.',
  settings: 'Starting chips, the small blind, how often blinds double and how many hands to play.',
  watchers: `The table seats ${gameById('poker').maxPlayers}; extras wait for a seat. ${JOIN_MID_GAME_TEXT}`,
};
