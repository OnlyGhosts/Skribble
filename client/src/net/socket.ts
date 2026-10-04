import {
  CLOSE_REMOVED,
  CLOSE_REPLACED,
  WS_PATH,
  isServerMessage,
  type ClientMessage,
  type DrawOp,
  type RoomState,
  type ServerMessage,
  type ServerMessageOf,
  type StoredSession,
} from '@shared/protocol';
import { useGameStore } from '../store/useGameStore';
import { clearSession, loadSession, saveSession } from '../lib/storage';
import { codeFromLocation } from '../lib/url';

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8000;
export const PING_INTERVAL_MS = 20_000;
/**
 * A ping unanswered for this long means the link is half-open (Wi-Fi to cellular hand-over, a
 * suspended server, a closed laptop lid): the socket is dropped so the usual reconnect runs.
 */
export const PONG_TIMEOUT_MS = 10_000;
const DRAW_FLUSH_MS = 30;
const MAX_OPS_PER_MESSAGE = 200;
const MAX_PTS_PER_MOVE = 2000;
/** Ops drawn while the socket is down are kept for the rejoin, up to this many. */
export const MAX_OFFLINE_OPS = 2000;

/** Application close codes the server uses; one definition for both sides. */
export { CLOSE_REMOVED, CLOSE_REPLACED };

export function wsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}${WS_PATH}`;
}

/** Identifies a drawing turn; `null` outside the drawing phase. */
function drawingTurnKey(room: RoomState | null): string | null {
  if (!room || room.phase.kind !== 'drawing') return null;
  return `${room.code}:${room.round}:${room.turn}:${room.phase.drawerId}`;
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private started = false;
  private everConnected = false;
  private backoff = BACKOFF_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private pingSentAt = 0;
  private pongPending = false;
  private drawTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOps: DrawOp[] = [];
  /** Ops that could not be sent while the socket was down, delivered after a rejoin into the same turn. */
  private offlineOps: DrawOp[] = [];
  private offlineTurn: string | null = null;
  private lostToastShown = false;
  /**
   * The seat we hold, as last told by `welcome`. sessionStorage is the reload path; this copy
   * covers environments where storage is unavailable (private windows, blocked site data).
   */
  private session: StoredSession | null = null;
  /** A leave the server never received (the socket was down); released on the next connection. */
  private pendingLeave: StoredSession | null = null;
  /** Token of the seat being released through rejoin + leave; its welcome must not enter the room. */
  private leavingToken: string | null = null;

  /** Opens the connection and keeps it alive for the lifetime of the page. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
    window.addEventListener('online', () => this.reconnectNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.reconnectNow();
    });
  }

  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Buffers drawing ops; consecutive 'move' ops of one stroke are merged and flushed every ~30ms. */
  queueDraw(ops: readonly DrawOp[]): void {
    for (const op of ops) this.pushOp(op);
    if (this.drawTimer === null) {
      this.drawTimer = setTimeout(() => this.flushDraw(), DRAW_FLUSH_MS);
    }
  }

  flushDraw(): void {
    if (this.drawTimer !== null) {
      clearTimeout(this.drawTimer);
      this.drawTimer = null;
    }
    if (this.pendingOps.length === 0) return;
    const ops = this.pendingOps;
    this.pendingOps = [];
    if (!this.isOpen()) {
      this.parkOps(ops);
      return;
    }
    this.sendDraw(ops);
  }

  /**
   * Explicit leave. The seat is released now, or, when the socket is down, as soon as it is back
   * (otherwise the server keeps a ghost seat for the whole reconnect grace period).
   */
  leave(): void {
    this.flushDraw();
    const session = this.currentSession();
    if (!this.send({ t: 'leave' }) && session) this.pendingLeave = session;
    this.dropOfflineOps();
    this.forgetSession();
  }

  private sendDraw(ops: readonly DrawOp[]): void {
    for (let i = 0; i < ops.length; i += MAX_OPS_PER_MESSAGE) {
      this.send({ t: 'draw', ops: ops.slice(i, i + MAX_OPS_PER_MESSAGE) });
    }
  }

  /** Keeps ops drawn during an outage for the current turn only; a long outage gives up (the welcome resyncs). */
  private parkOps(ops: DrawOp[]): void {
    const key = drawingTurnKey(useGameStore.getState().room);
    if (key === null) {
      this.dropOfflineOps();
      return;
    }
    if (key !== this.offlineTurn) {
      this.offlineOps = [];
      this.offlineTurn = key;
    }
    this.offlineOps.push(...ops);
    if (this.offlineOps.length > MAX_OFFLINE_OPS) this.dropOfflineOps();
  }

  private dropOfflineOps(): void {
    this.offlineOps = [];
    this.offlineTurn = null;
  }

  /** After a rejoin as the drawer of the very same turn, the strokes drawn offline are restored and delivered. */
  private resumeOfflineOps(msg: ServerMessageOf<'welcome'>): void {
    const ops = this.offlineOps;
    const turn = this.offlineTurn;
    this.dropOfflineOps();
    if (ops.length === 0) return;
    const phase = msg.room.phase;
    if (phase.kind !== 'drawing' || phase.drawerId !== msg.playerId || drawingTurnKey(msg.room) !== turn) return;
    useGameStore.getState().appendLocalOps(ops);
    this.sendDraw(ops);
  }

  private pushOp(op: DrawOp): void {
    if (op.k !== 'move') {
      this.pendingOps.push(op);
      return;
    }
    let pts: number[] = op.pts;
    const last = this.pendingOps[this.pendingOps.length - 1];
    if (last && last.k === 'move' && last.id === op.id && last.pts.length < MAX_PTS_PER_MOVE) {
      const room = MAX_PTS_PER_MOVE - last.pts.length;
      const take = Math.min(room - (room % 2), pts.length);
      last.pts = last.pts.concat(pts.slice(0, take));
      pts = pts.slice(take);
    }
    for (let i = 0; i < pts.length; i += MAX_PTS_PER_MOVE) {
      this.pendingOps.push({ k: 'move', id: op.id, pts: pts.slice(i, i + MAX_PTS_PER_MOVE) });
    }
  }

  private currentSession(): StoredSession | null {
    return loadSession() ?? this.session;
  }

  private rememberSession(session: StoredSession): void {
    this.session = session;
    saveSession(session);
  }

  private forgetSession(): void {
    this.session = null;
    clearSession();
  }

  private connect(): void {
    this.clearReconnectTimer();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => this.onOpen(ws));
    ws.addEventListener('message', (ev: MessageEvent<unknown>) => this.onMessage(ev));
    ws.addEventListener('close', (ev: CloseEvent) => this.onClose(ws, ev.code));
    // 'error' is always followed by 'close', which drives the reconnect.
  }

  private reconnectNow(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      // A tab back from the background may hold a socket whose ping was never answered (its
      // timers were throttled); drop it instead of trusting it. A healthy one gets a fresh probe.
      if (!this.pongOverdue()) {
        this.ping();
        return;
      }
      this.dropConnection(this.ws);
    }
    this.backoff = BACKOFF_MIN_MS;
    this.connect();
  }

  private onOpen(ws: WebSocket): void {
    if (ws !== this.ws) return;
    const store = useGameStore.getState();
    this.backoff = BACKOFF_MIN_MS;
    this.everConnected = true;
    store.setConnection('connected');
    if (this.lostToastShown) {
      store.addToast('success', 'Reconnected');
      this.lostToastShown = false;
    }
    this.startPing();

    if (this.pendingLeave) {
      // The leave never reached the server: take the old seat back for an instant to release it.
      const { code, token } = this.pendingLeave;
      this.pendingLeave = null;
      this.leavingToken = token;
      this.send({ t: 'rejoin', code, token });
      this.send({ t: 'leave' });
    }

    const session = this.currentSession();
    const code = store.room?.code ?? codeFromLocation();
    if (session && code && session.code === code) {
      store.setRejoining(true);
      this.send({ t: 'rejoin', code: session.code, token: session.token });
      return;
    }
    if (store.room) {
      // We were in a room but have no usable seat token: nothing to resume.
      store.resetRoom();
      store.addToast('error', 'The connection to the room was lost.');
    }
    const pending = store.pendingJoin;
    if (pending) {
      store.setPendingJoin(null);
      this.send(pending);
    }
  }

  private onMessage(ev: MessageEvent<unknown>): void {
    if (typeof ev.data !== 'string') return;
    let data: unknown;
    try {
      data = JSON.parse(ev.data) as unknown;
    } catch {
      return;
    }
    if (!isServerMessage(data)) return;
    this.handle(data);
  }

  private handle(msg: ServerMessage): void {
    const store = useGameStore.getState();
    switch (msg.t) {
      case 'welcome':
        if (msg.token === this.leavingToken) {
          // The seat we are releasing: the leave queued right behind the rejoin removes it.
          this.leavingToken = null;
          return;
        }
        this.rememberSession({ code: msg.room.code, token: msg.token, playerId: msg.playerId });
        store.handleServerMessage(msg);
        this.resumeOfflineOps(msg);
        return;
      case 'kicked':
        this.forgetSession();
        this.dropOfflineOps();
        break;
      case 'error':
        if (msg.code === 'REJOIN_FAILED') {
          if (this.leavingToken !== null) {
            // The seat we wanted to release had already expired: nothing left to do.
            this.leavingToken = null;
            return;
          }
          this.forgetSession();
        }
        break;
      case 'pong': {
        this.pongPending = false;
        this.clearPongTimer();
        // The server stamped the pong roughly half a round-trip after our ping left.
        const now = Date.now();
        const rtt = this.pingSentAt > 0 ? now - this.pingSentAt : 0;
        store.setClockOffset(msg.serverTime - (now - rtt / 2));
        return;
      }
      default:
        break;
    }
    store.handleServerMessage(msg);
  }

  private onClose(ws: WebSocket, code?: number): void {
    if (ws !== this.ws) return;
    this.ws = null;
    this.stopPing();
    if (code === CLOSE_REPLACED) {
      // Another tab (a duplicated tab shares sessionStorage) took this seat over. Rejoining from
      // here would only steal it back and the two tabs would bounce the seat forever.
      this.forgetSession();
      this.pendingLeave = null;
      this.dropOfflineOps();
      const store = useGameStore.getState();
      if (store.room) {
        store.resetRoom();
        store.addToast('warning', 'This room is open in another tab.');
      }
    }
    const store = useGameStore.getState();
    store.setConnection(this.everConnected ? 'reconnecting' : 'connecting');
    if (store.room && !this.lostToastShown) {
      store.addToast('warning', 'Connection lost — reconnecting…');
      this.lostToastShown = true;
    }
    this.scheduleReconnect();
  }

  /** Treats a socket as gone right away: closing a half-open socket can take the browser a long time. */
  private dropConnection(ws: WebSocket): void {
    if (ws !== this.ws) return;
    try {
      ws.close();
    } catch {
      /* already closing */
    }
    this.onClose(ws);
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = this.backoff + Math.random() * 250;
    this.backoff = Math.min(BACKOFF_MAX_MS, this.backoff * 2);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
    // The first pong also seeds the clock offset with a latency-corrected estimate.
    this.ping();
  }

  private ping(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (this.pongPending) {
      if (this.pongOverdue()) this.dropConnection(ws);
      return;
    }
    this.pingSentAt = Date.now();
    this.pongPending = true;
    this.send({ t: 'ping' });
    this.clearPongTimer();
    this.pongTimer = setTimeout(() => {
      if (this.pongPending) this.dropConnection(ws);
    }, PONG_TIMEOUT_MS);
  }

  private pongOverdue(): boolean {
    return this.pongPending && Date.now() - this.pingSentAt >= PONG_TIMEOUT_MS;
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPongTimer();
    this.pongPending = false;
  }

  private clearPongTimer(): void {
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }
}

export const socket = new GameSocket();
