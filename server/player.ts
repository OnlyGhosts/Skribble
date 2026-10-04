import { randomBytes, randomUUID } from 'node:crypto';
import type { Avatar } from '../shared/avatar';
import type { PlayerPublic } from '../shared/protocol';

export type Rating = 'like' | 'dislike';

export interface PlayerInit {
  name: string;
  avatar: Avatar;
  joinOrder: number;
  connectionId: string;
  now: number;
}

export class Player {
  readonly id: string = randomUUID();
  /** Secret used by `rejoin`; cleared when the player is removed so it can never be reused. */
  token: string = randomBytes(16).toString('hex');
  name: string;
  avatar: Avatar;
  score = 0;
  connected = true;
  readonly joinOrder: number;
  guessedThisTurn = false;
  turnPoints = 0;
  rating: Rating | null = null;
  lastSeen: number;
  /** When the current connection was established; used to pick the longest-connected player as host. */
  connectedAt: number;
  /** Id of the connection bound to this seat; null while disconnected. */
  connectionId: string | null;

  constructor(init: PlayerInit) {
    this.name = init.name;
    this.avatar = init.avatar;
    this.joinOrder = init.joinOrder;
    this.connectionId = init.connectionId;
    this.lastSeen = init.now;
    this.connectedAt = init.now;
  }

  markConnected(connectionId: string, now: number): void {
    const wasConnected = this.connected;
    this.connected = true;
    this.connectionId = connectionId;
    this.lastSeen = now;
    if (!wasConnected) this.connectedAt = now;
  }

  markDisconnected(now: number): void {
    this.connected = false;
    this.connectionId = null;
    this.lastSeen = now;
  }

  resetForTurn(): void {
    this.guessedThisTurn = false;
    this.turnPoints = 0;
    this.rating = null;
  }

  resetForGame(): void {
    this.score = 0;
    this.resetForTurn();
  }

  toPublic(hostId: string): PlayerPublic {
    return {
      id: this.id,
      name: this.name,
      avatar: { ...this.avatar },
      score: this.score,
      isHost: this.id === hostId,
      connected: this.connected,
      guessedThisTurn: this.guessedThisTurn,
      turnPoints: this.turnPoints,
      joinOrder: this.joinOrder,
    };
  }
}
