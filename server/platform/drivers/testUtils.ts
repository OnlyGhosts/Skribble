/** Room-level test harness: a memory Room over a FakeTransport, for either game, driven by fake timers. */
import { expect } from 'vitest';
import { isSkribbleWelcomeExtra, type CanvasAction, type SkribbleClientMessage, type SkribblePhase, type SkribblePlayerView, type SkribbleView } from '../../../shared/games/skribble/protocol.js';
import type { TemplateClientMessage, TemplateView } from '../../../shared/games/template/protocol.js';
import type { Avatar } from '../../../shared/platform/avatar.js';
import type { GameId } from '../../../shared/platform/games.js';
import { isPlatformMessageType } from '../../../shared/platform/protocol.js';
import { createCanvasStore } from '../../games/skribble/canvas.js';
import { GAME_TEST_FIXTURES, TEST_WORDS } from '../../games/testFixtures.js';
import type { PlatformPlayerData } from '../engine/state.js';
import { MemoryStorage } from '../storage.js';
import type { Rng, Transport } from '../transport.js';
import { Room, type RoomDeps } from './room.js';
import type { AnyServerMessage, AnyServerMessageOf } from './testSocket.js';
import type { OutboundMessage, PlatformRoomMessage, RoomInbound } from './types.js';

/** Records everything a room sends, per player, as deep copies taken at send time. */
export class FakeTransport implements Transport {
  readonly sent = new Map<string, AnyServerMessage[]>();
  readonly attached: Array<{ playerId: string; connectionId: string }> = [];
  readonly closed: string[] = [];

  attach(playerId: string, connectionId: string): void {
    this.attached.push({ playerId, connectionId });
  }

  send(playerId: string, msg: OutboundMessage): void {
    const list = this.sent.get(playerId);
    const copy = structuredClone(msg) as AnyServerMessage;
    if (list) list.push(copy);
    else this.sent.set(playerId, [copy]);
  }

  close(playerId: string): void {
    this.closed.push(playerId);
  }

  of(playerId: string): AnyServerMessage[] {
    return this.sent.get(playerId) ?? [];
  }

  ofType<T extends AnyServerMessage['t']>(playerId: string, t: T): AnyServerMessageOf<T>[] {
    return this.of(playerId).filter((m): m is AnyServerMessageOf<T> => m.t === t);
  }

  last<T extends AnyServerMessage['t']>(playerId: string, t: T): AnyServerMessageOf<T> {
    const list = this.ofType(playerId, t);
    const msg = list[list.length - 1];
    if (!msg) throw new Error(`no '${t}' message for ${playerId}`);
    return msg;
  }

  chats(playerId: string): Array<{ kind: string; text: string }> {
    return this.ofType(playerId, 'chat').map((m) => ({ kind: m.message.kind, text: m.message.text }));
  }

  errors(playerId: string): string[] {
    return this.ofType(playerId, 'error').map((m) => m.code);
  }

  clear(): void {
    this.sent.clear();
    this.attached.length = 0;
    this.closed.length = 0;
  }
}

export { TEST_WORDS };

export const AVATAR: Avatar = { color: 0, emoji: 0 };

type Inbound = PlatformRoomMessage | SkribbleClientMessage | TemplateClientMessage;

export interface Harness {
  room: Room;
  transport: FakeTransport;
  storage: MemoryStorage;
  join: (name: string, connectionId?: string) => string;
  /** Sends a platform or game message as `playerId`. */
  send: (playerId: string, msg: Inbound) => void;
  player: (playerId: string) => PlatformPlayerData;
  score: (playerId: string) => number;
  token: (playerId: string) => string;
  /** Skribble's per-player turn state as the spectator view shows it. */
  turnState: (playerId: string) => SkribblePlayerView;
  /** The Skribble canvas as a joiner would receive it. */
  canvas: () => CanvasAction[];
  /** The canvas a player received in their last welcome. */
  welcomeCanvas: (playerId: string) => CanvasAction[];
  emptied: Room[];
}

export function toInbound(msg: Inbound): RoomInbound {
  return isPlatformMessageType(msg.t) ? { kind: 'platform', msg: msg as PlatformRoomMessage } : { kind: 'game', msg };
}

export function createHarness(opts: { gameId?: GameId; rng?: Rng; code?: string; deps?: Partial<RoomDeps> } = {}): Harness {
  const transport = new FakeTransport();
  const storage = new MemoryStorage();
  const emptied: Room[] = [];
  const code = opts.code ?? 'ABCD';
  const room = new Room(code, opts.gameId ?? 'skribble', {
    transport,
    storage,
    clock: { now: () => Date.now() },
    rng: opts.rng ?? (() => 0),
    onEmpty: (r) => emptied.push(r),
    ...opts.deps,
  });
  const canvasStore = createCanvasStore(storage);
  const player = (id: string): PlatformPlayerData => {
    const p = room.getPlayer(id);
    if (!p) throw new Error(`no player ${id}`);
    return p;
  };
  const h: Harness = {
    room,
    transport,
    storage,
    emptied,
    join(name, connectionId = `conn-${name}`) {
      const result = room.join(name, AVATAR, connectionId);
      if (!result.ok) throw new Error(`join failed: ${result.code}`);
      return result.playerId;
    },
    send(playerId, msg) {
      room.handleMessage(playerId, toInbound(msg));
    },
    player,
    score: (id) => player(id).score,
    token: (id) => room.getPlayer(id)?.token ?? '',
    turnState(id) {
      const state = skribbleView(room);
      return state.players[id] ?? { guessedThisTurn: false, turnPoints: 0 };
    },
    canvas() {
      const loaded = canvasStore.load(code);
      if (loaded instanceof Promise) throw new Error('memory storage answered asynchronously');
      return loaded.actions;
    },
    welcomeCanvas(id) {
      const extra = transport.last(id, 'welcome').extra;
      if (!isSkribbleWelcomeExtra(extra)) throw new Error('welcome without a canvas');
      return extra.canvas;
    },
  };
  return h;
}

export function skribbleView(room: Room): SkribbleView {
  const game = room.getState(null).game;
  if (!game) throw new Error('no game running');
  return game as SkribbleView;
}

export function templateView(room: Room): TemplateView {
  const game = room.getState(null).game;
  if (!game) throw new Error('no game running');
  return game as TemplateView;
}

/** Skribble's phase as `recipient` sees it (null for the spectator view). */
export function phaseOf(room: Room, recipient: string | null = null): SkribblePhase {
  const game = room.getState(recipient).game;
  if (!game) throw new Error('no game running');
  return (game as SkribbleView).phase;
}

export function expectPhase<K extends SkribblePhase['kind']>(room: Room, kind: K, recipient: string | null = null): Extract<SkribblePhase, { kind: K }> {
  const phase = phaseOf(room, recipient);
  expect(phase.kind).toBe(kind);
  return phase as Extract<SkribblePhase, { kind: K }>;
}

/** Joins `names`, applies the game's deterministic test settings and starts the game. The first player is the host. */
export function startGame(h: Harness, names: string[], settings: Record<string, unknown> = {}): string[] {
  const players = names.map((n) => h.join(n));
  const host = players[0];
  h.send(host, { t: 'updateSettings', settings: { ...GAME_TEST_FIXTURES[h.room.gameId].settings, ...settings } });
  h.send(host, { t: 'start' });
  return players;
}

export function drawerOf(room: Room, players: string[]): string {
  const phase = phaseOf(room);
  if (phase.kind === 'gameOver') throw new Error('no drawer after the game');
  const drawer = players.find((p) => p === phase.drawerId);
  if (!drawer) throw new Error('drawer not among players');
  return drawer;
}

/** Moves the game from `choosing` into `drawing` by having the drawer pick choice `index`. */
export function pick(h: Harness, players: string[], index = 0): { drawer: string; word: string } {
  const drawer = drawerOf(h.room, players);
  const choosing = expectPhase(h.room, 'choosing', drawer);
  const word = choosing.choices?.[index];
  if (word === undefined) throw new Error('no choices');
  h.send(drawer, { t: 'chooseWord', index });
  expectPhase(h.room, 'drawing');
  return { drawer, word };
}
