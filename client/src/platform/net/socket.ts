import {
  CLOSE_REMOVED,
  CLOSE_REPLACED,
  WS_PATH,
  isPlatformServerMessage,
  isWireMessage,
  type PlatformClientMessage,
  type PlatformServerMessage,
  type StoredSession,
  type WireMessage,
} from '@shared/platform/protocol';
import { SEAT_REFRESH_MS, clearSeat, clearSession, loadSession, saveSeat, saveSession, seatToResume } from '../lib/storage';
import { registeredGame } from '../registry';
import { codeFromLocation } from '../router';
import { usePlatformStore } from '../store/usePlatformStore';

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8000;
export const PING_INTERVAL_MS = 20_000;
/**
 * A ping unanswered for this long means the link is half-open (Wi-Fi to cellular hand-over, a
 * suspended server, a closed laptop lid): the socket is dropped so the usual reconnect runs.
 */
export const PONG_TIMEOUT_MS = 10_000;
/** After a wake-up (tab to the foreground, network back) an open socket gets this long to answer a probe. */
export const PROBE_TIMEOUT_MS = 3_000;
/**
 * A connection that lived at least this long was healthy, so its close is not the server refusing
 * us: the hosting cuts every socket at its function time limit, phones drop links in the
 * background. Such a close is retried at once instead of after the backoff.
 */
export const LONG_LIVED_MS = 30_000;
/** A reconnect still not through after this long is worth the one "connection lost" toast. */
export const SLOW_RECONNECT_MS = 5_000;
/** A pong this late answers a ping sent before a suspension; its round trip says nothing about latency. */
const MAX_SANE_RTT_MS = 2_000;

/** Application close codes the server uses; one definition for both sides. */
export { CLOSE_REMOVED, CLOSE_REPLACED };

export function wsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}${WS_PATH}`;
}

interface Seat {
  code: string;
  token: string;
}

/**
 * The one WebSocket of the page. Platform messages update the platform store; anything else is a
 * game message for the module of the room we are in. Reconnects with backoff, keeps the seat
 * across reloads and discarded tabs, and tells the game module about welcomes, snapshots, chat
 * lines and leaves.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private started = false;
  private everConnected = false;
  /** When the current socket opened; 0 while none is open. */
  private openedAt = 0;
  private backoff = BACKOFF_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private slowReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private pingSentAt = 0;
  private pongPending = false;
  private lostToastShown = false;
  /**
   * The seat we hold, as last told by `welcome`. sessionStorage is the reload path; this copy
   * covers environments where storage is unavailable (private windows, blocked site data).
   */
  private session: StoredSession | null = null;
  /** When the localStorage seat entry was last written. */
  private seatSavedAt = 0;
  /** The seat of the rejoin in flight; its code's entry goes when the server refuses it. */
  private rejoinSeat: Seat | null = null;
  /** A leave the server never received (the socket was down); released on the next connection. */
  private pendingLeave: StoredSession | null = null;
  /** Token of the seat being released through rejoin + leave; its welcome must not enter the room. */
  private leavingToken: string | null = null;

  /** Opens the connection and keeps it alive for the lifetime of the page. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    // Known before the socket opens, so the home screen shows "rejoining" rather than the join form.
    if (this.resumableSeat() !== null) usePlatformStore.getState().setRejoining(true);
    this.connect();
    const wake = () => this.wakeUp();
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') wake();
    });
  }

  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: PlatformClientMessage | WireMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /**
   * Explicit leave. The seat is released now, or, when the socket is down, as soon as it is back
   * (otherwise the server keeps a ghost seat for the whole reconnect grace period).
   */
  leave(): void {
    const session = this.currentSession();
    if (!this.send({ t: 'leave' }) && session) this.pendingLeave = session;
    this.forgetSession();
  }

  private currentSession(): StoredSession | null {
    return loadSession() ?? this.session;
  }

  /** The seat to resume on this connection: ours for the room we are in, or one remembered for the room on the address bar. */
  private resumableSeat(): Seat | null {
    const code = usePlatformStore.getState().room?.code ?? codeFromLocation();
    return seatToResume(code, this.currentSession(), Date.now());
  }

  private rememberSession(session: StoredSession): void {
    this.session = session;
    saveSession(session);
    this.saveSeatNow(session);
  }

  private saveSeatNow(session: StoredSession): void {
    this.seatSavedAt = Date.now();
    saveSeat({ code: session.code, token: session.token, playerId: session.playerId, savedAt: this.seatSavedAt });
  }

  /** Keeps the localStorage entry's age below the reconnect grace while we sit in the room (snapshots and pongs call it). */
  private refreshSeat(): void {
    const session = this.currentSession();
    if (session && Date.now() - this.seatSavedAt >= SEAT_REFRESH_MS) this.saveSeatNow(session);
  }

  /**
   * Drops the seat from memory and storage. `keepSeat` leaves the localStorage entry alone when
   * another tab of this browser holds the seat now.
   */
  private forgetSession(opts: { keepSeat?: boolean } = {}): void {
    const codes = new Set<string>();
    for (const s of [this.session, loadSession()]) if (s) codes.add(s.code);
    if (this.rejoinSeat) codes.add(this.rejoinSeat.code);
    this.session = null;
    this.rejoinSeat = null;
    clearSession();
    if (!opts.keepSeat) for (const code of codes) clearSeat(code);
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

  /**
   * The page woke up (foreground, focus, bfcache, network back). A closed socket is reopened now,
   * backoff reset; an open one is probed, since a background suspension can leave it dead without
   * a close event.
   */
  private wakeUp(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.probe();
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
    this.backoff = BACKOFF_MIN_MS;
    this.connect();
  }

  private onOpen(ws: WebSocket): void {
    if (ws !== this.ws) return;
    const store = usePlatformStore.getState();
    this.backoff = BACKOFF_MIN_MS;
    this.everConnected = true;
    this.openedAt = Date.now();
    this.clearSlowReconnectTimer();
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

    const seat = this.resumableSeat();
    if (seat) {
      this.rejoinSeat = seat;
      store.setRejoining(true);
      this.send({ t: 'rejoin', code: seat.code, token: seat.token });
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
    if (isPlatformServerMessage(data)) this.handle(data);
    else if (isWireMessage(data)) this.handleGameMessage(data);
  }

  /** A game message only means something while we hold a seat; after a leave it belongs to a room we are no longer in. */
  private handleGameMessage(msg: WireMessage): void {
    const room = usePlatformStore.getState().room;
    if (room === null) return;
    registeredGame(room.gameId)?.onServerMessage?.(msg);
  }

  private handle(msg: PlatformServerMessage): void {
    const store = usePlatformStore.getState();
    switch (msg.t) {
      case 'welcome': {
        if (msg.token === this.leavingToken) {
          // The seat we are releasing: the leave queued right behind the rejoin removes it.
          this.leavingToken = null;
          return;
        }
        this.rejoinSeat = null;
        this.rememberSession({ code: msg.room.code, gameId: msg.room.gameId, token: msg.token, playerId: msg.playerId });
        // A welcome for another seat (or the first one) is a fresh entry, not a continuation.
        const prev = store.playerId === msg.playerId ? store.room : null;
        store.handleServerMessage(msg);
        const game = registeredGame(msg.room.gameId);
        game?.onWelcome?.(msg.extra);
        game?.onRoom?.(msg.room, prev);
        return;
      }
      case 'room': {
        const prev = store.room;
        if (prev === null) return;
        this.refreshSeat();
        store.handleServerMessage(msg);
        registeredGame(msg.room.gameId)?.onRoom?.(msg.room, prev);
        return;
      }
      case 'chat': {
        const room = store.room;
        if (room === null) return;
        store.handleServerMessage(msg);
        registeredGame(room.gameId)?.onChat?.(msg.message);
        return;
      }
      case 'kicked':
        this.forgetSession();
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
        // The seat is live: its localStorage entry's age restarts even when no snapshot has come
        // for a while (a quiet reveal, a long round), so a tab discarded after an idle stretch
        // still finds a fresh entry on the way back.
        this.refreshSeat();
        // The server stamped the pong roughly half a round-trip after our ping left.
        const now = Date.now();
        const rtt = this.pingSentAt > 0 ? now - this.pingSentAt : 0;
        if (rtt <= MAX_SANE_RTT_MS) store.setClockOffset(msg.serverTime - (now - rtt / 2));
        return;
      }
    }
    store.handleServerMessage(msg);
  }

  private onClose(ws: WebSocket, code?: number): void {
    if (ws !== this.ws) return;
    this.ws = null;
    this.stopPing();
    const lived = this.openedAt > 0 ? Date.now() - this.openedAt : 0;
    this.openedAt = 0;
    if (code === CLOSE_REPLACED) {
      // Another tab (a duplicated tab shares sessionStorage) took this seat over. Rejoining from
      // here would only steal it back and the two tabs would bounce the seat forever.
      this.forgetSession({ keepSeat: true });
      this.pendingLeave = null;
      const store = usePlatformStore.getState();
      if (store.room) {
        store.resetRoom();
        store.addToast('warning', 'This room is open in another tab.');
      }
    }
    const store = usePlatformStore.getState();
    store.setConnection(this.everConnected ? 'reconnecting' : 'connecting');
    if (store.room) this.armSlowReconnectToast();
    if (lived >= LONG_LIVED_MS) {
      this.backoff = BACKOFF_MIN_MS;
      this.connect();
    } else {
      this.scheduleReconnect();
    }
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

  /** The pill shows every reconnect; a toast only when one drags on (the routine hosting cuts never do). */
  private armSlowReconnectToast(): void {
    if (this.slowReconnectTimer !== null || this.lostToastShown) return;
    this.slowReconnectTimer = setTimeout(() => {
      this.slowReconnectTimer = null;
      const store = usePlatformStore.getState();
      if (this.isOpen() || !store.room || this.lostToastShown) return;
      store.addToast('warning', 'Connection lost — reconnecting…');
      this.lostToastShown = true;
    }, SLOW_RECONNECT_MS);
  }

  private clearSlowReconnectTimer(): void {
    if (this.slowReconnectTimer !== null) {
      clearTimeout(this.slowReconnectTimer);
      this.slowReconnectTimer = null;
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
    this.sendPing(ws, PONG_TIMEOUT_MS);
  }

  /** A wake-up probe: one short deadline, so a socket killed during a suspension is replaced now. */
  private probe(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!this.pongPending) {
      this.sendPing(ws, PROBE_TIMEOUT_MS);
      return;
    }
    if (this.pongOverdue()) this.dropConnection(ws);
    else this.armPongTimer(ws, PROBE_TIMEOUT_MS);
  }

  private sendPing(ws: WebSocket, timeoutMs: number): void {
    this.pingSentAt = Date.now();
    this.pongPending = true;
    this.send({ t: 'ping' });
    this.armPongTimer(ws, timeoutMs);
  }

  private armPongTimer(ws: WebSocket, timeoutMs: number): void {
    this.clearPongTimer();
    this.pongTimer = setTimeout(() => {
      if (this.pongPending) this.dropConnection(ws);
    }, timeoutMs);
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
