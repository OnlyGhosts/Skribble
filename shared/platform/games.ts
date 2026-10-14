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
  name: string;
  tagline: string;
  description: string;
  howToPlay: string[];
  minPlayers: number;
  /** Seats the game can hold at once, or null when any number may play. Extra players sit a game out and stay in the party. */
  maxPlayers: number | null;
  /** Emoji shown on the library card. */
  icon: string;
  /** Accent colour (#rrggbb) for the card tile and the game's screens. */
  accent: string;
  /** 'hidden' games never show in the library but stay reachable at /:slug (development, tests). */
  status: GameStatus;
}

export const GAME_LIST: readonly GameMeta[] = [
  {
    id: 'skribble',
    slug: 'skribble',
    name: 'Skribble',
    tagline: 'Draw it, guess it, laugh about it.',
    description: 'One player draws a secret word while everyone else races to guess it. Fast guesses score more, and clear drawings earn the artist points too.',
    howToPlay: [
      'Everyone takes turns drawing a word of their choice.',
      'Guess in the chat: the faster you guess, the more points you score.',
      'Letters are revealed as hints while the clock runs down.',
      'The drawer scores for every player who guesses the word.',
    ],
    minPlayers: 2,
    maxPlayers: null,
    icon: '✏️',
    accent: '#6366f1',
    status: 'live',
  },
  {
    id: 'spygame',
    slug: 'spygame',
    name: 'The Spy Game',
    tagline: 'Find the spy before the spy finds the location.',
    description:
      'Everyone is at the same secret location except one player: the spy. Ask each other questions out loud to sniff out who is bluffing, while the spy listens for clues and tries to guess where you all are.',
    howToPlay: [
      'Everyone except the spy sees the secret location on their phone.',
      'Take turns asking each other questions about the place without giving it away.',
      'Agents accuse a suspect and vote; a passed vote is the group\'s one guess for the round.',
      'The spy wins by guessing the location from the 24 candidates within two tries.',
      'Time runs out? The agents win the round.',
    ],
    minPlayers: 3,
    maxPlayers: null,
    icon: '🕵️',
    accent: '#0f766e',
    status: 'live',
  },
  {
    id: 'quipgame',
    slug: 'quipgame',
    name: 'Quip Game',
    tagline: 'Write the funniest answer. Win the room.',
    description:
      'Everyone gets two silly prompts and types the funniest answer they can. Answers go head to head, the room votes for the best one, and the biggest laughs score the most points. No TV needed: it all happens on your phones.',
    howToPlay: [
      'Each round you get two prompts; write a quick, funny answer to each on your phone.',
      'Answers go head to head: everyone except the two writers votes for the funnier one.',
      'Points follow the votes; take every vote in a matchup for a flawless bonus.',
      'Round two counts double, and the final round pits everyone against one prompt.',
    ],
    minPlayers: 3,
    maxPlayers: null,
    icon: '💬',
    accent: '#f59e0b',
    status: 'live',
  },
  {
    id: 'hangman',
    slug: 'hangman',
    name: 'Hangman',
    tagline: 'Guess the word before the drawing is done.',
    description:
      'One player picks a secret word and the others take turns guessing letters. Every wrong guess lets the hangman draw one more piece of the figure, their way: the classic gallows is only a faint template. Solve the word before the drawing is finished.',
    howToPlay: [
      'The hangman picks a word from three choices or types their own.',
      'Guessers take turns: name a letter, or risk the whole word.',
      'A right letter scores for the guesser; a wrong one scores for the hangman, who then draws the next piece.',
      'Guess the word for a big bonus; a wrong word guess puts you out for that word.',
      'Ten wrong guesses complete the figure and the hangman wins the word.',
    ],
    minPlayers: 2,
    maxPlayers: null,
    icon: '🪢',
    accent: '#b45309',
    status: 'live',
  },
  {
    id: 'battleships',
    slug: 'battleships',
    name: 'Battleships',
    tagline: 'Hunt the fleets. Last one floating wins.',
    description:
      'Hide your fleet on a grid, then take turns calling shots at everyone else. Play every player for themselves or in two teams sharing one board, and roll the dice after each shot for a chance to slip an undamaged ship into new waters. The last fleet afloat wins.',
    howToPlay: [
      'Place your ships on your grid before the clock runs out, or let the game place them for you.',
      'On your turn pick an opponent and a cell: miss, hit or sunk, and everyone hears about it.',
      'Roll a 5 or 6 after your shot and you may secretly slide an undamaged ship one cell.',
      'A fleet with every ship sunk is out; the last player or team floating wins.',
    ],
    minPlayers: 2,
    maxPlayers: 8,
    icon: '🚢',
    accent: '#0369a1',
    status: 'live',
  },
  {
    id: 'blackjack',
    slug: 'blackjack',
    name: 'Blackjack',
    tagline: 'Beat the house without going bust.',
    description:
      'Everyone plays against the house with a stack of chips. Bet, draw towards 21 without going over, and watch the dealer turn over the hole card. The biggest stack after the last round wins the table.',
    howToPlay: [
      'Place a bet each round; the host decides how many chips everyone starts with.',
      'Hit to take a card, stand to stop. Over 21 and the hand is bust.',
      'Double your bet for exactly one more card, or split a pair into two hands.',
      'The dealer draws to 17. Beat the dealer to win your bet back twice over; a natural blackjack pays extra.',
      'Run out of chips and you sit out; the most chips after the last round wins.',
    ],
    minPlayers: 1,
    maxPlayers: 7,
    icon: '🃏',
    accent: '#15803d',
    status: 'live',
  },
  {
    id: 'poker',
    slug: 'poker',
    name: 'Poker',
    tagline: "Texas Hold'em on your phones.",
    description:
      "No-limit Texas Hold'em around one table: two private cards each, five shared on the board, blinds that rotate with the button. Bet, raise, bluff or fold; the best five-card hand at the showdown takes the pot, and the biggest stack at the end wins.",
    howToPlay: [
      'Everyone starts with the same stack of chips; the blinds rotate with the dealer button.',
      'You get two private cards. Fold, check, call, bet or raise as the five community cards come out.',
      'A betting round ends once every player still in has matched the highest bet or is all in.',
      'If only one player is left, they take the pot. Otherwise the best five cards out of seven win the showdown.',
      'Run out of chips and you watch; the most chips at the end wins.',
    ],
    minPlayers: 2,
    maxPlayers: 9,
    icon: '♠️',
    accent: '#b91c1c',
    status: 'live',
  },
  {
    id: 'template',
    slug: 'template',
    name: 'Click Race',
    tagline: 'Tap faster than your friends.',
    description: 'The simplest possible game: everyone taps a button and the first to reach the target wins. It exists to prove the platform contract and as the copy base for new games.',
    howToPlay: ['Tap the big button as fast as you can.', 'The first player to reach the target wins 100 points.', 'Everyone else scores one point per tap when the race ends.'],
    minPlayers: 1,
    maxPlayers: null,
    icon: '👆',
    accent: '#f59e0b',
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

export function isGameSlug(s: string): boolean {
  return BY_SLUG.has(s);
}

export function isGameId(s: string): s is GameId {
  return BY_ID.has(s as GameId);
}

export const GAME_IDS: readonly GameId[] = GAME_LIST.map((g) => g.id);
