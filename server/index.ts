import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer } from 'ws';
import { MAX_WS_MESSAGE_BYTES } from '../shared/constants';
import { ROOM_PREVIEW_PATH, WS_PATH, type RoomPreview } from '../shared/protocol';
import { normalizeRoomCode } from '../shared/roomCode';
import { SocketHub, asSocketLike, handleConnection } from './connection';
import { RoomManager } from './roomManager';

const PORT = Number(process.env.PORT ?? 3001);
const log = (msg: string): void => console.log(`[skribble] ${msg}`);

const hub = new SocketHub();
const rooms = new RoomManager({ transport: hub });

const app = express();
app.disable('x-powered-by');
app.set('etag', false);

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, ...rooms.stats() });
});

app.get(`${ROOM_PREVIEW_PATH}/:code`, (req: Request<{ code: string }>, res: Response) => {
  const found = rooms.lookup(req.params.code);
  const preview: RoomPreview = found.ok
    ? {
        exists: true,
        code: found.room.code,
        players: found.room.playerCount,
        maxPlayers: found.room.settings.maxPlayers,
        inProgress: found.room.inProgress,
        joinable: found.room.isJoinable,
      }
    : { exists: false, code: normalizeRoomCode(req.params.code), reason: found.code };
  res.json(preview);
});

app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'not found' });
});

const clientDir = path.resolve(process.cwd(), 'dist/client');
const clientIndex = path.join(clientDir, 'index.html');
if (existsSync(clientIndex)) {
  app.use(express.static(clientDir, { index: 'index.html', maxAge: '1h' }));
  // SPA fallback so share links such as https://host/XK4P load the app.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith(WS_PATH)) return next();
    if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next(); // missing asset, not a route
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(clientIndex);
  });
  log(`serving client from ${clientDir}`);
} else {
  log('no client build found in dist/client; API + WebSocket only (use Vite for the client)');
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: MAX_WS_MESSAGE_BYTES });

wss.on('connection', (ws) => {
  handleConnection(asSocketLike(ws), { hub, rooms, log });
});

server.listen(PORT, () => {
  log(`listening on http://localhost:${PORT} (ws at ${WS_PATH})`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received, shutting down`);
  rooms.destroy();
  for (const client of wss.clients) client.close(1001, 'Server shutting down');
  wss.close();
  server.close(() => {
    log('closed');
    process.exit(0);
  });
  // Force exit if lingering connections keep the server alive.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
