/**
 * Routes without a router library: '/' the library, '/:slug' a game's home, '/:slug/:CODE' a room
 * (join link while outside, the room itself while inside), '/:CODE' a legacy bare code that the
 * app resolves through the room preview. Slugs are never four characters long, so a single
 * segment is always one or the other.
 */
import { create } from 'zustand';
import { gameById, gameBySlug, type GameId, type GameMeta } from '@shared/platform/games';
import { isValidRoomCode, normalizeRoomCode } from '@shared/platform/roomCode';

export type Route =
  | { kind: 'library' }
  | { kind: 'game'; game: GameMeta; code: string | null }
  /** A bare code: the game is unknown until the preview answers. */
  | { kind: 'code'; code: string }
  | { kind: 'unknown'; path: string };

function asCode(segment: string): string | null {
  const code = normalizeRoomCode(segment);
  return isValidRoomCode(code) ? code : null;
}

export function parseRoute(pathname: string, search = ''): Route {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    const fromQuery = new URLSearchParams(search).get('room');
    const code = fromQuery ? asCode(fromQuery) : null;
    return code ? { kind: 'code', code } : { kind: 'library' };
  }
  const game = gameBySlug(segments[0].toLowerCase());
  if (game) {
    if (segments.length === 1) return { kind: 'game', game, code: null };
    const code = asCode(segments[1]);
    return code && segments.length === 2 ? { kind: 'game', game, code } : { kind: 'unknown', path: pathname };
  }
  const code = segments.length === 1 ? asCode(segments[0]) : null;
  return code ? { kind: 'code', code } : { kind: 'unknown', path: pathname };
}

/** The room code a route names, if any. */
export function routeCode(route: Route): string | null {
  return route.kind === 'game' || route.kind === 'code' ? route.code : null;
}

function slugOf(game: GameMeta | GameId): string {
  return typeof game === 'string' ? gameById(game).slug : game.slug;
}

export function gamePath(game: GameMeta | GameId): string {
  return `/${slugOf(game)}`;
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
