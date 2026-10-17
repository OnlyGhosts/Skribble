import {
  CLOSE_REMOVED,
  CLOSE_REPLACED,
  CLOSE_RESTARTING,
  isPlatformServerMessage,
  isWireMessage,
  type PlatformClientMessage,
  type PlatformServerMessage,
  type RoomState,
  type StoredSession,
  type WireMessage,
} from '@shared/platform/protocol';
import { CHECKPOINT_MAX_AGE_MS, RECONNECT_GRACE_MS } from '@shared/platform/constants';
import { upgradeGameId } from '@shared/platform/games';
import {
  SEAT_REFRESH_MS,
  clearSeat,
  clearSession,
  heldSeat,
  loadCheckpoint,
  loadSession,
  saveSeat,
  saveSession,
  seatToResume,
  type SeatCheckpoint,
} from '../lib/storage';
import { platformRoomSounds } from '../lib/platformSounds';
import { registeredGame } from '../registry';
import { codeFromLocation } from '../router';
import { usePlatformStore, type JoinRequest } from '../store/usePlatformStore';
import { Outbox } from './outbox';
import { SendPacer, laneOf } from './pacer';
import { RoomRecovery } from './recovery';
import { wsUrl } from './server';

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
/** A pong this late answers a ping sent before a suspension; its round trip says nothing about latency. */
const MAX_SANE_RTT_MS = 2_000;
/**
 * A socket still CONNECTING after this long is given up and tried again: a handshake that hangs
 * (a network that came back half-way, a dropped SYN) would otherwise sit there for minutes.
 */
export const CONNECT_TIMEOUT_MS = 8_000;
/** On a wake-up, a socket CONNECTING for longer than this is replaced at once. */
export const STALE_CONNECTING_MS = 3_000;
/** After sending, no word at all from the server for this long: the link is probed. */
export const SEND_CHECK_MS = 1_500;
/** A probe still unanswered after this long shows the slow-connection notice (the probe itself gives up at PROBE_TIMEOUT_MS). */
export const SLOW_PILL_MS = 1_000;
/**
 * During a game, no frame at all for this long gets the link probed. The table may be waiting on
 * this phone with nothing for it to send (its turn came on a link that just went silent): without
 * this only the next keep-alive ping would notice, up to half a minute later.
 */
export const QUIET_PLAY_MS = 5_000;
/** How often the keep-alive checks whether a ping or a probe is due. */
const LIVENESS_TICK_MS = 1_000;

/** Messages that set up or tear down a seat; everything else is a room message, numbered and kept until confirmed. */
const SESSION_TYPES: ReadonlySet<string> = new Set(['create', 'join', 'rejoin', 'restore', 'leave', 'ping']);

/** Closes that mean the server went away (a restart, a deploy, a crash) rather than refused us. */
const SERVER_GONE_CODES: ReadonlySet<number> = new Set([1001, 1006, 1011, 1012]);

/** What the home screen says when a seat could not be resumed because the server restarted. */
export const SERVER_RESTARTED_TEXT = 'The server restarted, so that game ended.';

/** Application close codes the server uses; one definition for both sides. */
export { CLOSE_REMOVED, CLOSE_REPLACED };

interface Seat {
  code: string;
  token: string;
}

type HeldCheckpoint = Seat & SeatCheckpoint;

/**
 * A snapshot whose game id is current. A server still on the deploy before a game rename sends the
 * game's former id (Scribble's 'skribble'), which this bundle has no module or metadata for.
 */
function withCurrentGameId<M extends { room: RoomState }>(msg: M): M {
  const gameId = upgradeGameId(msg.room.gameId);
  if (gameId === null || gameId === msg.room.gameId) return msg;
  return { ...msg, room: { ...msg.room, gameId } };
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
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the running pong timer gives the socket up. */
  private pongDeadline = 0;
  private pingSentAt = 0;
  /** When the last frame came in on the current socket. */
  private lastHeardAt = 0;
  private pongPending = false;
  /** Frames received on this page: every frame is a sign of life. */
  private framesHeard = 0;
  /** A frame came in since the last ping went out (the server answers in order, so its pong is on the way). */
  private heardSincePing = false;
  /** The check that the server answers after a send (SEND_CHECK_MS). */
  private sendCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the socket now CONNECTING was created. */
  private connectingSince = 0;
  /** Room messages sent and not yet known to have arrived. */
  private readonly outbox = new Outbox();
  /**
   * Room messages numbered but not yet written to the current socket, in order: those sent while
   * a rejoin is in flight, then (after the welcome) whatever the room never got, paced to the
   * server's limits. A later message never overtakes them: the room skips any number below the
   * highest it has applied.
   */
  private backlog: WireMessage[] = [];
  private backlogTimer: ReturnType<typeof setTimeout> | null = null;
  /** What the current socket has sent, against the server's per-socket limits. */
  private pacer = new SendPacer();
  /** When the server's side of a room connection last went away (close 1001/1006 or a dead link), until the next welcome. */
  private serverGoneAt: number | null = null;
  /** A join typed on the home screen for a room whose seat this phone still holds: tried as a rejoin first, this is the fallback. */
  private joinFallback: JoinRequest | null = null;
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
  /** The newest checkpoint for the seat we hold; localStorage keeps it too (a reload, a closed tab). */
  private checkpoint: HeldCheckpoint | null = null;
  /** Bringing back a room a server restart lost: a restore, or quiet rejoins while another phone does. */
  private readonly recovery = new RoomRecovery();
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  /** The server is restarting (its close said so) or lost our room: the notice says so until the seat is back. */
  private restarting = false;

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
    window.addEventListener('offline', () => this.goneOffline());
    networkInformation()?.addEventListener('change', wake);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') wake();
    });
  }

  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Sends now when the socket is open (false otherwise: nothing is queued). A room message is
   * numbered and kept, so that after a reconnect the room gets whatever never reached it, once;
   * `keep: false` sends one that has its own recovery (a drawing's ops). While a rejoin is in
   * flight, or what an outage held back is still going out, a numbered message waits its turn
   * (true all the same: it will go). A send the server does not answer at all within
   * SEND_CHECK_MS gets the link probed.
   */
  send(msg: PlatformClientMessage | WireMessage, opts: { keep?: boolean } = {}): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (SESSION_TYPES.has(msg.t)) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    if (opts.keep === false) {
      this.write(ws, msg);
      return true;
    }
    const wire = this.outbox.stamp(msg, Date.now());
    if (this.rejoinSeat === null && this.backlog.length === 0) {
      this.write(ws, wire);
      return true;
    }
    this.backlog.push(wire);
    this.checkAnswer(ws);
    return true;
  }

  private write(ws: WebSocket, msg: WireMessage): void {
    ws.send(JSON.stringify(msg));
    this.pacer.record(laneOf(msg), Date.now());
    this.checkAnswer(ws);
  }

  /**
   * The home screen's join for a room this phone still holds a seat in (the tab was closed, the
   * code typed again): the seat is resumed, and only if the server no longer has it is `join`
   * sent instead. Returns false while the socket is down (the join then waits as usual).
   */
  resumeOrJoin(seat: { code: string; token: string }, join: JoinRequest): boolean {
    this.joinFallback = join;
    this.rejoinSeat = seat;
    if (this.send({ t: 'rejoin', code: seat.code, token: seat.token })) return true;
    this.joinFallback = null;
    this.rejoinSeat = null;
    return false;
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

  private saveSeatNow(session: StoredSession, dropCheckpoint = false): void {
    this.seatSavedAt = Date.now();
    const checkpoint = dropCheckpoint ? null : this.heldCheckpoint(session);
    saveSeat({ code: session.code, token: session.token, playerId: session.playerId, savedAt: this.seatSavedAt, ...(checkpoint ? { checkpoint } : {}) });
  }

  /**
   * The newest checkpoint this phone has for the seat, from memory or (after a reload) from
   * storage. One too old to open any more counts as none: the phone then waits for another to
   * bring the room back instead of having it refused.
   */
  private heldCheckpoint(seat: Seat): SeatCheckpoint | null {
    const held = this.checkpoint;
    const found = held && held.code === seat.code && held.token === seat.token ? { text: held.text, at: held.at } : loadCheckpoint(seat.code, seat.token);
    return found && Date.now() - found.at < CHECKPOINT_MAX_AGE_MS ? found : null;
  }

  /**
   * A checkpoint for the room we sit in replaces the one kept with the seat; `null` (this phone no
   * longer gets them) drops it, so an old copy can never roll the room back.
   */
  private keepCheckpoint(text: string | null): void {
    const session = this.currentSession();
    if (!session || usePlatformStore.getState().room?.code !== session.code) return;
    this.checkpoint = text === null ? null : { code: session.code, token: session.token, text, at: Date.now() };
    this.saveSeatNow(session, text === null);
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
    this.checkpoint = null;
    this.endRecovery();
    this.dropBacklog();
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
    this.connectingSince = Date.now();
    this.clearConnectTimer();
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (ws === this.ws && ws.readyState === WebSocket.CONNECTING) this.dropConnection(ws);
    }, CONNECT_TIMEOUT_MS);
    ws.addEventListener('open', () => this.onOpen(ws));
    // A socket given up on may still deliver a frame or two: only the current one is listened to.
    ws.addEventListener('message', (ev: MessageEvent<unknown>) => {
      if (ws === this.ws) this.onMessage(ev);
    });
    ws.addEventListener('close', (ev: CloseEvent) => this.onClose(ws, ev.code));
    // 'error' is always followed by 'close', which drives the reconnect.
  }

  /**
   * The page woke up (foreground, focus, bfcache, network back or changed). A closed socket is
   * reopened now, backoff reset; an open one is probed, since a background suspension or a
   * network switch can leave it dead without a close event; a handshake that has been hanging
   * for a while is abandoned for a fresh one.
   */
  private wakeUp(): void {
    // A network change that left the browser offline: nothing to probe, the link is gone.
    if (navigator.onLine === false) return this.goneOffline();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.probe();
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      if (Date.now() - this.connectingSince < STALE_CONNECTING_MS) return;
      this.dropConnection(this.ws);
    }
    this.backoff = BACKOFF_MIN_MS;
    this.connect();
  }

  /**
   * The network went away: the socket cannot be alive, whatever it says. The banner shows at once
   * and the reconnect starts; 'online' wakes it again. The old socket is left to the browser (or
   * to the server, which replaces it on the rejoin) rather than closed or written to from here.
   */
  private goneOffline(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.onClose(this.ws);
  }

  private onOpen(ws: WebSocket): void {
    // A handshake given up on that went through after all: not ours any more (closing an open socket is quiet).
    if (ws !== this.ws) {
      ws.close();
      return;
    }
    const store = usePlatformStore.getState();
    this.backoff = BACKOFF_MIN_MS;
    this.everConnected = true;
    this.openedAt = Date.now();
    this.lastHeardAt = this.openedAt;
    this.pacer = new SendPacer();
    this.clearConnectTimer();
    store.setConnection(this.restarting ? 'restarting' : 'connected');
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
    // A rejoin left over from the socket before is not in flight on this one.
    this.rejoinSeat = seat;
    if (seat) {
      store.setRejoining(true);
      this.send({ t: 'rejoin', code: seat.code, token: seat.token });
      return;
    }
    this.endRecovery();
    if (store.room) {
      // We were in a room but have no usable seat token: nothing to resume.
      store.resetRoom();
      store.addToast('error', 'The connection to the room was lost.');
    }
    const pending = store.pendingJoin;
    if (pending) {
      store.setPendingJoin(null);
      const seat = pending.t === 'join' ? heldSeat(pending.code, Date.now()) : null;
      if (!seat || !this.resumeOrJoin(seat, pending)) this.send(pending);
    }
  }

  private onMessage(ev: MessageEvent<unknown>): void {
    this.heard();
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

  private handle(received: PlatformServerMessage): void {
    const msg = received.t === 'welcome' || received.t === 'room' ? withCurrentGameId(received) : received;
    const store = usePlatformStore.getState();
    switch (msg.t) {
      case 'welcome': {
        if (msg.token === this.leavingToken) {
          // The seat we are releasing: the leave queued right behind the rejoin removes it.
          this.leavingToken = null;
          return;
        }
        const sameSeat = this.session !== null && this.session.code === msg.room.code && this.session.playerId === msg.playerId;
        this.rejoinSeat = null;
        this.joinFallback = null;
        this.serverGoneAt = null;
        this.endRecovery();
        this.rememberSession({ code: msg.room.code, gameId: msg.room.gameId, token: msg.token, playerId: msg.playerId });
        // A welcome for another seat (or the first one) is a fresh entry, not a continuation.
        const prev = store.playerId === msg.playerId ? store.room : null;
        // First, so that whatever is sent on the welcome (a game's queued bet) goes out after what the outage held back.
        this.resend(sameSeat, msg.seq ?? 0);
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
        platformRoomSounds(msg.room, prev, store.playerId);
        return;
      }
      case 'chat': {
        const room = store.room;
        if (room === null) return;
        store.handleServerMessage(msg);
        registeredGame(room.gameId)?.onChat?.(msg.message);
        return;
      }
      case 'checkpoint':
        this.keepCheckpoint(msg.checkpoint);
        return;
      case 'kicked':
        this.forgetSession();
        break;
      case 'error':
        if (msg.code === 'RATE_LIMITED' && this.recovery.restoring) {
          // Only the restore can be refused this way (room messages wait for the seat): no new restore, but quiet rejoins.
          if (!this.recoverRoom()) this.handle({ t: 'error', code: 'REJOIN_FAILED', message: msg.message });
          return;
        }
        if (msg.code === 'REJOIN_FAILED') {
          if (this.leavingToken !== null) {
            // The seat we wanted to release had already expired: nothing left to do.
            this.leavingToken = null;
            return;
          }
          if (msg.roomGone === true && this.recoverRoom()) return;
          // The room was lost to a restart (or a restore of it refused): the game ended with it.
          const lost = msg.roomGone === true || this.recovery.active;
          this.endRecovery();
          const fallback = this.joinFallback;
          if (fallback) {
            // The seat typed back into is gone: join as a newcomer instead, the join still pending.
            const code = this.rejoinSeat?.code;
            this.joinFallback = null;
            this.rejoinSeat = null;
            if (code) clearSeat(code);
            this.send(fallback);
            return;
          }
          const restarted = this.serverRestarted(msg.message, lost);
          this.forgetSession();
          if (restarted) {
            store.resetRoom();
            store.addToast('warning', SERVER_RESTARTED_TEXT);
            return;
          }
        } else if (store.room) {
          registeredGame(store.room.gameId)?.onError?.(msg.code, msg.message);
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
    this.clearConnectTimer();
    this.clearSendChecks();
    // Still in the outbox: the next welcome says which of them the room is missing.
    this.dropBacklog();
    usePlatformStore.getState().setSlow(false);
    this.clearRecoveryTimer();
    this.recovery.connectionLost();
    // A room connection (or a seat being resumed) the server dropped, or that died under us: a rejoin refused next means the server lost the room.
    const inRoom = usePlatformStore.getState().room !== null || usePlatformStore.getState().rejoining;
    if (inRoom && (code === undefined || SERVER_GONE_CODES.has(code))) this.serverGoneAt ??= Date.now();
    if (inRoom && code === CLOSE_RESTARTING) this.restarting = true;
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
    store.setConnection(this.restarting ? 'restarting' : this.everConnected ? 'reconnecting' : 'connecting');
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

  /** Any frame from the server proves the link: the slow notice and the checks on what was sent clear. */
  private heard(): void {
    this.framesHeard++;
    this.lastHeardAt = Date.now();
    this.heardSincePing = true;
    this.clearSendChecks();
    usePlatformStore.getState().setSlow(false);
  }

  /**
   * After a send, the server should say something soon (the room's answer, a snapshot). Silence
   * gets the link probed, the notice comes up while the probe is out, and a probe that goes
   * unanswered drops the socket so the reconnect, and the resend of what was lost, run.
   */
  private checkAnswer(ws: WebSocket): void {
    if (this.sendCheckTimer !== null) return;
    const heard = this.framesHeard;
    const silent = () => ws === this.ws && this.framesHeard === heard;
    this.sendCheckTimer = setTimeout(() => {
      this.sendCheckTimer = null;
      if (!silent()) return;
      this.probe();
      this.slowTimer = setTimeout(() => {
        this.slowTimer = null;
        if (silent()) usePlatformStore.getState().setSlow(true);
      }, SLOW_PILL_MS);
    }, SEND_CHECK_MS);
  }

  private clearSendChecks(): void {
    if (this.sendCheckTimer !== null) clearTimeout(this.sendCheckTimer);
    if (this.slowTimer !== null) clearTimeout(this.slowTimer);
    this.sendCheckTimer = null;
    this.slowTimer = null;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  /**
   * After a welcome: into the same seat, whatever the room had not applied (above `applied`) goes
   * again, in order, the messages held back during the rejoin included; into another seat,
   * nothing kept belongs to it.
   */
  private resend(sameSeat: boolean, applied: number): void {
    this.dropBacklog();
    if (!sameSeat) {
      this.outbox.reset(applied);
      return;
    }
    this.backlog = this.outbox.resume(applied, Date.now());
    this.flushBacklog();
  }

  /** Writes the backlog in order, as fast as the server's limits allow, and comes back for the rest. */
  private flushBacklog(): void {
    this.backlogTimer = null;
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (this.backlog.length > 0) {
      const wait = this.pacer.waitFor(laneOf(this.backlog[0]), Date.now());
      if (wait > 0) {
        this.backlogTimer = setTimeout(() => this.flushBacklog(), wait);
        return;
      }
      const next = this.backlog.shift();
      if (next) this.write(ws, next);
    }
  }

  private dropBacklog(): void {
    if (this.backlogTimer !== null) clearTimeout(this.backlogTimer);
    this.backlogTimer = null;
    this.backlog = [];
  }

  /**
   * The rejoin found no room, and the server says a restart may have lost it. A phone holding a
   * checkpoint for the seat sends it to bring the room back; one without asks again quietly for a
   * while, in case another phone does. So does a page just opened, and a code typed on the home
   * screen before it falls back to joining as a newcomer: the seat stays stored until then. False
   * when there is nothing left to try.
   */
  private recoverRoom(): boolean {
    const seat = this.rejoinSeat;
    if (!seat) return false;
    const step = this.recovery.roomGone(Date.now(), this.heldCheckpoint(seat)?.text ?? null);
    if (step.kind === 'giveUp') return false;
    this.restarting = true;
    usePlatformStore.getState().setConnection('restarting');
    if (step.kind === 'restore') {
      this.send({ t: 'restore', code: seat.code, token: seat.token, checkpoint: step.checkpoint });
      return true;
    }
    this.clearRecoveryTimer();
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      if (this.rejoinSeat === seat) this.send({ t: 'rejoin', code: seat.code, token: seat.token });
    }, step.inMs);
    return true;
  }

  /** The seat is back, or will not be: the restarting notice goes. */
  private endRecovery(): void {
    this.recovery.end();
    this.clearRecoveryTimer();
    if (!this.restarting) return;
    this.restarting = false;
    if (this.isOpen()) usePlatformStore.getState().setConnection('connected');
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer !== null) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  /**
   * A refused rejoin of a seat that was not taken from us (a kick says so), either right after the
   * server dropped us, for a seat that cannot have expired yet (the grace is minutes long), or
   * after the server said a restart lost the room (`lost`): the server lost its rooms, which only
   * a restart does.
   */
  private serverRestarted(reason: string, lost: boolean): boolean {
    const goneAt = this.serverGoneAt;
    this.serverGoneAt = null;
    return (lost || (goneAt !== null && Date.now() - goneAt < RECONNECT_GRACE_MS)) && !/removed/i.test(reason);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.keepAlive(), LIVENESS_TICK_MS);
    // The first pong also seeds the clock offset with a latency-corrected estimate.
    this.ping();
  }

  /** A ping every PING_INTERVAL_MS, and during a game a probe once the link has been quiet for QUIET_PLAY_MS. */
  private keepAlive(): void {
    const now = Date.now();
    if (now - this.pingSentAt >= PING_INTERVAL_MS) return this.ping();
    const playing = usePlatformStore.getState().room?.phase === 'playing';
    if (playing && !this.pongPending && now - this.lastHeardAt >= QUIET_PLAY_MS) this.probe();
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
    // A ping still out but answered by other frames since says nothing about the link now: ask again.
    if (!this.pongPending || this.heardSincePing) {
      this.sendPing(ws, PROBE_TIMEOUT_MS);
      return;
    }
    if (this.pongOverdue()) this.dropConnection(ws);
    // Only ever brought forward: probes after each send on a dead link must not keep pushing it back.
    else if (this.pongTimer === null || this.pongDeadline - Date.now() > PROBE_TIMEOUT_MS) this.armPongTimer(ws, PROBE_TIMEOUT_MS);
  }

  private sendPing(ws: WebSocket, timeoutMs: number): void {
    this.pingSentAt = Date.now();
    this.pongPending = true;
    this.heardSincePing = false;
    this.send({ t: 'ping' });
    this.armPongTimer(ws, timeoutMs);
  }

  private armPongTimer(ws: WebSocket, timeoutMs: number): void {
    this.clearPongTimer();
    this.pongDeadline = Date.now() + timeoutMs;
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      // Any frame since the ping counts: a server busy sending is not a dead one.
      if (this.pongPending && !this.heardSincePing) this.dropConnection(ws);
    }, timeoutMs);
  }

  private pongOverdue(): boolean {
    return this.pongPending && !this.heardSincePing && Date.now() - this.pingSentAt >= PONG_TIMEOUT_MS;
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

/** The Network Information API where the browser has it (Chrome, Android): its 'change' is a network switch. */
function networkInformation(): EventTarget | null {
  const connection: unknown = Reflect.get(navigator, 'connection');
  return connection instanceof EventTarget ? connection : null;
}

export const socket = new GameSocket();
