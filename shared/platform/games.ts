/**
 * The game registry: every game the site offers, in library order. Adding a game means adding a
 * GameId, a GameMeta entry here, a server module (server/games) and a client module (client/src/games).
 */
export type GameId = 'skribble' | 'template';

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
  maxPlayers: number;
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
    maxPlayers: 20,
    icon: '✏️',
    accent: '#6366f1',
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
    maxPlayers: 20,
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
