/** Scribble's How to play, written from the server's rules; every number is the shared constant. */
import { CHOOSE_TIME_SECONDS } from '@shared/games/scribble/constants';
import { SCRIBBLE_DRAW_SECONDS, SCRIBBLE_SETTINGS_LIMITS as L } from '@shared/games/scribble/protocol';
import { drawerPoints, guesserPoints } from '@shared/games/scribble/scoring';
import type { GameRules } from '../../platform/game';
import { JOIN_MID_GAME_TEXT } from '../../platform/lib/rules';

export const scribbleRules: GameRules = {
  summary: 'Draw a word and guess everyone else’s.',
  round: `Everyone draws once per round. The drawer picks a word (${CHOOSE_TIME_SECONDS} seconds, else the first) and draws it in ${SCRIBBLE_DRAW_SECONDS} seconds while the others type guesses. Hints appear as the clock runs. The turn ends when everyone has guessed or time is up.`,
  scoring: `A right guess earns ${guesserPoints(1, 1)} points straight away, sliding to ${guesserPoints(0, 1)} at the last second. The drawer earns up to ${drawerPoints(1, 1)}, scaled by how many guessers got it.`,
  end: 'After the last round, or when the host ends it. Most points wins.',
  settings: `Rounds (${L.rounds.min} to ${L.rounds.max}), hints per word (${L.hints.min} to ${L.hints.max}, at most half the letters) and words to choose from (${L.wordChoices.min} to ${L.wordChoices.max}). Custom words join the list, or replace it with ${L.customWords.minForOnly} or more. Unhinged mode plays adult words.`,
  watchers: JOIN_MID_GAME_TEXT,
};
