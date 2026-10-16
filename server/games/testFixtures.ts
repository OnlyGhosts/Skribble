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
  /**
   * The longest game the settings allow: with two seats above the minimum it is still running
   * RECONNECT_GRACE_MS (10 min) after it started, where the game's limits permit that at all
   * (Click Race caps out at two minutes).
   */
  longSettings: Record<string, unknown>;
  /** A message the game accepts from the host (the first player) right after `start`. */
  validMessage: WireMessage;
  /** For a game that never ends on its own clock (Blackjack's rounds never run out): the host's message that ends it. */
  hostEnd?: WireMessage;
}

/** Ten custom words so `customWordsOnly` is honoured; with rng () => 0 they are picked in this order. */
export const TEST_WORDS = ['apple', 'banana', 'cherry', 'dragon', 'eagle', 'falcon', 'guitar', 'hammer', 'island', 'jacket'];

export const GAME_TEST_FIXTURES: Readonly<Record<GameId, GameTestFixture>> = {
  skribble: {
    settings: { customWords: TEST_WORDS, customWordsOnly: true, rounds: 1, hints: 2, wordChoices: 3 },
    longSettings: { rounds: 10 },
    validMessage: { t: 'chooseWord', index: 0 },
  },
  spygame: {
    settings: { rounds: 1 },
    longSettings: { rounds: 10 },
    // With rng () => 0 the host is round one's spy, 'airplane' is the location and 'beach' a decoy: a wrong first guess.
    validMessage: { t: 'guess', locationId: 'beach' },
  },
  quipgame: {
    // The clocks are fixed and every game ends with the final round: there is nothing to shorten or lengthen.
    settings: {},
    longSettings: {},
    // With rng () => 0 the shuffled writing order ends with the host, who therefore writes prompt r1-p0.
    validMessage: { t: 'answer', promptId: 'r1-p0', text: 'banana' },
  },
  blackjack: {
    // The endless deck: rng () => 0 deals the ace of spades every time. No clocks, and the rounds never run out.
    settings: { startingChips: 1000 },
    longSettings: { startingChips: 100_000 },
    // The round opens with betting; any stake up to the stack is allowed.
    validMessage: { t: 'bet', amount: 10 },
    // The bets wait for idle players, so only the host ends it.
    hostEnd: { t: 'endGame' },
  },
  poker: {
    // One hand (the clocks are fixed): rng () => 0 gives the host the button, so they act first preflop (heads-up and three-handed alike).
    settings: { startingChips: 1000, smallBlind: 5, blindsIncreaseEvery: 0, hands: 1 },
    longSettings: { startingChips: 100_000, smallBlind: 1, blindsIncreaseEvery: 0, hands: 0 },
    validMessage: { t: 'call' },
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
