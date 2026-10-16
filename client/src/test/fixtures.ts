import { DEFAULT_SCRIBBLE_SETTINGS } from '@shared/games/scribble/protocol';
import { GAME_IDS, type GameId } from '@shared/platform/games';
import type { ChatMessage, PlayerPublic, RoomState, WelcomeMessage } from '@shared/platform/protocol';
import type { AnyGameClientModule } from '../platform/game';
import { usePlatformStore } from '../platform/store/usePlatformStore';

/** The same module (or stub) under every game id, for `registerGames`; built from GAME_IDS so new games need no edit here. */
export function registryOf(module: Partial<AnyGameClientModule>): Record<GameId, AnyGameClientModule> {
  const stub = module as AnyGameClientModule;
  return Object.fromEntries(GAME_IDS.map((id) => [id, stub])) as Record<GameId, AnyGameClientModule>;
}

/** A seated player who is in the game (most fixtures are in-game states); lobby states override `participating`. */
export function player(id: string, overrides: Partial<PlayerPublic> = {}): PlayerPublic {
  return {
    id,
    name: id,
    avatar: { color: 0, emoji: 0 },
    score: 0,
    isHost: id === 'host',
    connected: true,
    joinOrder: 0,
    ready: false,
    sittingOut: false,
    participating: true,
    ...overrides,
  };
}

/** A Scribble lobby by default; `game` carries a game view for in-game states. */
export function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'ABCD',
    gameId: 'scribble',
    hostId: 'host',
    settings: { contentMode: 'family', ...DEFAULT_SCRIBBLE_SETTINGS },
    players: [player('host'), player('bob', { joinOrder: 1 })],
    phase: 'lobby',
    podium: null,
    game: null,
    serverTime: Date.now(),
    ...overrides,
  };
}

export function welcome(playerId: string, roomState: RoomState, token = `token-${playerId}`, extra?: unknown): WelcomeMessage {
  const msg: WelcomeMessage = { t: 'welcome', playerId, token, room: roomState, chat: [] };
  if (extra !== undefined) msg.extra = extra;
  return msg;
}

export function chatLine(id: number, kind: ChatMessage['kind'] = 'chat', text = `line ${id}`): ChatMessage {
  return { id, kind, text, ts: id };
}

/** Puts the singleton store back to its initial shape between tests. */
export function resetStore(): void {
  usePlatformStore.setState({
    connection: 'connecting',
    playerId: null,
    room: null,
    rejoining: false,
    chat: [],
    toasts: [],
    joinPending: false,
    pendingJoin: null,
    joinError: null,
    clockOffset: 0,
    clockSynced: false,
  });
}
