import { create } from 'zustand';
import type {
  CanvasAction,
  ChatMessage,
  ClientMessageOf,
  DrawOp,
  ErrorCode,
  PlayerPublic,
  RoomState,
  ServerMessage,
} from '@shared/protocol';
import { applyOpsToActions } from '../canvas/history';
import { canvasBus } from '../canvas/bus';
import { friendlyError, type JoinErrorCode } from '../lib/format';
import { loadPrefs, savePrefs, type Prefs, type Theme } from '../lib/storage';
import { resetUrl } from '../lib/url';

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

export type JoinRequest = ClientMessageOf<'create'> | ClientMessageOf<'join'>;

const CHAT_CAP = 300;
const MAX_TOASTS = 4;
const TOAST_MS = 4500;
const JOIN_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'GAME_IN_PROGRESS',
  'INVALID_CODE',
]);

interface GameState {
  connection: ConnectionStatus;
  playerId: string | null;
  room: RoomState | null;
  /** True while a 'rejoin' is in flight after a reload or reconnect. */
  rejoining: boolean;
  canvas: CanvasAction[];
  /** Bumped whenever the canvas must be redrawn from scratch (undo, clear, resync, rejoin). */
  canvasEpoch: number;
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
}

interface GameActions {
  setConnection(status: ConnectionStatus): void;
  setRejoining(value: boolean): void;
  setClockOffset(offset: number): void;
  handleServerMessage(msg: ServerMessage): void;
  /** Ops produced by the local drawer; the server does not echo them. */
  appendLocalOps(ops: readonly DrawOp[]): void;
  beginJoin(request: JoinRequest): void;
  setPendingJoin(request: JoinRequest | null): void;
  failJoin(error: JoinError): void;
  clearJoinError(): void;
  /**
   * Leaves room state behind. The address bar is reset synchronously so the Home screen never
   * reads the old room code; `keepUrl` preserves it when the seat expired but the room may still
   * exist (the player can join again with one click).
   */
  resetRoom(opts?: { keepUrl?: boolean }): void;
  addToast(kind: ToastKind, text: string): void;
  dismissToast(id: number): void;
  setTheme(theme: Theme | null): void;
  setSound(on: boolean): void;
}

export type GameStore = GameState & GameActions;

let toastSeq = 0;

function appendChat(chat: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const next = chat.length >= CHAT_CAP ? chat.slice(chat.length - CHAT_CAP + 1) : chat.slice();
  next.push(message);
  return next;
}

export const useGameStore = create<GameStore>()((set, get) => ({
  connection: 'connecting',
  playerId: null,
  room: null,
  rejoining: false,
  canvas: [],
  canvasEpoch: 0,
  chat: [],
  toasts: [],
  prefs: loadPrefs(),
  joinPending: false,
  pendingJoin: null,
  joinError: null,
  clockOffset: 0,

  setConnection: (connection) => set({ connection }),
  setRejoining: (rejoining) => set({ rejoining }),
  setClockOffset: (clockOffset) => set({ clockOffset }),

  handleServerMessage: (msg) => {
    switch (msg.t) {
      case 'welcome':
        set((s) => ({
          playerId: msg.playerId,
          room: msg.room,
          canvas: msg.canvas,
          canvasEpoch: s.canvasEpoch + 1,
          chat: msg.chat.slice(-CHAT_CAP),
          joinPending: false,
          pendingJoin: null,
          joinError: null,
          rejoining: false,
          clockOffset: msg.room.serverTime - Date.now(),
        }));
        break;
      case 'room':
        set((s) => {
          const prev = s.room?.phase.kind;
          const next = msg.room.phase.kind;
          // A new turn (or a return to the lobby) always starts on a blank canvas.
          const freshCanvas = (next === 'choosing' && prev !== 'choosing') || (next === 'lobby' && prev !== 'lobby');
          return {
            room: msg.room,
            clockOffset: msg.room.serverTime - Date.now(),
            ...(freshCanvas ? { canvas: [], canvasEpoch: s.canvasEpoch + 1 } : {}),
          };
        });
        break;
      case 'draw':
        set((s) => ({ canvas: applyOpsToActions(s.canvas, msg.ops) }));
        canvasBus.emit(msg.ops);
        break;
      case 'undo':
        set((s) => ({ canvas: s.canvas.slice(0, -1), canvasEpoch: s.canvasEpoch + 1 }));
        break;
      case 'clear':
        set((s) => ({ canvas: [], canvasEpoch: s.canvasEpoch + 1 }));
        break;
      case 'canvas':
        set((s) => ({ canvas: msg.actions, canvasEpoch: s.canvasEpoch + 1 }));
        break;
      case 'chat':
        set((s) => ({ chat: appendChat(s.chat, msg.message) }));
        break;
      case 'error': {
        if (msg.code === 'REJOIN_FAILED') {
          get().resetRoom({ keepUrl: true });
          get().addToast('warning', friendlyError('REJOIN_FAILED'));
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

  appendLocalOps: (ops) => set((s) => ({ canvas: applyOpsToActions(s.canvas, ops) })),

  beginJoin: (request) => set({ joinPending: true, pendingJoin: request, joinError: null }),
  setPendingJoin: (pendingJoin) => set({ pendingJoin }),
  failJoin: (joinError) => set({ joinPending: false, pendingJoin: null, joinError }),
  clearJoinError: () => set({ joinError: null }),

  resetRoom: (opts) => {
    if (!opts?.keepUrl) resetUrl();
    set((s) => ({
      room: null,
      playerId: null,
      canvas: [],
      canvasEpoch: s.canvasEpoch + 1,
      chat: [],
      rejoining: false,
      joinPending: false,
      pendingJoin: null,
    }));
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

// ---------------------------------------------------------------------------
// Derived selectors (stable references: they return objects owned by the state).
// ---------------------------------------------------------------------------

export const selectMe = (s: GameStore): PlayerPublic | null =>
  s.room?.players.find((p) => p.id === s.playerId) ?? null;

export const selectIsHost = (s: GameStore): boolean => s.room !== null && s.room.hostId === s.playerId;

export const selectDrawerId = (s: GameStore): string | null => {
  const phase = s.room?.phase;
  return phase && 'drawerId' in phase ? phase.drawerId : null;
};

export const selectIsDrawer = (s: GameStore): boolean => {
  const drawerId = selectDrawerId(s);
  return drawerId !== null && drawerId === s.playerId;
};

export const selectHasGuessed = (s: GameStore): boolean => selectMe(s)?.guessedThisTurn ?? false;

export const selectDrawer = (s: GameStore): PlayerPublic | null => {
  const drawerId = selectDrawerId(s);
  return drawerId ? (s.room?.players.find((p) => p.id === drawerId) ?? null) : null;
};

export function playerName(room: RoomState | null, playerId: string): string {
  return room?.players.find((p) => p.id === playerId)?.name ?? 'Someone';
}
