import type { Avatar } from '../shared/avatar.js';
import type { PlayerData, Rating } from './engine/state.js';

/**
 * A stable handle on one seat. The game state lives in the room's RoomData and changes with
 * every action, so the handle reads through to the current record instead of copying it. Once
 * the player has left, it keeps answering with the last record it saw, minus the secrets.
 */
export class Player {
  private last: PlayerData;

  constructor(
    private readonly lookup: (id: string) => PlayerData | undefined,
    initial: PlayerData,
  ) {
    this.last = initial;
  }

  get id(): string {
    return this.last.id;
  }

  /** True while the seat exists (connected or within its reconnect grace). */
  get seated(): boolean {
    return this.live() !== undefined;
  }

  /** Secret used by `rejoin`; empty once the player was removed so it can never be reused. */
  get token(): string {
    return this.live()?.token ?? '';
  }

  get name(): string {
    return this.current().name;
  }

  get avatar(): Avatar {
    return { ...this.current().avatar };
  }

  get score(): number {
    return this.current().score;
  }

  get joinOrder(): number {
    return this.current().joinOrder;
  }

  get connected(): boolean {
    return this.live()?.connected ?? false;
  }

  /** Id of the connection bound to this seat; null while disconnected or after removal. */
  get connectionId(): string | null {
    return this.live()?.connectionId ?? null;
  }

  get guessedThisTurn(): boolean {
    return this.current().guessedThisTurn;
  }

  get turnPoints(): number {
    return this.current().turnPoints;
  }

  get rating(): Rating | null {
    return this.current().rating;
  }

  private live(): PlayerData | undefined {
    const data = this.lookup(this.last.id);
    if (data) this.last = data;
    return data;
  }

  private current(): PlayerData {
    return this.live() ?? this.last;
  }
}
