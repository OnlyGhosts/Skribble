import { expect } from 'vitest';
import type { Avatar } from '../shared/avatar.js';
import type { Phase, ServerMessage, ServerMessageOf } from '../shared/protocol.js';
import type { Player } from './player.js';
import { Room, type RoomDeps } from './room.js';
import type { Rng, Transport } from './transport.js';

/** Records everything a room sends, per player, as deep copies taken at send time. */
export class FakeTransport implements Transport {
  readonly sent = new Map<string, ServerMessage[]>();
  readonly attached: Array<{ playerId: string; connectionId: string }> = [];
  readonly closed: string[] = [];

  attach(playerId: string, connectionId: string): void {
    this.attached.push({ playerId, connectionId });
  }

  send(playerId: string, msg: ServerMessage): void {
    const list = this.sent.get(playerId);
    const copy = structuredClone(msg);
    if (list) list.push(copy);
    else this.sent.set(playerId, [copy]);
  }

  close(playerId: string): void {
    this.closed.push(playerId);
  }

  of(player: Player | string): ServerMessage[] {
    return this.sent.get(typeof player === 'string' ? player : player.id) ?? [];
  }

  ofType<T extends ServerMessage['t']>(player: Player | string, t: T): ServerMessageOf<T>[] {
    return this.of(player).filter((m): m is ServerMessageOf<T> => m.t === t);
  }

  last<T extends ServerMessage['t']>(player: Player | string, t: T): ServerMessageOf<T> {
    const list = this.ofType(player, t);
    const msg = list[list.length - 1];
    if (!msg) throw new Error(`no '${t}' message for ${typeof player === 'string' ? player : player.name}`);
    return msg;
  }

  chats(player: Player | string): Array<{ kind: string; text: string }> {
    return this.ofType(player, 'chat').map((m) => ({ kind: m.message.kind, text: m.message.text }));
  }

  errors(player: Player | string): string[] {
    return this.ofType(player, 'error').map((m) => m.code);
  }

  clear(): void {
    this.sent.clear();
    this.attached.length = 0;
    this.closed.length = 0;
  }
}

/** Ten custom words so `customWordsOnly` is honoured; with rng () => 0 they are picked in this order. */
export const TEST_WORDS = ['apple', 'banana', 'cherry', 'dragon', 'eagle', 'falcon', 'guitar', 'hammer', 'island', 'jacket'];

export const AVATAR: Avatar = { color: 0, emoji: 0 };

export interface Harness {
  room: Room;
  transport: FakeTransport;
  join: (name: string, connectionId?: string) => Player;
  emptied: Room[];
}

export function createHarness(opts: { rng?: Rng; code?: string; deps?: Partial<RoomDeps> } = {}): Harness {
  const transport = new FakeTransport();
  const emptied: Room[] = [];
  const room = new Room(opts.code ?? 'ABCD', {
    transport,
    clock: { now: () => Date.now() },
    rng: opts.rng ?? (() => 0),
    onEmpty: (r) => emptied.push(r),
    ...opts.deps,
  });
  const join = (name: string, connectionId = `conn-${name}`): Player => {
    const result = room.join(name, AVATAR, connectionId);
    if (!result.ok) throw new Error(`join failed: ${result.code}`);
    return result.player;
  };
  return { room, transport, join, emptied };
}

export function phaseOf(room: Room, recipient: Player | null = null): Phase {
  return room.getState(recipient).phase;
}

export function expectPhase<K extends Phase['kind']>(room: Room, kind: K, recipient: Player | null = null): Extract<Phase, { kind: K }> {
  const phase = phaseOf(room, recipient);
  expect(phase.kind).toBe(kind);
  return phase as Extract<Phase, { kind: K }>;
}

/**
 * Joins `names`, applies deterministic settings and starts the game.
 * The first player is the host and (joinOrder 0) the first drawer.
 */
export function startGame(
  h: Harness,
  names: string[],
  settings: Record<string, unknown> = {},
): Player[] {
  const players = names.map((n) => h.join(n));
  const host = players[0];
  h.room.handleMessage(host, {
    t: 'updateSettings',
    settings: { customWords: TEST_WORDS, customWordsOnly: true, rounds: 1, drawTime: 60, hints: 2, wordChoices: 3, ...settings },
  });
  h.room.handleMessage(host, { t: 'start' });
  return players;
}

export function drawerOf(room: Room, players: Player[]): Player {
  const phase = phaseOf(room);
  if (phase.kind !== 'choosing' && phase.kind !== 'drawing' && phase.kind !== 'turnEnd') {
    throw new Error(`no drawer in phase ${phase.kind}`);
  }
  const drawer = players.find((p) => p.id === phase.drawerId);
  if (!drawer) throw new Error('drawer not among players');
  return drawer;
}
