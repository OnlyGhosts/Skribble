import { WS_PATH } from '../shared/protocol.js';
import { createApp } from '../server/app.js';
import { createDriverFromEnv } from '../server/drivers/select.js';

/**
 * Vercel Function entry. Exporting the http.Server (never calling listen) lets Vercel route both
 * HTTP requests and WebSocket upgrades to it. vercel.json rewrites /ws and /api/* here and the
 * function sees the original URL, so the upgrade is accepted on both paths. Static files come
 * from dist/client through Vercel's CDN, not from this function.
 *
 * Instances are many and short-lived (a connection is cut at the function's max duration), so
 * rooms must live in Redis: REDIS_URL (or KV_URL) comes from a Marketplace Redis store.
 */
const log = (msg: string): void => console.log(`[skribble] ${msg}`);

const driver = createDriverFromEnv({ log, expectRedis: true });
const { server } = createApp({ driver, log, serveStatic: false, wsPaths: [WS_PATH, '/api/server'] });

export default server;
