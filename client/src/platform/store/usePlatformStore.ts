import { create } from 'zustand';
import type { ChatMessage, ErrorCode, PlatformClientMessageOf, PlatformServerMessage, RoomState } from '@shared/platform/protocol';
import { friendlyError, rejoinFailureText, type JoinErrorCode } from '../lib/format';
import { loadPrefs, savePrefs, type Prefs, type Theme } from '../lib/storage';
import { registeredGame } from '../registry';
import { codeFromLocation, gamePath, navigate } from '../router';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface JoinError {
  code: JoinErrorCode;
  message: string;
}

export type JoinRequest = PlatformClientMessageOf<'create'> | PlatformClientMessageOf<'join'>;

const CHAT_CAP = 300;
const MAX_TOASTS = 4;
const TOAST_MS = 4500;
const JOIN_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['ROOM_NOT_FOUND', 'ROOM_FULL', 'GAME_IN_PROGRESS', 'INVALID_CODE']);

interface PlatformState {
  connection: ConnectionStatus;
  playerId: string | null;
  /** The room as the server last showed it to us; the game's view sits in `room.game`, typed per game by its module. */
  room: RoomState | null;
  /** True while a 'rejoin' is in flight after a reload or reconnect. */
  rejoining: boolean;
  chat: ChatMessage[];
  toasts: Toast[];
  prefs: Prefs;
  /** True between sending create/join and receiving 'welcome' or an error. */
  joinPending: boolean;
  /** A create/join request waiting for the socket to open. */
  pendingJoin: JoinRequest | null;
  joinError: JoinError | null;
  /** serverTime - Date.now(); add it to local time to get server time. */
  clockOffset: number;
  /**
   * True once a pong gave a latency-corrected offset. Until then snapshots seed the offset (they
   * are biased by the one-way latency, so they never override a pong-based value).
   */
  clockSynced: boolean;
}

interface PlatformActions {
  setConnection(status: ConnectionStatus): void;
  setRejoining(value: boolean): void;
  setClockOffset(offset: number): void;
  /** Platform messages only; the socket hands game messages to the game module. */
  handleServerMessage(msg: PlatformServerMessage): void;
  beginJoin(request: JoinRequest): void;
  setPendingJoin(request: JoinRequest | null): void;
  failJoin(error: JoinError): void;
  clearJoinError(): void;
  /**
   * Leaves room state behind and tells the game module (`onLeave`). An address bar still naming
   * the room moves to the game's home synchronously, so the home screen never reads the old room
   * code; one that already went elsewhere (Back, the brand link) is left where the user put it.
   * `keepUrl` preserves the room's URL when the seat expired but the room may still exist (one
   * click joins again).
   */
  resetRoom(opts?: { keepUrl?: boolean }): void;
  addToast(kind: ToastKind, text: string): void;
  dismissToast(id: number): void;
  setTheme(theme: Theme | null): void;
  setSound(on: boolean): void;
}

export type PlatformStore = PlatformState & PlatformActions;

let toastSeq = 0;

function appendChat(chat: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const next = chat.length >= CHAT_CAP ? chat.slice(chat.length - CHAT_CAP + 1) : chat.slice();
  next.push(message);
  return next;
}

export const usePlatformStore = create<PlatformStore>()((set, get) => ({
  connection: 'connecting',
  playerId: null,
  room: null,
  rejoining: false,
  chat: [],
  toasts: [],
  prefs: loadPrefs(),
  joinPending: false,
  pendingJoin: null,
  joinError: null,
  clockOffset: 0,
  clockSynced: false,

  setConnection: (connection) => set({ connection }),
  setRejoining: (rejoining) => set({ rejoining }),
  setClockOffset: (clockOffset) => set({ clockOffset, clockSynced: true }),

  handleServerMessage: (msg) => {
    // Only 'welcome' (re)enters a room: a snapshot or chat line still in flight when we left must
    // not resurrect a ghost room the server no longer knows us in.
    if (get().room === null && (msg.t === 'room' || msg.t === 'chat')) return;
    switch (msg.t) {
      case 'welcome':
        set((s) => ({
          playerId: msg.playerId,
          room: msg.room,
          chat: msg.chat.slice(-CHAT_CAP),
          joinPending: false,
          pendingJoin: null,
          joinError: null,
          rejoining: false,
          ...(s.clockSynced ? {} : { clockOffset: msg.room.serverTime - Date.now() }),
        }));
        break;
      case 'room':
        set((s) => ({ room: msg.room, ...(s.clockSynced ? {} : { clockOffset: msg.room.serverTime - Date.now() }) }));
        break;
      case 'chat':
        set((s) => ({ chat: appendChat(s.chat, msg.message) }));
        break;
      case 'error': {
        if (msg.code === 'REJOIN_FAILED') {
          get().resetRoom({ keepUrl: true });
          get().addToast('warning', rejoinFailureText(msg.message));
          break;
        }
        if (JOIN_ERROR_CODES.has(msg.code) || get().joinPending) {
          get().failJoin({ code: msg.code, message: friendlyError(msg.code, msg.message) });
          break;
        }
        get().addToast('error', friendlyError(msg.code, msg.message));
        break;
      }
      case 'kicked':
        get().addToast('error', msg.reason ? `You were removed from the room: ${msg.reason}` : 'You were removed from the room.');
        get().resetRoom();
        break;
      case 'pong':
        break;
    }
  },

  beginJoin: (request) => set({ joinPending: true, pendingJoin: request, joinError: null }),
  setPendingJoin: (pendingJoin) => set({ pendingJoin }),
  failJoin: (joinError) => set({ joinPending: false, pendingJoin: null, joinError }),
  clearJoinError: () => set({ joinError: null }),

  resetRoom: (opts) => {
    const room = get().room;
    if (room) registeredGame(room.gameId)?.onLeave?.();
    set({ room: null, playerId: null, chat: [], rejoining: false, joinPending: false, pendingJoin: null });
    // After the state is cleared, so routeSync sees a room-less store and does not leave a second time.
    if (room && !opts?.keepUrl && codeFromLocation() === room.code) navigate(gamePath(room.gameId), { replace: true });
  },

  addToast: (kind, text) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), { id, kind, text }] }));
    window.setTimeout(() => get().dismissToast(id), TOAST_MS);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setTheme: (theme) => {
    const prefs: Prefs = { ...get().prefs, theme };
    savePrefs(prefs);
    set({ prefs });
  },
  setSound: (sound) => {
    const prefs: Prefs = { ...get().prefs, sound };
    savePrefs(prefs);
    set({ prefs });
  },
}));
