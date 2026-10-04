import { randomBytes, randomUUID } from 'node:crypto';
import type { ServerMessage } from '../shared/protocol.js';
import type { Ctx } from './engine/actions.js';

/**
 * Delivery boundary between the game engine and the network. Rooms only ever
 * talk to players by id; the production implementation (SocketHub in
 * connection.ts) maps ids to WebSockets, tests use an in-memory fake.
 */
export interface Transport {
  /** Binds a player seat to a live connection, replacing (and closing) any previous one. */
  attach(playerId: string, connectionId: string): void;
  send(playerId: string, msg: ServerMessage): void;
  /** Closes the connection currently bound to the player, if any. */
  close(playerId: string, code: number, reason: string): void;
}

export interface Clock {
  now(): number;
}

export type Rng = () => number;

export const systemClock: Clock = { now: () => Date.now() };

/** The engine context every driver dispatches with: real ids and tokens, the driver's clock and rng. */
export function productionCtx(clock: Clock, rng: Rng): Ctx {
  return {
    now: clock.now(),
    rng,
    newId: () => randomUUID(),
    newToken: () => randomBytes(16).toString('hex'),
  };
}
