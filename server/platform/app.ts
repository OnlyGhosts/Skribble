import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer } from 'ws';
import { MAX_WS_MESSAGE_BYTES } from '../../shared/platform/constants.js';
import { ROOM_PREVIEW_PATH, WS_PATH } from '../../shared/platform/protocol.js';
import { asSocketLike, handleConnection } from './connection.js';
import { after, type GameDriver } from './drivers/types.js';

export interface AppOptions {
  driver: GameDriver;
  log?: (msg: string) => void;
  /** Serve the client build with an SPA fallback (off on Vercel, where the CDN serves the client). */
  serveStatic?: boolean;
  /** Where the client build lives; defaults to dist/client under the working directory. */
  clientDir?: string;
  /** Request paths that accept the WebSocket upgrade; defaults to WS_PATH. */
  wsPaths?: string[];
}

export interface App {
  app: Express;
  server: Server;
  wss: WebSocketServer;
  /** Closes every socket, the driver and the listener. */
  shutdown: () => Promise<void>;
}

/** Routing, static files, health, room previews and the WebSocket upgrade shared by every entry point. */
export function createApp(options: AppOptions): App {
  const { driver } = options;
  const log = options.log ?? (() => undefined);
  const wsPaths = options.wsPaths ?? [WS_PATH];

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  // Handlers return the driver's promise (if any) so Express 5 routes a rejection to its error handler.
  app.get('/api/health', (_req: Request, res: Response) =>
    after(driver.health(), (health) => {
      res.json({ ok: true, ...health });
    }),
  );

  app.get(`${ROOM_PREVIEW_PATH}/:code`, (req: Request<{ code: string }>, res: Response) =>
    after(driver.preview(req.params.code), (preview) => {
      res.json(preview);
    }),
  );

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  if (options.serveStatic ?? true) {
    const clientDir = options.clientDir ?? path.resolve(process.cwd(), 'dist/client');
    if (existsSync(path.join(clientDir, 'index.html'))) {
      app.use(express.static(clientDir, { index: 'index.html', maxAge: '1h' }));
      // SPA fallback so share links such as https://host/skribble/XK4P load the app.
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (req.path.startsWith('/api') || wsPaths.some((p) => req.path.startsWith(p))) return next();
        if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next(); // missing asset, not a route
        res.setHeader('Cache-Control', 'no-cache');
        // `root` keeps the path relative: an absolute path would make sendFile apply its dotfiles
        // policy to every directory on the way and 404 from a checkout under a dot-directory.
        res.sendFile('index.html', { root: clientDir, dotfiles: 'allow' });
      });
      log(`serving client from ${clientDir}`);
    } else {
      log('no client build found in dist/client; API + WebSocket only (use Vite for the client)');
    }
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_BYTES });

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!wsPaths.includes(pathname)) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(asSocketLike(ws), { driver, log });
    });
  });

  const shutdown = async (): Promise<void> => {
    await driver.shutdown();
    for (const client of wss.clients) client.close(1001, 'Server shutting down');
    wss.close();
    await new Promise<void>((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
  };

  return { app, server, wss, shutdown };
}
