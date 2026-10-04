import { WS_PATH, isServerMessage, type ClientMessage, type DrawOp, type ServerMessage } from '@shared/protocol';
import { useGameStore } from '../store/useGameStore';
import { clearSession, loadSession, saveSession } from '../lib/storage';
import { codeFromLocation } from '../lib/url';

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8000;
const PING_INTERVAL_MS = 20_000;
const DRAW_FLUSH_MS = 30;
const MAX_OPS_PER_MESSAGE = 200;
const MAX_PTS_PER_MOVE = 2000;

export function wsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}${WS_PATH}`;
}

class GameSocket {
  private ws: WebSocket | null = null;
  private started = false;
  private everConnected = false;
  private backoff = BACKOFF_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingSentAt = 0;
  private drawTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOps: DrawOp[] = [];
  private lostToastShown = false;

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
    // While offline the ops are dropped: the server resyncs the whole canvas on rejoin.
    if (!this.isOpen()) return;
    for (let i = 0; i < ops.length; i += MAX_OPS_PER_MESSAGE) {
      this.send({ t: 'draw', ops: ops.slice(i, i + MAX_OPS_PER_MESSAGE) });
    }
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
    ws.addEventListener('close', () => this.onClose(ws));
    // 'error' is always followed by 'close', which drives the reconnect.
  }

  private reconnectNow(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
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

    const session = loadSession();
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
        saveSession({ code: msg.room.code, token: msg.token, playerId: msg.playerId });
        break;
      case 'kicked':
        clearSession();
        break;
      case 'error':
        if (msg.code === 'REJOIN_FAILED') clearSession();
        break;
      case 'pong': {
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

  private onClose(ws: WebSocket): void {
    if (ws !== this.ws) return;
    this.ws = null;
    this.stopPing();
    const store = useGameStore.getState();
    store.setConnection(this.everConnected ? 'reconnecting' : 'connecting');
    if (store.room && !this.lostToastShown) {
      store.addToast('warning', 'Connection lost — reconnecting…');
      this.lostToastShown = true;
    }
    this.scheduleReconnect();
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
    this.pingTimer = setInterval(() => {
      this.pingSentAt = Date.now();
      this.send({ t: 'ping' });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

export const socket = new GameSocket();
