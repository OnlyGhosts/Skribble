import type { ChatMessage, Phase, PlayerPublic, RoomState, ServerMessageOf } from '@shared/protocol';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { useGameStore } from '../store/useGameStore';

export function player(id: string, overrides: Partial<PlayerPublic> = {}): PlayerPublic {
  return {
    id,
    name: id,
    avatar: { color: 0, emoji: 0 },
    score: 0,
    isHost: id === 'host',
    connected: true,
    guessedThisTurn: false,
    turnPoints: 0,
    joinOrder: 0,
    ...overrides,
  };
}

export function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'ABCD',
    hostId: 'host',
    settings: { ...DEFAULT_SETTINGS },
    players: [player('host'), player('bob', { joinOrder: 1 })],
    phase: { kind: 'lobby' },
    round: 0,
    totalRounds: 3,
    turn: 0,
    turnsInRound: 0,
    serverTime: Date.now(),
    ...overrides,
  };
}

export function drawingPhase(drawerId: string, overrides: Partial<Extract<Phase, { kind: 'drawing' }>> = {}): Phase {
  return {
    kind: 'drawing',
    drawerId,
    startedAt: Date.now(),
    endsAt: Date.now() + 60_000,
    mask: '_____',
    likes: 0,
    dislikes: 0,
    ...overrides,
  };
}

export function welcome(playerId: string, roomState: RoomState, token = `token-${playerId}`): ServerMessageOf<'welcome'> {
  return { t: 'welcome', playerId, token, room: roomState, canvas: [], chat: [] };
}

export function chatLine(id: number, kind: ChatMessage['kind'] = 'chat', text = `line ${id}`): ChatMessage {
  return { id, kind, text, ts: id };
}

/** Puts the singleton store back to its initial shape between tests. */
export function resetStore(): void {
  useGameStore.setState({
    connection: 'connecting',
    playerId: null,
    room: null,
    rejoining: false,
    canvas: [],
    canvasEpoch: 0,
    chat: [],
    toasts: [],
    joinPending: false,
    pendingJoin: null,
    joinError: null,
    clockOffset: 0,
    clockSynced: false,
    guessDraft: '',
  });
}
