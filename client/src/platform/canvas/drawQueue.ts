import type { CanvasAction, CanvasClientMessage, DrawOp } from '@shared/platform/canvas';

const DRAW_FLUSH_MS = 30;
const MAX_OPS_PER_MESSAGE = 200;
const MAX_PTS_PER_MOVE = 2000;
/** The drawer's ops of one turn kept for a rejoin, up to this many; a longer outage gives up (the welcome resyncs). */
export const MAX_OFFLINE_OPS = 2000;

/** The wire the queue writes to (the game socket; tests substitute a recorder). */
export interface DrawLink {
  send(msg: CanvasClientMessage): boolean;
  isOpen(): boolean;
}

/** The ops of `log` the server's `history` does not have yet, in order (a stroke cut short gets its missing points and its end). */
export function missingOps(log: readonly DrawOp[], history: readonly CanvasAction[]): DrawOp[] {
  const known = new Map<number, number>();
  const fills = new Map<string, number>();
  for (const a of history) {
    if (a.kind === 'stroke') known.set(a.id, a.points.length);
    else fills.set(fillKey(a), (fills.get(fillKey(a)) ?? 0) + 1);
  }
  const counted = new Map<number, number>();
  const resent = new Set<number>();
  const out: DrawOp[] = [];
  for (const op of log) {
    switch (op.k) {
      case 'start':
        if (known.has(op.id)) counted.set(op.id, 2);
        else {
          resent.add(op.id);
          out.push(op);
        }
        break;
      case 'move': {
        if (resent.has(op.id)) {
          out.push(op);
          break;
        }
        const have = known.get(op.id);
        if (have === undefined) break;
        const before = counted.get(op.id) ?? 2;
        counted.set(op.id, before + op.pts.length);
        // The server holds `have` coordinates of this stroke: send on only the ones past them.
        const skip = Math.max(0, have - before);
        if (skip < op.pts.length) {
          out.push({ k: 'move', id: op.id, pts: op.pts.slice(skip) });
          resent.add(op.id);
        }
        break;
      }
      case 'end':
        if (resent.has(op.id)) out.push(op);
        break;
      case 'fill': {
        const key = fillKey(op);
        const left = fills.get(key) ?? 0;
        if (left > 0) fills.set(key, left - 1);
        else out.push(op);
        break;
      }
    }
  }
  return out;
}

function fillKey(f: { x: number; y: number; color: string }): string {
  return `${f.x},${f.y},${f.color}`;
}

/**
 * Batches the drawer's ops for the wire: consecutive 'move' ops of one stroke are merged and
 * flushed every ~30ms. Every op of the drawing turn the drawer is in (`turnKey()`, null outside
 * one) is also kept in a log, sent or not: a socket can look open while it is dead (a phone
 * switching networks), so after a rejoin into that very turn the log is compared with the
 * welcome's canvas and whatever the server is missing goes again (the welcome's canvas would
 * otherwise wipe it from the drawer's own screen too).
 */
export class DrawQueue {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: DrawOp[] = [];
  private log: DrawOp[] = [];
  private logTurn: string | null = null;

  constructor(
    private readonly link: DrawLink,
    private readonly turnKey: () => string | null,
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
    this.record(ops);
    if (this.link.isOpen()) this.sendDraw(ops);
  }

  /** The drawer's last action was undone (and the undo sent): it is no longer theirs to restore. */
  undone(): void {
    const start = lastActionStart(this.log);
    if (start >= 0) this.log = this.log.slice(0, start);
  }

  /** The drawer cleared the canvas (and the clear was sent): nothing drawn before is theirs to restore. */
  cleared(): void {
    this.log = [];
  }

  dropOffline(): void {
    this.log = [];
    this.logTurn = null;
  }

  /**
   * After a welcome: if it landed in the drawing turn the log is for (`currentTurn`, null when
   * this player is not drawing now), the ops the welcome's canvas (`history`) is missing are sent
   * again and returned for the caller to restore locally. Ops from another turn are dropped.
   */
  resume(currentTurn: string | null, history: readonly CanvasAction[]): DrawOp[] {
    if (currentTurn === null || currentTurn !== this.logTurn) {
      this.dropOffline();
      return [];
    }
    const ops = missingOps(this.log, history);
    if (ops.length > 0 && this.link.isOpen()) this.sendDraw(ops);
    return ops;
  }

  private sendDraw(ops: readonly DrawOp[]): void {
    const wire = ops.flatMap(splitMove);
    for (let i = 0; i < wire.length; i += MAX_OPS_PER_MESSAGE) {
      this.link.send({ t: 'draw', ops: wire.slice(i, i + MAX_OPS_PER_MESSAGE) });
    }
  }

  /** Keeps the ops of the current drawing turn only; a turn too long to keep gives up (the welcome resyncs). */
  private record(ops: DrawOp[]): void {
    const key = this.turnKey();
    if (key === null) {
      this.dropOffline();
      return;
    }
    if (key !== this.logTurn) {
      this.log = [];
      this.logTurn = key;
    }
    for (const op of ops) {
      // A stroke's moves fold into one, so a whole turn stays a few ops a stroke.
      const last = this.log[this.log.length - 1];
      if (op.k === 'move' && last?.k === 'move' && last.id === op.id) this.log[this.log.length - 1] = { k: 'move', id: op.id, pts: last.pts.concat(op.pts) };
      else this.log.push(op);
    }
    if (this.log.length > MAX_OFFLINE_OPS) this.dropOffline();
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

/** A move longer than one wire op may carry, as several. */
function splitMove(op: DrawOp): DrawOp[] {
  if (op.k !== 'move' || op.pts.length <= MAX_PTS_PER_MOVE) return [op];
  const out: DrawOp[] = [];
  for (let i = 0; i < op.pts.length; i += MAX_PTS_PER_MOVE) out.push({ k: 'move', id: op.id, pts: op.pts.slice(i, i + MAX_PTS_PER_MOVE) });
  return out;
}

/** Where the last canvas action of a log begins: its stroke's start, or a fill. */
function lastActionStart(log: readonly DrawOp[]): number {
  for (let i = log.length - 1; i >= 0; i--) {
    const op = log[i];
    if (op.k === 'start' || op.k === 'fill') return i;
  }
  return -1;
}
