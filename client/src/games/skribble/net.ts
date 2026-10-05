import type { DrawOp, SkribbleClientMessage, SkribbleRoomState } from '@shared/games/skribble/protocol';
import { socket } from '../../platform/net/socket';
import { usePlatformStore } from '../../platform/store/usePlatformStore';
import { drawingTurnKey, selectSkribbleRoom } from './hooks';
import { useSkribbleStore } from './store';

const DRAW_FLUSH_MS = 30;
const MAX_OPS_PER_MESSAGE = 200;
const MAX_PTS_PER_MOVE = 2000;
/** Ops drawn while the socket is down are kept for the rejoin, up to this many. */
export const MAX_OFFLINE_OPS = 2000;

export interface DrawLink {
  send(msg: SkribbleClientMessage): boolean;
  isOpen(): boolean;
}

/**
 * Batches the drawer's ops for the wire: consecutive 'move' ops of one stroke are merged and
 * flushed every ~30ms. Ops drawn during an outage are parked and delivered after a rejoin into
 * the very same turn (the welcome's canvas would otherwise lose them).
 */
export class DrawQueue {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: DrawOp[] = [];
  private offlineOps: DrawOp[] = [];
  private offlineTurn: string | null = null;

  constructor(
    private readonly link: DrawLink,
    private readonly currentRoom: () => SkribbleRoomState | null,
  ) {}

  queue(ops: readonly DrawOp[]): void {
    for (const op of ops) this.pushOp(op);
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), DRAW_FLUSH_MS);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.length === 0) return;
    const ops = this.pending;
    this.pending = [];
    if (!this.link.isOpen()) {
      this.park(ops);
      return;
    }
    this.sendDraw(ops);
  }

  dropOffline(): void {
    this.offlineOps = [];
    this.offlineTurn = null;
  }

  /** After a rejoin as the drawer of the very same turn, the strokes drawn offline are restored and delivered. */
  resumeOfflineOps(room: SkribbleRoomState, playerId: string): void {
    const ops = this.offlineOps;
    const turn = this.offlineTurn;
    this.dropOffline();
    if (ops.length === 0) return;
    const phase = room.game?.phase;
    if (!phase || phase.kind !== 'drawing' || phase.drawerId !== playerId || drawingTurnKey(room) !== turn) return;
    useSkribbleStore.getState().appendOps(ops);
    this.sendDraw(ops);
  }

  private sendDraw(ops: readonly DrawOp[]): void {
    for (let i = 0; i < ops.length; i += MAX_OPS_PER_MESSAGE) {
      this.link.send({ t: 'draw', ops: ops.slice(i, i + MAX_OPS_PER_MESSAGE) });
    }
  }

  /** Keeps ops drawn during an outage for the current turn only; a long outage gives up (the welcome resyncs). */
  private park(ops: DrawOp[]): void {
    const key = drawingTurnKey(this.currentRoom());
    if (key === null) {
      this.dropOffline();
      return;
    }
    if (key !== this.offlineTurn) {
      this.offlineOps = [];
      this.offlineTurn = key;
    }
    this.offlineOps.push(...ops);
    if (this.offlineOps.length > MAX_OFFLINE_OPS) this.dropOffline();
  }

  private pushOp(op: DrawOp): void {
    if (op.k !== 'move') {
      this.pending.push(op);
      return;
    }
    let pts: number[] = op.pts;
    const last = this.pending[this.pending.length - 1];
    if (last && last.k === 'move' && last.id === op.id && last.pts.length < MAX_PTS_PER_MOVE) {
      const room = MAX_PTS_PER_MOVE - last.pts.length;
      const take = Math.min(room - (room % 2), pts.length);
      last.pts = last.pts.concat(pts.slice(0, take));
      pts = pts.slice(take);
    }
    for (let i = 0; i < pts.length; i += MAX_PTS_PER_MOVE) {
      this.pending.push({ k: 'move', id: op.id, pts: pts.slice(i, i + MAX_PTS_PER_MOVE) });
    }
  }
}

export const drawQueue = new DrawQueue(
  { send: (msg) => socket.send(msg), isOpen: () => socket.isOpen() },
  () => selectSkribbleRoom(usePlatformStore.getState()),
);
