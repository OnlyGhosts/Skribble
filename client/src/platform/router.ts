/**
 * Routes without a router library. '/' is the front door (join a room or create one); a room code
 * on the address bar, as '/:slug/:CODE' (the invite link and the in-room URL), the legacy '/:CODE'
 * or '/?room=CODE', opens the front door with the code filled in; '/:slug' alone (the old per-game
 * landing pages) redirects to '/', since a game is picked inside the room. '/?game=slug' makes
 * Create start the party on that game (hidden games included: development and tests). Slugs are
 * never four characters long, so a single segment is always one or the other.
 */
import { create } from 'zustand';
import { gameById, gameBySlug, type GameId, type GameMeta } from '@shared/platform/games';
import { isValidRoomCode, normalizeRoomCode } from '@shared/platform/roomCode';

export type Route =
  /** The front door, with a room code from the link when there is one, and the game Create starts on when '?game=' names one. */
  | { kind: 'home'; code: string | null; game: GameMeta | null }
  /** '/:slug': redirected to '/'. */
  | { kind: 'game'; game: GameMeta }
  | { kind: 'unknown'; path: string };

function asCode(segment: string): string | null {
  const code = normalizeRoomCode(segment);
  return isValidRoomCode(code) ? code : null;
}

export function parseRoute(pathname: string, search = ''): Route {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    const query = new URLSearchParams(search);
    const fromQuery = query.get('room');
    const gameSlug = query.get('game');
    return { kind: 'home', code: fromQuery ? asCode(fromQuery) : null, game: gameSlug ? (gameBySlug(gameSlug.toLowerCase()) ?? null) : null };
  }
  const game = gameBySlug(segments[0].toLowerCase());
  if (game) {
    if (segments.length === 1) return { kind: 'game', game };
    // Codes are one namespace across games: the slug in a link is informational only.
    const code = asCode(segments[1]);
    return code && segments.length === 2 ? { kind: 'home', code, game: null } : { kind: 'unknown', path: pathname };
  }
  const code = segments.length === 1 ? asCode(segments[0]) : null;
  return code ? { kind: 'home', code, game: null } : { kind: 'unknown', path: pathname };
}

/** The room code a route names, if any. */
export function routeCode(route: Route): string | null {
  return route.kind === 'home' ? route.code : null;
}

function slugOf(game: GameMeta | GameId): string {
  return typeof game === 'string' ? gameById(game).slug : game.slug;
}

export function roomPath(game: GameMeta | GameId, code: string): string {
  return `/${slugOf(game)}/${code}`;
}

export function inviteLink(game: GameMeta | GameId, code: string): string {
  return `${window.location.origin}${roomPath(game, code)}`;
}

function currentRoute(): Route {
  return parseRoute(window.location.pathname, window.location.search);
}

interface RouterState {
  route: Route;
}

export const useRouter = create<RouterState>()(() => ({ route: currentRoute() }));

export function currentPath(): string {
  return window.location.pathname + window.location.search;
}

/** Publishes what the address bar says now (after a navigate() or a Back/Forward). */
export function refreshRoute(): void {
  useRouter.setState({ route: currentRoute() });
}

/** Changes the address bar (a new history entry unless `replace`) and publishes the new route. */
export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (currentPath() !== path) {
    if (opts.replace) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
  }
  refreshRoute();
}

export function codeFromLocation(): string | null {
  return routeCode(currentRoute());
}

/** Follows the back/forward buttons. Returns the unsubscribe. */
export function startRouter(): () => void {
  window.addEventListener('popstate', refreshRoute);
  return () => window.removeEventListener('popstate', refreshRoute);
}
