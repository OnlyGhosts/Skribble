/**
 * What the cross-game test suites (engine determinism, platform room behaviour, the harnesses)
 * need to know about each game. Keyed by GameId on purpose: a new game fails `npm run typecheck`
 * until it is added here, instead of failing a runtime assertion written for another game.
 */
import { gameById, type GameId } from '../../shared/platform/games.js';
import type { WireMessage } from '../../shared/platform/protocol.js';

export interface GameTestFixture {
  /** Settings that make the game deterministic and short; the harnesses apply them before `start`. */
  settings: Record<string, unknown>;
  /** Settings under which a three-player game is still running RECONNECT_GRACE_MS (60 s) after it started. */
  longSettings: Record<string, unknown>;
  /** A message the game accepts from the host (the first player) right after `start`. */
  validMessage: WireMessage;
}

/** Ten custom words so `customWordsOnly` is honoured; with rng () => 0 they are picked in this order. */
export const TEST_WORDS = ['apple', 'banana', 'cherry', 'dragon', 'eagle', 'falcon', 'guitar', 'hammer', 'island', 'jacket'];

export const GAME_TEST_FIXTURES: Readonly<Record<GameId, GameTestFixture>> = {
  skribble: {
    settings: { customWords: TEST_WORDS, customWordsOnly: true, rounds: 1, drawTime: 60, hints: 2, wordChoices: 3 },
    longSettings: { drawTime: 180 },
    validMessage: { t: 'chooseWord', index: 0 },
  },
  spygame: {
    settings: { rounds: 1, roundMinutes: 3, voteSeconds: 15 },
    longSettings: { roundMinutes: 15 },
    // With rng () => 0 the host is round one's spy, 'airplane' is the location and 'beach' a decoy: a wrong first guess.
    validMessage: { t: 'guess', locationId: 'beach' },
  },
  template: {
    settings: {},
    longSettings: { timeLimit: 120 },
    validMessage: { t: 'click' },
  },
};

/** Extra seats the cross-game suites add so a scenario written for two players also starts a game with a higher minimum. */
const FILLER_NAMES = ['Fay', 'Gus', 'Hal', 'Ivy', 'Jem', 'Kit', 'Lou', 'Max', 'Ned', 'Oli'];

/** `names` padded with filler players up to the game's minPlayers, so startGame can start it. */
export function enoughNames(gameId: GameId, names: string[]): string[] {
  const missing = gameById(gameId).minPlayers - names.length;
  return missing > 0 ? [...names, ...FILLER_NAMES.slice(0, missing)] : names;
}
