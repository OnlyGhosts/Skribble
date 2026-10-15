/**
 * The game registry: every game the site offers, in library order. Adding a game means adding a
 * GameId, a GameMeta entry here, a server module (server/games) and a client module (client/src/games).
 */
export type GameId = 'skribble' | 'spygame' | 'quipgame' | 'hangman' | 'battleships' | 'blackjack' | 'poker' | 'template';

export type GameStatus = 'live' | 'soon' | 'hidden';

export interface GameMeta {
  id: GameId;
  /** URL segment. Lowercase letters only and never 4 characters long, so it can never collide with a room code. */
  slug: string;
  /** Slugs the game used before a rename: old links on them redirect to `slug` (same rules as `slug`). */
  formerSlugs?: readonly string[];
  name: string;
  /** The rules in a few short lines (plain copy, no taglines). */
  howToPlay: string[];
  minPlayers: number;
  /** Seats the game can hold at once, or null when any number may play. Extra players sit a game out and stay in the party. */
  maxPlayers: number | null;
  /**
   * The game's 24px line glyph (branding/pocket-party/assets/icons): SVG path data for a 24x24
   * viewBox, drawn with a 1.8px round stroke in currentColor on the lobby tile and the game's header.
   */
  glyph: string;
  /** Accent colour (#rrggbb), the same as `--game-<id>` in tokens.css: icon plates and decorations, always with ink on top. */
  accent: string;
  /** Whether the game reads `settings.contentMode`; the lobby only offers Family / Unhinged for these. */
  contentModes: boolean;
  /** 'hidden' games are never offered in the lobby picker but a party can start on one through '/?game=slug' (development, tests). */
  status: GameStatus;
}

export const GAME_LIST: readonly GameMeta[] = [
  {
    id: 'skribble',
    slug: 'scribble',
    formerSlugs: ['skribble'],
    name: 'Scribble',
    howToPlay: [
      'Everyone takes turns drawing a word of their choice.',
      'Guess in the chat: the faster you guess, the more points you score.',
      'Letters are revealed as hints while the clock runs down.',
      'The drawer scores for every player who guesses the word.',
    ],
    minPlayers: 2,
    maxPlayers: null,
    glyph: 'M5 19l2-6L17 3l4 4L11 17z M14 6l4 4 M4 21h7',
    accent: '#a699d5',
    contentModes: true,
    status: 'live',
  },
  {
    id: 'spygame',
    slug: 'spygame',
    name: 'The Spy Game',
    howToPlay: [
      'Everyone except the spy sees the secret location on their phone.',
      'Take turns asking each other questions about the place without giving it away.',
      'Agents accuse a suspect and vote; a passed vote is the group\'s one guess for the round.',
      'The spy wins by guessing the location from the 24 candidates within two tries.',
      'Time runs out? The agents win the round.',
    ],
    minPlayers: 3,
    maxPlayers: null,
    glyph: 'M4 11h16M7 10l2-6h6l2 6 M5 15h5v4H5z M14 15h5v4h-5z M10 16h4',
    accent: '#86cdba',
    contentModes: true,
    status: 'live',
  },
  {
    id: 'quipgame',
    slug: 'quipgame',
    name: 'Quip Game',
    howToPlay: [
      'Each round you get two prompts; write a quick, funny answer to each on your phone.',
      'Answers go head to head: everyone except the two writers votes for the funnier one.',
      'Points follow the votes; take every vote in a matchup for a flawless bonus.',
      'Round two counts double, and the final round pits everyone against one prompt.',
    ],
    minPlayers: 3,
    maxPlayers: null,
    glyph: 'M4 5h16v11H9l-5 4z M8 10h.1M12 10h.1M16 10h.1',
    accent: '#f1c777',
    contentModes: true,
    status: 'live',
  },
  {
    id: 'hangman',
    slug: 'hangman',
    name: 'Hangman',
    howToPlay: [
      'The hangman picks a word from three choices or types their own.',
      'Guessers take turns: name a letter, or risk the whole word.',
      'A right letter scores for the guesser; a wrong one scores for the hangman, who then draws the next piece.',
      'Guess the word for a big bonus; a wrong word guess puts you out for that word.',
      'Ten wrong guesses complete the figure and the hangman wins the word.',
    ],
    minPlayers: 2,
    maxPlayers: null,
    glyph: 'M3 21h12M7 21V3h12v4 M16 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M18 11v5m-3-3h6m-3 3-3 4m3-4 3 4',
    accent: '#f2a08b',
    contentModes: true,
    status: 'live',
  },
  {
    id: 'battleships',
    slug: 'battleships',
    name: 'Battleships',
    howToPlay: [
      'Place your ships on your grid before the clock runs out, or let the game place them for you.',
      'Each turn you roll the die, then fire or move.',
      'Fire: pick an opponent and a square. Miss, hit or sunk, everyone hears about it.',
      'Move: shift one of your ships up to the roll in a straight line, or turn it. Nobody sees where it went.',
      'You can\'t move two turns in a row. A fleet with every ship sunk is out, and the last one floating wins.',
    ],
    minPlayers: 2,
    maxPlayers: null,
    glyph: 'M3 15h18l-4 5H7z M8 15V8h8v7 M11 8V4h3',
    accent: '#88c7ea',
    contentModes: false,
    status: 'live',
  },
  {
    id: 'blackjack',
    slug: 'blackjack',
    name: 'Blackjack',
    howToPlay: [
      'Bet any amount each round, from 1 chip up to your whole stack. Everyone starts with the same stack.',
      'No bet when the clock runs out? You sit that hand out and keep your chips.',
      'Hit to take a card, stand to stop. Over 21 and the hand is bust.',
      'Double your bet for exactly one more card, or split a pair into two hands (up to four).',
      'The dealer draws to 17. Beat the dealer to win your bet back twice over; a natural blackjack pays extra.',
      'Run out of chips and you watch. Play goes on until one player has chips left, or the host ends the game.',
    ],
    minPlayers: 1,
    maxPlayers: null,
    glyph: 'M5 3h14v18H5z M9 8l3-3 3 3-3 3z M9 16h6',
    accent: '#86d9a3',
    contentModes: false,
    status: 'live',
  },
  {
    id: 'poker',
    slug: 'poker',
    name: 'Poker',
    howToPlay: [
      'Everyone starts with the same stack of chips; the blinds rotate with the dealer button.',
      'You get two private cards. Fold, check, call, bet or raise as the five community cards come out.',
      'A betting round ends once every player still in has matched the highest bet or is all in.',
      'If only one player is left, they take the pot. Otherwise the best five cards out of seven win the showdown.',
      'Run out of chips and you watch; the most chips at the end wins.',
    ],
    minPlayers: 2,
    maxPlayers: 23,
    glyph: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20 M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12 M12 2v4m10 6h-4m-6 10v-4M2 12h4',
    accent: '#e7a1cb',
    contentModes: false,
    status: 'live',
  },
  {
    id: 'template',
    slug: 'template',
    name: 'Click Race',
    howToPlay: ['Tap the big button as fast as you can.', 'The first player to reach the target wins 100 points.', 'Everyone else scores one point per tap when the race ends.'],
    minPlayers: 1,
    maxPlayers: null,
    glyph: 'M9 11V5a2 2 0 0 1 4 0v6 M13 10a2 2 0 0 1 4 0v2 M17 11a2 2 0 0 1 4 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3l-3-5a2 2 0 0 1 3-2l2 2',
    accent: '#c7e976',
    contentModes: false,
    status: 'hidden',
  },
];

const BY_ID = new Map<GameId, GameMeta>(GAME_LIST.map((g) => [g.id, g]));
const BY_SLUG = new Map<string, GameMeta>(GAME_LIST.map((g) => [g.slug, g]));

export function gameById(id: GameId): GameMeta {
  const meta = BY_ID.get(id);
  if (!meta) throw new Error(`unknown game ${id}`);
  return meta;
}

export function gameBySlug(slug: string): GameMeta | undefined {
  return BY_SLUG.get(slug);
}

const BY_FORMER_SLUG = new Map<string, GameMeta>(GAME_LIST.flatMap((g) => (g.formerSlugs ?? []).map((slug) => [slug, g] as const)));

/** The game an old slug (from before a rename) belongs to, so its links can redirect to the current one. */
export function gameByFormerSlug(slug: string): GameMeta | undefined {
  return BY_FORMER_SLUG.get(slug);
}

export function isGameSlug(s: string): boolean {
  return BY_SLUG.has(s);
}

export function isGameId(s: string): s is GameId {
  return BY_ID.has(s as GameId);
}

export const GAME_IDS: readonly GameId[] = GAME_LIST.map((g) => g.id);
