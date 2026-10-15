import { WS_PATH } from '@shared/platform/protocol';

/**
 * Where the game server is. Unset (dev, tests, one process serving everything): the page's own
 * origin. Set at build time when the site and the game server live on different hosts: the site
 * on Vercel's CDN and the server on one always-on Fly.io machine, which holds every room in one
 * place and keeps each WebSocket open all night (vercel.json sets it for production builds).
 */
const CONFIGURED = import.meta.env.VITE_GAME_SERVER;

type PageLocation = Pick<Location, 'protocol' | 'host'>;

/** The configured server, or null for the page's own origin. Anything unparseable or not http(s) counts as unset. */
export function gameServer(configured: string | undefined = CONFIGURED): URL | null {
  const raw = configured?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** The WebSocket address: wss:// when the server (or, without one configured, the page) is on https. */
export function wsUrl(configured: string | undefined = CONFIGURED, page: PageLocation = location): string {
  const server = gameServer(configured);
  const secure = (server ?? page).protocol === 'https:';
  return `${secure ? 'wss' : 'ws'}://${server ? server.host : page.host}${WS_PATH}`;
}

/** An /api path on the game server: relative (same origin) unless a server is configured. */
export function apiUrl(path: string, configured: string | undefined = CONFIGURED): string {
  const server = gameServer(configured);
  return server ? `${server.origin}${path}` : path;
}
