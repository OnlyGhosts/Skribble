import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from './app.js';
import { MemoryDriver } from './drivers/memory.js';

/** The client build in a directory whose path contains a dot-directory segment (a `.claude/worktrees/...` checkout, say). */
const root = mkdtempSync(path.join(tmpdir(), 'bored-games-'));
const clientDir = path.join(root, '.hidden', 'dist', 'client');
const INDEX_HTML = '<!doctype html><title>Bored Games</title><div id="root"></div>';

let app: App;
let baseUrl = '';

beforeAll(async () => {
  mkdirSync(clientDir, { recursive: true });
  writeFileSync(path.join(clientDir, 'index.html'), INDEX_HTML);
  writeFileSync(path.join(clientDir, 'app.js'), 'console.log("hi")');
  app = createApp({ driver: new MemoryDriver(), clientDir });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.shutdown();
  rmSync(root, { recursive: true, force: true });
});

describe('static client with an SPA fallback', () => {
  it('serves index.html for every app route, even from a checkout under a dot-directory', async () => {
    for (const route of ['/', '/skribble', '/template/AB2K', '/AB2K']) {
      const res = await fetch(`${baseUrl}${route}`);
      expect(res.status, route).toBe(200);
      expect(await res.text(), route).toBe(INDEX_HTML);
    }
    expect((await fetch(`${baseUrl}/skribble`)).headers.get('cache-control')).toBe('no-cache');
  });

  it('serves assets as files and answers 404 for a missing asset or API path', async () => {
    expect(await (await fetch(`${baseUrl}/app.js`)).text()).toBe('console.log("hi")');
    expect((await fetch(`${baseUrl}/missing.png`)).status).toBe(404);
    const api = await fetch(`${baseUrl}/api/nope`);
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: 'not found' });
  });

  it('answers the health check and the room preview', async () => {
    expect(await (await fetch(`${baseUrl}/api/health`)).json()).toMatchObject({ ok: true });
    expect(await (await fetch(`${baseUrl}/api/rooms/AB2K`)).json()).toMatchObject({ exists: false });
  });
});
