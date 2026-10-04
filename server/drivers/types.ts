import type { Avatar } from '../../shared/avatar';
import type { ErrorCode, RoomPreview, ServerMessage } from '../../shared/protocol';
import type { RoomMessage } from '../room';

/**
 * Drivers may answer synchronously (in-memory) or asynchronously (Redis). The connection layer
 * chains either shape with `after`, so the single-process server keeps its synchronous behaviour.
 */
export type MaybePromise<T> = T | Promise<T>;

/** Runs `fn` on the value, synchronously when it is not a promise. */
export function after<T, R>(value: MaybePromise<T>, fn: (v: T) => MaybePromise<R>): MaybePromise<R> {
  return value instanceof Promise ? value.then(fn) : fn(value);
}

/** The subset of the ws API drivers need; keeps tests free of real sockets. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: 'message', listener: (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'pong', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

export const SOCKET_OPEN = 1;

/** Serialises a message onto a socket, ignoring sockets that are going away. */
export function sendTo(ws: SocketLike, msg: ServerMessage): void {
  if (ws.readyState !== SOCKET_OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // A failing socket surfaces through its 'close'/'error' events.
  }
}

/** The seat a connection holds: a player in a room. */
export interface Seat {
  code: string;
  playerId: string;
}

export type SeatResult = { ok: true; seat: Seat } | { ok: false; code: ErrorCode; message: string };

/** `code` is the normalised room code on success and the error code otherwise. */
export type LookupResult = { ok: true; code: string } | { ok: false; code: 'INVALID_CODE' | 'ROOM_NOT_FOUND'; message: string };

export interface DriverHealth {
  driver: string;
  /** Rooms alive; `approximate` when the count comes from a bounded scan. */
  rooms: number;
  approximate?: boolean;
  players?: number;
}

/**
 * Where rooms live and how messages reach sockets. The connection layer only knows seats
 * (room code + player id) and connection ids; the driver owns the sockets so that a message
 * for a player can be delivered by whichever process holds their socket.
 */
export interface GameDriver {
  readonly name: string;
  /** Makes a live socket known so the driver can deliver to it once it holds a seat. */
  register(connectionId: string, ws: SocketLike): void;
  unregister(connectionId: string): void;
  /** Resolves user input (any case, with noise) to an existing room's code. */
  lookup(code: string): MaybePromise<LookupResult>;
  create(name: string, avatar: Avatar, connectionId: string): MaybePromise<SeatResult>;
  join(code: string, name: string, avatar: Avatar, connectionId: string): MaybePromise<SeatResult>;
  rejoin(code: string, token: string, connectionId: string): MaybePromise<SeatResult>;
  leave(seat: Seat): MaybePromise<void>;
  /** The seat's socket went away; ignored when `connectionId` no longer holds the seat. */
  disconnected(seat: Seat, connectionId: string): MaybePromise<void>;
  handle(seat: Seat, msg: RoomMessage): MaybePromise<void>;
  /** True while `connectionId` is the connection bound to the seat (a rejoin elsewhere unbinds it). */
  holds(seat: Seat, connectionId: string): boolean;
  /** The connection proved alive (client ping or socket pong). */
  heartbeat(seat: Seat, connectionId: string): void;
  preview(code: string): MaybePromise<RoomPreview>;
  health(): MaybePromise<DriverHealth>;
  /** Releases timers and connections; sockets are closed by the caller. */
  shutdown(): Promise<void>;
}
