import { describe, expect, it } from 'vitest';
import { apiUrl, gameServer, wsUrl } from './server';

const https = { protocol: 'https:', host: 'theboredgames.vercel.app' };
const http = { protocol: 'http:', host: 'localhost:5173' };

describe('the game server address', () => {
  it('is the page itself when nothing is configured', () => {
    expect(gameServer('')).toBeNull();
    expect(gameServer('   ')).toBeNull();
    expect(wsUrl('', https)).toBe('wss://theboredgames.vercel.app/ws');
    expect(wsUrl('', http)).toBe('ws://localhost:5173/ws');
    expect(apiUrl('/api/rooms/AB2K', '')).toBe('/api/rooms/AB2K');
  });

  it('is the configured server when the site and the server are on different hosts', () => {
    const server = 'https://boredgames-io.fly.dev';
    expect(wsUrl(server, https)).toBe('wss://boredgames-io.fly.dev/ws');
    // An http page still talks wss to an https server, and a trailing slash or path is ignored.
    expect(wsUrl(`${server}/`, http)).toBe('wss://boredgames-io.fly.dev/ws');
    expect(apiUrl('/api/rooms/AB2K', `${server}/`)).toBe('https://boredgames-io.fly.dev/api/rooms/AB2K');
    expect(wsUrl('http://localhost:3001', https)).toBe('ws://localhost:3001/ws');
  });

  it('falls back to the page for anything that is not an http(s) origin', () => {
    for (const bad of ['boredgames-io.fly.dev', 'wss://boredgames-io.fly.dev', 'not a url']) {
      expect(gameServer(bad), bad).toBeNull();
      expect(wsUrl(bad, https), bad).toBe('wss://theboredgames.vercel.app/ws');
    }
  });
});
