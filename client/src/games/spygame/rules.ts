/** The Spy Game's How to play, written from the server's rules; every number is the shared constant. */
import {
  SPYGAME_CANDIDATES,
  SPYGAME_GUESSES,
  SPYGAME_POINTS as P,
  SPYGAME_ROUND_MINUTES,
  SPYGAME_SETTINGS_LIMITS as L,
  SPYGAME_VOTE_SECONDS,
} from '@shared/games/spygame/protocol';
import type { GameRules } from '../../platform/game';
import { JOIN_MID_GAME_TEXT } from '../../platform/lib/rules';

export const spygameRules: GameRules = {
  summary: 'Find the spy before they find the place.',
  round: `Each round has one spy. The others see the place, the spy only ${SPYGAME_CANDIDATES} candidates. Quiz each other for ${SPYGAME_ROUND_MINUTES} minutes without giving it away. An agent can accuse once a round: the clock pauses while the other agents vote (${SPYGAME_VOTE_SECONDS} seconds at most; no vote counts as No) and a tie fails. The spy has ${SPYGAME_GUESSES} guesses.`,
  scoring: `The spy names the place: ${P.spyFirstGuess} points (${P.spySecondGuess} on the second guess). Wrong person voted out: ${P.wrongAccusation} to the spy. Spy caught, wrong twice or time up: ${P.agentWin} to each agent, plus ${P.accuserBonus} to the accuser.`,
  end: 'After the last round, or when the host ends it. Most points wins.',
  settings: `Rounds (${L.rounds.min} to ${L.rounds.max}). Unhinged mode plays adult places.`,
  watchers: `Miss a round’s start and you watch. ${JOIN_MID_GAME_TEXT}`,
};
