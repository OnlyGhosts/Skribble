/**
 * The canvas side store: drawing never goes through the reducer. Ops are admitted by the caps,
 * stored as batches in the room's GameStorage (one implementation over memory and Redis) and
 * replayed for late joiners. Every write names the canvas it was authorised against (the stamp):
 * ops for a canvas the game has since reset are refused silently.
 */
import { MAX_ACTIONS_PER_TURN, MAX_POINTS_PER_STROKE, MAX_POINTS_PER_TURN } from '../../../shared/games/skribble/constants.js';
import type { CanvasAction, DrawOp, SkribbleClientMessage, SkribbleServerMessage, SkribbleWelcomeExtra } from '../../../shared/games/skribble/protocol.js';
import { retryCas } from '../../platform/cas.js';
import { after, type MaybePromise } from '../../platform/drivers/types.js';
import type { GameSideStore, SideOutcome, SideRoom } from '../../platform/game.js';
import { STAMP_FIELD, type GameStorage } from '../../platform/storage.js';
import { NOT_DRAWER_MESSAGE, canDraw, drawerCheck, type SkribbleData } from './state.js';

export interface AppendResult {
  /** The ops to forward to viewers: dropped ops are missing, oversized moves are cut short. */
  accepted: DrawOp[];
  /** True when something the drawer drew locally did not make it into the history (an 'end' for an unknown stroke is not a loss). */
  truncated: boolean;
}

/**
 * What the caps need to know about a canvas, without the coordinates themselves: the action and
 * point totals plus the point count of every stroke (keyed by stroke id).
 */
export interface CanvasCounts {
  actions: number;
  points: number;
  strokes: Map<number, number>;
}

export function emptyCounts(): CanvasCounts {
  return { actions: 0, points: 0, strokes: new Map() };
}

/**
 * Applies the caps to one op, updating `counts`. Returns the op to keep (a 'move' may be cut
 * short), or null to drop it. This is the single source of truth for what a canvas accepts.
 */
export function admitOp(op: DrawOp, counts: CanvasCounts): DrawOp | null {
  switch (op.k) {
    case 'start': {
      if (counts.actions >= MAX_ACTIONS_PER_TURN || counts.strokes.has(op.id)) return null;
      if (counts.points + 2 > MAX_POINTS_PER_TURN) return null;
      counts.actions += 1;
      counts.points += 2;
      counts.strokes.set(op.id, 2);
      return op;
    }
    case 'move': {
      const have = counts.strokes.get(op.id);
      if (have === undefined) return null;
      const room = Math.min(MAX_POINTS_PER_STROKE - have, MAX_POINTS_PER_TURN - counts.points);
      if (room < 2) return null;
      const pts = op.pts.length > room ? op.pts.slice(0, room - (room % 2)) : op.pts;
      counts.strokes.set(op.id, have + pts.length);
      counts.points += pts.length;
      return pts === op.pts ? op : { ...op, pts };
    }
    case 'end':
      return counts.strokes.has(op.id) ? op : null;
    case 'fill': {
      if (counts.actions >= MAX_ACTIONS_PER_TURN) return null;
      counts.actions += 1;
      return op;
    }
  }
}

/** Runs a batch through `admitOp`, handing each kept op to `onAccept`; the single source of the truncation rule. */
export function admitAll(ops: readonly DrawOp[], counts: CanvasCounts, onAccept: (kept: DrawOp) => void): AppendResult {
  const accepted: DrawOp[] = [];
  let truncated = false;
  for (const op of ops) {
    const kept = admitOp(op, counts);
    if (kept) {
      onAccept(kept);
      accepted.push(kept);
    }
    if (kept !== op && op.k !== 'end') truncated = true;
  }
  return { accepted, truncated };
}

/** True for the ops that begin a new canvas action. */
export function startsAction(op: DrawOp): boolean {
  return op.k === 'start' || op.k === 'fill';
}

type StrokeAction = Extract<CanvasAction, { kind: 'stroke' }>;

/** An in-memory canvas: the reference for what a sequence of ops renders to (tests compare against it). */
export class CanvasHistory {
  private actions: CanvasAction[] = [];
  private strokes = new Map<number, StrokeAction>();
  private counts = emptyCounts();

  append(ops: readonly DrawOp[]): AppendResult {
    return admitAll(ops, this.counts, (kept) => this.apply(kept));
  }

  undo(): CanvasAction | null {
    const last = this.actions.pop();
    if (!last) return null;
    this.counts.actions -= 1;
    if (last.kind === 'stroke') {
      this.strokes.delete(last.id);
      this.counts.strokes.delete(last.id);
      this.counts.points -= last.points.length;
    }
    return last;
  }

  clear(): void {
    this.actions = [];
    this.strokes = new Map();
    this.counts = emptyCounts();
  }

  /** Deep copies, safe to send. */
  all(): CanvasAction[] {
    return this.actions.map((a) => (a.kind === 'stroke' ? { ...a, points: [...a.points] } : { ...a }));
  }

  /** Folds an already admitted op into the action list. */
  private apply(op: DrawOp): void {
    switch (op.k) {
      case 'start': {
        const stroke: StrokeAction = { kind: 'stroke', id: op.id, tool: op.tool, color: op.color, size: op.size, points: [op.x, op.y] };
        this.actions.push(stroke);
        this.strokes.set(op.id, stroke);
        return;
      }
      case 'move':
        this.strokes.get(op.id)?.points.push(...op.pts);
        return;
      case 'end': {
        const stroke = this.strokes.get(op.id);
        if (stroke) stroke.done = true;
        return;
      }
      case 'fill':
        this.actions.push({ kind: 'fill', x: op.x, y: op.y, color: op.color });
        return;
    }
  }
}

/** Rebuilds the action history from a stream of ops that were already admitted by the caps. */
export function replayOps(ops: readonly DrawOp[]): CanvasAction[] {
  const history = new CanvasHistory();
  history.append(ops);
  return history.all();
}

// ---------------------------------------------------------------------------
// The side store over GameStorage
// ---------------------------------------------------------------------------

/** Batches read per round trip while walking back to the start of the last action. */
const UNDO_CHUNK = 8;
const STROKE_FIELD = 's:';

type Room = SideRoom<SkribbleData>;
type Outcome = SideOutcome<SkribbleServerMessage>;

export interface CanvasAppend extends AppendResult {
  /** Sequence number of this change; 0 when nothing was accepted. */
  seq: number;
}

export interface CanvasSnapshot {
  actions: CanvasAction[];
  /** Sequence number of the last change the snapshot includes. */
  seq: number;
}

/**
 * The storage list holds JSON op batches, each belonging to exactly one canvas action (a batch
 * never spans a 'start' or 'fill'); the hash holds the counts the caps need and the stamp.
 */
export class CanvasStore implements GameSideStore<SkribbleData, SkribbleClientMessage, SkribbleServerMessage> {
  constructor(private readonly storage: GameStorage) {}

  stamp(room: Room): string {
    return room.game?.canvasId ?? '';
  }

  handleMessage(room: Room, playerId: string, msg: SkribbleClientMessage, now: number): MaybePromise<Outcome> {
    if (!room.game || (msg.t !== 'draw' && msg.t !== 'undo' && msg.t !== 'clear')) return { ok: false, message: null };
    const check = drawerCheck(room.game, playerId, now);
    if (check !== 'ok') return { ok: false, message: check === 'forbidden' ? NOT_DRAWER_MESSAGE : null };
    const stamp = this.stamp(room);
    switch (msg.t) {
      case 'draw':
        return after(this.append(room.code, stamp, msg.ops), (appended) => {
          if (appended === 'stale') return { ok: true, seq: 0, sends: [] };
          const out: Outcome = { ok: true, seq: appended.seq, sends: [] };
          if (appended.accepted.length > 0) out.sends.push({ to: { except: [playerId] }, msg: { t: 'draw', ops: appended.accepted } });
          // The drawer applied the full ops locally; bring their canvas back to what everyone else has.
          if (appended.truncated) out.resync = playerId;
          return out;
        });
      case 'undo':
        return after(this.undo(room.code, stamp), (seq) => ({ ok: true, seq: seq ?? 0, sends: seq === null ? [] : [{ to: 'all', msg: { t: 'undo' } }] }));
      case 'clear':
        return after(this.clear(room.code, stamp), (seq) => ({ ok: true, seq: seq ?? 0, sends: seq === null ? [] : [{ to: 'all', msg: { t: 'clear' } }] }));
    }
  }

  welcomeExtra(room: Room): MaybePromise<{ extra: SkribbleWelcomeExtra; seq: number }> {
    return after(this.load(room.code), (snapshot) => ({ extra: { canvas: snapshot.actions }, seq: snapshot.seq }));
  }

  resync(room: Room, playerId: string, now: number): MaybePromise<{ msg: SkribbleServerMessage; seq: number } | null> {
    if (!room.game || !canDraw(room.game, playerId, now)) return null;
    return after(this.load(room.code), (snapshot) => ({ msg: { t: 'canvas', actions: snapshot.actions }, seq: snapshot.seq }));
  }

  append(code: string, stamp: string, ops: readonly DrawOp[]): MaybePromise<CanvasAppend | 'stale'> {
    return retryCas(`canvas ${code}`, () => this.appendAttempt(code, stamp, ops));
  }

  /** Removes the last action; the change's sequence number, or null when there was nothing to undo. */
  undo(code: string, stamp: string): MaybePromise<number | null> {
    return retryCas(`canvas ${code}`, () => this.undoAttempt(code, stamp));
  }

  /** Empties the canvas; the change's sequence number, or null for a stale stamp. */
  clear(code: string, stamp: string): MaybePromise<number | null> {
    return retryCas(`canvas ${code}`, () =>
      after(this.storage.state(code), ({ hash, seq }) => (isOtherStamp(hash[STAMP_FIELD], stamp) ? null : this.storage.reset(code, seq, stamp))),
    );
  }

  /** The history and the sequence number it is current to. */
  load(code: string): MaybePromise<CanvasSnapshot> {
    return after(this.storage.list(code), ({ items, seq }) => ({ actions: replayOps(items.flatMap(asBatch)), seq }));
  }

  private appendAttempt(code: string, stamp: string, ops: readonly DrawOp[]): MaybePromise<CanvasAppend | 'stale' | 'conflict'> {
    return after(this.storage.state(code), ({ hash, seq }) => {
      if (isOtherStamp(hash[STAMP_FIELD], stamp)) return 'stale';
      const counts = countsFrom(hash);
      const batches: DrawOp[][] = [];
      const touched = new Set<number>();
      let current: DrawOp[] = [];
      let currentAction: string | null = null;
      const { accepted, truncated } = admitAll(ops, counts, (kept) => {
        const action = actionOf(kept);
        if (startsAction(kept) || action !== currentAction || current.length === 0) {
          current = [];
          batches.push(current);
          currentAction = action;
        }
        current.push(kept);
        if (kept.k === 'start' || kept.k === 'move') touched.add(kept.id);
      });
      if (batches.length === 0) return { accepted, truncated, seq: 0 };
      const fields: Record<string, string> = { [STAMP_FIELD]: stamp, actions: String(counts.actions), points: String(counts.points) };
      for (const id of touched) fields[`${STROKE_FIELD}${id}`] = String(counts.strokes.get(id) ?? 0);
      return after(this.storage.append(code, seq, batches, fields), (next) => (next === 'conflict' ? 'conflict' : { accepted, truncated, seq: next }));
    });
  }

  private undoAttempt(code: string, stamp: string): MaybePromise<number | null | 'conflict'> {
    return after(this.storage.state(code), ({ hash, seq }) => {
      if (isOtherStamp(hash[STAMP_FIELD], stamp)) return null;
      return after(this.storage.length(code), (length) => {
        if (length === 0) return null;
        return after(this.walkBack(code, length, []), ({ removed, found }) => {
          // Nothing marks an action start: the history is unusable, so drop it rather than guess.
          if (!found) return this.storage.reset(code, seq, stamp);
          let points = 0;
          let strokeId: number | null = null;
          for (const op of removed.flat()) {
            if (op.k === 'start') {
              points += 2;
              strokeId = op.id;
            } else if (op.k === 'move') {
              points += op.pts.length;
            }
          }
          const increments: Record<string, number> = { actions: -1 };
          if (points > 0) increments.points = -points;
          return this.storage.pop(code, seq, removed.length, increments, strokeId === null ? [] : [`${STROKE_FIELD}${strokeId}`]);
        });
      });
    });
  }

  /** Walks back from the end of the list to the batch that began the last action. */
  private walkBack(code: string, end: number, removed: DrawOp[][]): MaybePromise<{ removed: DrawOp[][]; found: boolean }> {
    if (end <= 0) return { removed, found: false };
    const start = Math.max(0, end - UNDO_CHUNK);
    return after(this.storage.range(code, start, end - 1), (chunk) => {
      for (let i = chunk.length - 1; i >= 0; i--) {
        const batch = asBatch(chunk[i]);
        removed.unshift(batch);
        if (batch.length > 0 && startsAction(batch[0])) return { removed, found: true };
      }
      return this.walkBack(code, start, removed);
    });
  }
}

export function createCanvasStore(storage: GameStorage): CanvasStore {
  return new CanvasStore(storage);
}

/** A canvas stamped for another round of data refuses the write; an unstamped one accepts it. */
function isOtherStamp(stored: string | undefined, stamp: string): boolean {
  return stored !== undefined && stored !== stamp;
}

/** The canvas action an admitted op belongs to: its stroke, or a fill of its own. */
function actionOf(op: DrawOp): string {
  return op.k === 'fill' ? `fill:${op.x},${op.y},${op.color}` : `${STROKE_FIELD}${op.id}`;
}

function countsFrom(hash: Record<string, string>): CanvasCounts {
  const counts = emptyCounts();
  for (const [field, value] of Object.entries(hash)) {
    if (field === 'actions') counts.actions = Number(value);
    else if (field === 'points') counts.points = Number(value);
    else if (field.startsWith(STROKE_FIELD)) counts.strokes.set(Number(field.slice(STROKE_FIELD.length)), Number(value));
  }
  return counts;
}

function asBatch(item: unknown): DrawOp[] {
  return Array.isArray(item) ? (item as DrawOp[]) : [];
}
