/**
 * Test support for the restart tests: the real server as a child process (killed and started
 * again like a deploy or a crash would), and phones on real WebSockets that keep their seat and
 * the newest checkpoint and reconnect the way the client does.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { RESTORE_RETRY_MS } from '../../../shared/platform/constants.js';
import type { GameId } from '../../../shared/platform/games.js';
import { WS_PATH, isWireMessage, type RoomState, type WireMessage } from '../../../shared/platform/protocol.js';
import { AVATAR } from '../drivers/testUtils.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SERVER_ENTRY = 'server/index.ts';

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Polls `check` until it returns something other than undefined, null or false. */
export async function until<T>(what: string, check: () => T | undefined | null | false, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = check();
    if (out !== undefined && out !== null && out !== false) return out;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** From the kill to the exit. */
  ms: number;
}

/** `node server/index.ts` on a fixed port, as many times as a test starts it. */
export class ServerProcess {
  private child: ChildProcess | null = null;
  output = '';

  constructor(
    readonly port: number,
    private readonly key: string,
    /** Math.random always 0: Blackjack deals the ace of spades every time (and one room code only). */
    private readonly rngZero = false,
    /** More environment, such as REDIS_URL. */
    private readonly env: Record<string, string> = {},
  ) {}

  get url(): string {
    return `ws://127.0.0.1:${this.port}${WS_PATH}`;
  }

  async start(): Promise<void> {
    const entry = this.rngZero ? ['--input-type=module', '-e', `Math.random = () => 0; await import(${JSON.stringify(`./${SERVER_ENTRY}`)});`] : [SERVER_ENTRY];
    const child = spawn(process.execPath, ['--import', 'tsx', ...entry], {
      cwd: REPO_ROOT,
      env: { ...process.env, PORT: String(this.port), ROOM_CHECKPOINT_KEY: this.key, NODE_ENV: 'test', ...this.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.output = '';
    child.stdout?.on('data', (chunk: Buffer) => (this.output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (this.output += chunk.toString()));
    await until(`server on ${this.port}`, () => this.output.includes('listening on') || (child.exitCode !== null ? fail(this.output) : false), 20_000);
  }

  /** Sends `signal` and resolves once the process is gone. */
  stop(signal: NodeJS.Signals): Promise<Exit> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child?.exitCode ?? null, signal: child?.signalCode ?? null, ms: 0 });
    const at = Date.now();
    return new Promise((resolve) => {
      child.once('exit', (code, sig) => resolve({ code, signal: sig, ms: Date.now() - at }));
      child.kill(signal);
    });
  }
}

function fail(output: string): never {
  throw new Error(`server exited:\n${output}`);
}

export interface SeatInfo {
  code: string;
  token: string;
  playerId: string;
}

/**
 * One phone: a WebSocket plus what the client keeps across reconnects (its seat and the newest
 * checkpoint). Every message received is kept, per connection.
 */
export class Phone {
  private ws: WebSocket | null = null;
  messages: WireMessage[] = [];
  closeCodes: number[] = [];
  seat: SeatInfo | null = null;
  checkpoint: string | null = null;
  /** Checkpoints received, oldest first (a test may make a phone hold an older one). */
  checkpoints: string[] = [];

  constructor(readonly name: string) {}

  async connect(url: string): Promise<void> {
    const ws = new WebSocket(url);
    this.ws = ws;
    this.messages = [];
    ws.on('message', (data: Buffer) => {
      const msg: unknown = JSON.parse(data.toString());
      if (!isWireMessage(msg)) return;
      this.messages.push(msg);
      if (msg.t === 'welcome') {
        const room = msg.room as RoomState;
        this.seat = { code: room.code, token: String(msg.token), playerId: String(msg.playerId) };
      }
      if (msg.t === 'checkpoint' && typeof msg.checkpoint === 'string') {
        this.checkpoint = msg.checkpoint;
        this.checkpoints.push(msg.checkpoint);
      }
      // No longer a holder: the client drops what it held.
      if (msg.t === 'checkpoint' && msg.checkpoint === null) this.checkpoint = null;
    });
    ws.on('close', (code: number) => this.closeCodes.push(code));
    ws.on('error', () => undefined);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
  }

  send(msg: WireMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.terminate();
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** The room as this phone last saw it (welcome or snapshot). */
  get room(): RoomState | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.t === 'room' || m.t === 'welcome') return m.room as RoomState;
    }
    return null;
  }

  game<V>(): V {
    const game = this.room?.game;
    if (!game) throw new Error(`${this.name} sees no game`);
    return game as V;
  }

  get playerId(): string {
    if (!this.seat) throw new Error(`${this.name} holds no seat`);
    return this.seat.playerId;
  }

  errors(): WireMessage[] {
    return this.messages.filter((m) => m.t === 'error');
  }

  async waitFor(what: string, check: (room: RoomState) => boolean, timeoutMs = 10_000): Promise<RoomState> {
    return until(`${this.name}: ${what}`, () => {
      const room = this.room;
      return room !== null && check(room) ? room : undefined;
    }, timeoutMs);
  }

  /**
   * After a restart, as the client does it: rejoin; told the room is gone, send the checkpoint if
   * there is one, otherwise keep retrying the rejoin quietly. Resolves with the welcome's room.
   */
  async comeBack(url: string, checkpoint: string | null = this.checkpoint): Promise<RoomState> {
    const seat = this.seat;
    if (!seat) throw new Error(`${this.name} holds no seat`);
    await this.connect(url);
    const deadline = Date.now() + RESTORE_RETRY_MS;
    let restoring = false;
    for (;;) {
      const sent = this.messages.length;
      if (restoring) this.send({ t: 'restore', code: seat.code, token: seat.token, checkpoint: checkpoint ?? '' });
      else this.send({ t: 'rejoin', code: seat.code, token: seat.token });
      const answer = await until(`${this.name} answer`, () => this.messages.slice(sent).find((m) => m.t === 'welcome' || m.t === 'error'), 10_000);
      if (answer.t === 'welcome') return answer.room as RoomState;
      if (answer.roomGone !== true || Date.now() > deadline) throw new Error(`${this.name} could not come back: ${String(answer.message)}`);
      if (checkpoint !== null) restoring = true;
      else await sleep(300);
    }
  }
}

/** A room of phones on `url`: the first creates it for `gameId` with `settings`, the rest join and ready up. */
export async function seatRoom(url: string, gameId: GameId, names: string[], settings: Record<string, unknown> = {}): Promise<Phone[]> {
  const phones = names.map((n) => new Phone(n));
  await Promise.all(phones.map((p) => p.connect(url)));
  const [host, ...guests] = phones;
  host.send({ t: 'create', gameId, name: host.name, avatar: AVATAR });
  await until(`${host.name} welcome`, () => host.seat);
  const code = host.seat?.code ?? '';
  for (const g of guests) {
    g.send({ t: 'join', code, name: g.name, avatar: AVATAR });
    await until(`${g.name} welcome`, () => g.seat);
    g.send({ t: 'ready', ready: true });
  }
  if (Object.keys(settings).length > 0) host.send({ t: 'updateSettings', settings });
  await host.waitFor('everyone ready', (r) => r.players.filter((p) => p.ready).length === guests.length);
  return phones;
}
