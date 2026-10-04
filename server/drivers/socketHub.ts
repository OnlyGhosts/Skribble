import { CLOSE_REPLACED, type ServerMessage } from '../../shared/protocol';
import type { Transport } from '../transport';
import { sendTo, type SocketLike } from './types';

/** Maps player seats to live sockets in one process. The in-memory driver's `Transport`. */
export class SocketHub implements Transport {
  private readonly sockets = new Map<string, { ws: SocketLike; playerId: string | null }>();
  private readonly byPlayer = new Map<string, string>();

  register(connectionId: string, ws: SocketLike): void {
    this.sockets.set(connectionId, { ws, playerId: null });
  }

  unregister(connectionId: string): void {
    const entry = this.sockets.get(connectionId);
    if (!entry) return;
    this.sockets.delete(connectionId);
    if (entry.playerId !== null && this.byPlayer.get(entry.playerId) === connectionId) {
      this.byPlayer.delete(entry.playerId);
    }
  }

  attach(playerId: string, connectionId: string): void {
    const entry = this.sockets.get(connectionId);
    if (!entry) return;
    const previous = this.byPlayer.get(playerId);
    if (previous !== undefined && previous !== connectionId) {
      const stale = this.sockets.get(previous);
      if (stale) {
        stale.playerId = null;
        stale.ws.close(CLOSE_REPLACED, 'Replaced by a newer connection');
      }
    }
    if (entry.playerId !== null && entry.playerId !== playerId && this.byPlayer.get(entry.playerId) === connectionId) {
      this.byPlayer.delete(entry.playerId);
    }
    entry.playerId = playerId;
    this.byPlayer.set(playerId, connectionId);
  }

  send(playerId: string, msg: ServerMessage): void {
    const connectionId = this.byPlayer.get(playerId);
    const entry = connectionId !== undefined ? this.sockets.get(connectionId) : undefined;
    if (entry) sendTo(entry.ws, msg);
  }

  close(playerId: string, code: number, reason: string): void {
    const connectionId = this.byPlayer.get(playerId);
    if (connectionId === undefined) return;
    this.byPlayer.delete(playerId);
    const entry = this.sockets.get(connectionId);
    if (!entry) return;
    entry.playerId = null;
    entry.ws.close(code, reason);
  }

  get size(): number {
    return this.sockets.size;
  }
}
