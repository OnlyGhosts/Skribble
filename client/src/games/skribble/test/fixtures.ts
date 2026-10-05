import type { SkribblePhase, SkribbleRoomState, SkribbleView } from '@shared/games/skribble/protocol';
import type { RoomState } from '@shared/platform/protocol';
import { room } from '../../../test/fixtures';
import { useSkribbleStore } from '../store';

export function drawingPhase(drawerId: string, overrides: Partial<Extract<SkribblePhase, { kind: 'drawing' }>> = {}): SkribblePhase {
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

export function view(phase: SkribblePhase, overrides: Partial<SkribbleView> = {}): SkribbleView {
  return { phase, round: 1, totalRounds: 3, turn: 1, turnsInRound: 2, players: {}, ...overrides };
}

/** A room in the middle of a Skribble turn. */
export function inTurn(phase: SkribblePhase, viewOverrides: Partial<SkribbleView> = {}, roomOverrides: Partial<RoomState> = {}): SkribbleRoomState {
  return room({ phase: 'playing', game: view(phase, viewOverrides), ...roomOverrides }) as SkribbleRoomState;
}

export function resetSkribbleStore(): void {
  useSkribbleStore.setState({ canvas: [], canvasEpoch: 0, guessDraft: '' });
}
