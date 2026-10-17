import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CLOSE_RESTARTING, WS_PATH } from '../../shared/platform/protocol.js';
import { createApp } from './app.js';
import { MemoryDriver } from './drivers/memory.js';
import { AVATAR } from './drivers/testUtils.js';

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function next(ws: WebSocket, t: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const on = (data: WebSocket.RawData): void => {
      const msg = JSON.parse(String(data)) as Record<string, unknown>;
      if (msg.t !== t) return;
      ws.off('message', on);
      resolve(msg);
    };
    ws.on('message', on);
  });
}

describe('a shutdown', () => {
  it('takes no new connections once it has begun, so a phone told to reconnect reaches the next server', async () => {
    const driver = new MemoryDriver({ checkpointKey: randomBytes(32) });
    const { server, shutdown } = createApp({ driver, serveStatic: false });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const url = `ws://127.0.0.1:${address.port}${WS_PATH}`;

    const host = await open(url);
    const welcome = next(host, 'welcome');
    host.send(JSON.stringify({ t: 'create', gameId: 'blackjack', name: 'Ann', avatar: AVATAR }));
    const { token, room } = (await welcome) as { token: string; room: { code: string } };
    const closed = new Promise<number>((resolve) => host.once('close', resolve));
    // A phone whose page is frozen never answers the close: the shutdown waits for it a while.
    const frozen = await open(url);
    (frozen as unknown as { _socket: { pause(): void } })._socket.pause();

    const done = shutdown();
    expect(await closed).toBe(CLOSE_RESTARTING);
    // The host's phone reconnects at once, as the client does after a restarting close: this
    // process, whose rooms are gone, must not answer it (it would say the game is gone).
    const again = await open(url).then(
      (ws) => {
        const answer = next(ws, 'error');
        ws.send(JSON.stringify({ t: 'rejoin', code: room.code, token }));
        return answer;
      },
      () => 'refused',
    );
    expect(again).toBe('refused');
    await done;
    frozen.terminate();
  });
});
