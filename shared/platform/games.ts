/**
 * The game registry: every game the site offers, in library order. Adding a game means adding a
 * GameId, a GameMeta entry here, a server module (server/games) and a client module (client/src/games,
 * whose rules.ts is the one place the game's How to play copy lives).
 */
export type GameId = 'scribble' | 'spygame' | 'quipgame' | 'blackjack' | 'poker' | 'template';

export type GameStatus = 'live' | 'soon' | 'hidden';

export type ScoreUnit = 'points' | 'chips';

export interface GameMeta {
  id: GameId;
  /** URL segment. Lowercase letters only and never 4 characters long, so it can never collide with a room code. */
  slug: string;
  /** Slugs the game used before a rename: old links on them redirect to `slug` (same rules as `slug`). */
  formerSlugs?: readonly string[];
  /**
   * Ids the game had before a rename. Clients loaded before it, rooms stored before it and sessions
   * saved before it still carry them; `upgradeGameId` reads each as `id`.
   */
  formerIds?: readonly string[];
  name: string;
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
  /** What a score counts: points, or chips for a card table (its score is the stack). Points when absent. */
  scoreUnit?: ScoreUnit;
  /** 'hidden' games are never offered in the lobby picker but a party can start on one through '/?game=slug' (development, tests). */
  status: GameStatus;
}

export const GAME_LIST: readonly GameMeta[] = [
  {
    id: 'scribble',
    slug: 'scribble',
    // The pre-rename slug and id: old links, old clients, stored rooms and saved sessions carry them.
    formerSlugs: ['skribble'],
    formerIds: ['skribble'],
    name: 'Scribble',
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
    minPlayers: 3,
    maxPlayers: null,
    glyph: 'M4 5h16v11H9l-5 4z M8 10h.1M12 10h.1M16 10h.1',
    accent: '#f1c777',
    contentModes: true,
    status: 'live',
  },
  {
    id: 'blackjack',
    slug: 'blackjack',
    name: 'Blackjack',
    minPlayers: 1,
    maxPlayers: null,
    glyph: 'M5 3h14v18H5z M9 8l3-3 3 3-3 3z M9 16h6',
    accent: '#86d9a3',
    contentModes: false,
    scoreUnit: 'chips',
    status: 'live',
  },
  {
    id: 'poker',
    slug: 'poker',
    name: 'Poker',
    minPlayers: 2,
    maxPlayers: 23,
    glyph: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20 M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12 M12 2v4m10 6h-4m-6 10v-4M2 12h4',
    accent: '#e7a1cb',
    contentModes: false,
    scoreUnit: 'chips',
    status: 'live',
  },
  {
    id: 'template',
    slug: 'template',
    name: 'Click Race',
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

const BY_FORMER_ID = new Map<string, GameId>(GAME_LIST.flatMap((g) => (g.formerIds ?? []).map((id) => [id, g.id] as const)));

/**
 * The current id for a game id from the wire or from storage: a current id as it is, a former one
 * (from before a rename) as the id it became, anything else null.
 */
export function upgradeGameId(id: string): GameId | null {
  return isGameId(id) ? id : (BY_FORMER_ID.get(id) ?? null);
}

export const GAME_IDS: readonly GameId[] = GAME_LIST.map((g) => g.id);
