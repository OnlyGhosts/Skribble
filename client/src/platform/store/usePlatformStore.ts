import { create } from 'zustand';
import type { ChatMessage, ErrorCode, GameResults, PlatformClientMessageOf, PlatformServerMessage, RoomState } from '@shared/platform/protocol';
import { friendlyError, rejoinFailureText, type JoinErrorCode } from '../lib/format';
import { resultsToShow } from '../lib/results';
import { loadPrefs, loadResultsSeen, loadResultsShown, savePrefs, saveResultsSeen, saveResultsShown, type Prefs, type Theme } from '../lib/storage';
import { registeredGame } from '../registry';
import { codeFromLocation, navigate } from '../router';

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
/** Informational toasts go after this long. */
export const TOAST_MS = 4000;
/** Errors stay a little longer, then go too: a stack of them must never pile up over the game. */
export const ERROR_TOAST_MS = 5000;
const JOIN_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['ROOM_NOT_FOUND', 'ROOM_FULL', 'INVALID_CODE']);

interface PlatformState {
  connection: ConnectionStatus;
  /** The socket is open but the server has not answered what was sent for a while (a weak or switching network). */
  slow: boolean;
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
  /** The last game's results, up over the lobby until this player closes them (see resultsToShow). */
  results: GameResults | null;
  /** The id of the last results this tab closed (kept in sessionStorage too, so a reload remembers). */
  resultsSeen: string | null;
  /** The id of the results on show and not closed yet (kept in sessionStorage too, so a reload brings them back). */
  resultsShown: string | null;
}

interface PlatformActions {
  setConnection(status: ConnectionStatus): void;
  setSlow(slow: boolean): void;
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
   * the room moves to the front door ('/') synchronously, so the home screen never reads the old
   * room code; one that already went elsewhere (Back, the wordmark link) is left where the user
   * put it. `keepUrl` preserves the room's URL when the seat expired but the room may still exist
   * (one click joins again).
   */
  resetRoom(opts?: { keepUrl?: boolean }): void;
  addToast(kind: ToastKind, text: string): void;
  dismissToast(id: number): void;
  setTheme(theme: Theme | null): void;
  setSound(on: boolean): void;
  /** Closes the results for good: this tab will not show them again, reload or not. */
  closeResults(): void;
}

export type PlatformStore = PlatformState & PlatformActions;

let toastSeq = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

function appendChat(chat: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const next = chat.length >= CHAT_CAP ? chat.slice(chat.length - CHAT_CAP + 1) : chat.slice();
  next.push(message);
  return next;
}

/** The results to put up, remembered for a reload while they stay up (see resultsToShow). */
function showResults(s: PlatformState, results: GameResults | null): Pick<PlatformState, 'results' | 'resultsShown'> {
  if (results === null || results.id === s.resultsShown) return { results, resultsShown: s.resultsShown };
  saveResultsShown(results.id);
  return { results, resultsShown: results.id };
}

export const usePlatformStore = create<PlatformStore>()((set, get) => ({
  connection: 'connecting',
  slow: false,
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
  results: null,
  resultsSeen: loadResultsSeen(),
  resultsShown: loadResultsShown(),

  setConnection: (connection) => set({ connection }),
  setSlow: (slow) => {
    if (get().slow !== slow) set({ slow });
  },
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
          // The same seat coming back keeps what it saw (a game that ended during the outage shows its results).
          ...showResults(s, resultsToShow(msg.room, s.playerId === msg.playerId ? s.room : null, msg.playerId, s.results, s.resultsSeen, s.resultsShown)),
          chat: msg.chat.slice(-CHAT_CAP),
          joinPending: false,
          pendingJoin: null,
          joinError: null,
          rejoining: false,
          ...(s.clockSynced ? {} : { clockOffset: msg.room.serverTime - Date.now() }),
        }));
        break;
      case 'room':
        set((s) => ({
          room: msg.room,
          ...showResults(s, resultsToShow(msg.room, s.room, s.playerId, s.results, s.resultsSeen, s.resultsShown)),
          ...(s.clockSynced ? {} : { clockOffset: msg.room.serverTime - Date.now() }),
        }));
        break;
      case 'chat':
        set((s) => ({ chat: appendChat(s.chat, msg.message) }));
        // There is no chat on screen: an event only a line tells about pops up instead (a welcome's history never does).
        if (msg.message.kind === 'notice') get().addToast('info', msg.message.text);
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
        // A move the room turned down says why in a few words ("It is not your turn."): a passing note, not an alarm.
        if (msg.code === 'NOT_ALLOWED') {
          get().addToast('info', msg.message.trim() || friendlyError(msg.code));
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
    saveResultsShown(null);
    set({ room: null, playerId: null, chat: [], rejoining: false, joinPending: false, pendingJoin: null, results: null, resultsShown: null });
    // After the state is cleared, so routeSync sees a room-less store and does not leave a second time.
    if (room && !opts?.keepUrl && codeFromLocation() === room.code) navigate('/', { replace: true });
  },

  addToast: (kind, text) => {
    // The same line again only keeps the one on show up longer.
    const same = get().toasts.find((t) => t.kind === kind && t.text === text);
    const id = same?.id ?? ++toastSeq;
    if (!same) set((s) => ({ toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), { id, kind, text }] }));
    const timer = toastTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    toastTimers.set(
      id,
      setTimeout(() => get().dismissToast(id), kind === 'error' ? ERROR_TOAST_MS : TOAST_MS),
    );
  },
  dismissToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    toastTimers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

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
  closeResults: () => {
    const { results } = get();
    if (!results) return;
    saveResultsSeen(results.id);
    saveResultsShown(null);
    set({ results: null, resultsSeen: results.id, resultsShown: null });
  },
}));
