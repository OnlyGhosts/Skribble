import { WS_PATH } from '../shared/protocol';
import { createApp } from './app';
import { createDriverFromEnv } from './drivers/select';

/**
 * Standalone entry (`npm start`, the Dockerfile, `npm run dev`): one process serving the client,
 * /api and /ws. Rooms live in memory unless REDIS_URL (or KV_URL) points at a Redis, in which case
 * any number of these processes can share the rooms.
 */
const PORT = Number(process.env.PORT ?? 3001);
const log = (msg: string): void => console.log(`[skribble] ${msg}`);

const driver = createDriverFromEnv({ log });
const { server, shutdown } = createApp({ driver, log });

server.listen(PORT, () => {
  log(`listening on http://localhost:${PORT} (ws at ${WS_PATH})`);
});

let shuttingDown = false;
function stop(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received, shutting down`);
  shutdown()
    .then(() => {
      log('closed');
      process.exit(0);
    })
    .catch((err: unknown) => {
      log(`shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
  // Force exit if lingering connections keep the server alive.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
