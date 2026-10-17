import type { ScribblePhase, ScribbleRoomState, ScribbleView } from '@shared/games/scribble/protocol';
import type { RoomState } from '@shared/platform/protocol';
import { room } from '../../../test/fixtures';
import { scribbleCanvas } from '../canvas';
import { useScribbleStore } from '../store';

export function drawingPhase(drawerId: string, overrides: Partial<Extract<ScribblePhase, { kind: 'drawing' }>> = {}): ScribblePhase {
  return {
    kind: 'drawing',
    drawerId,
    startedAt: Date.now(),
    endsAt: Date.now() + 60_000,
    mask: '_____',
    ...overrides,
  };
}

export function view(phase: ScribblePhase, overrides: Partial<ScribbleView> = {}): ScribbleView {
  return { startedAt: 0, phase, round: 1, totalRounds: 3, turn: 1, turnsInRound: 2, players: {}, ...overrides };
}

/** A room in the middle of a Scribble turn. */
export function inTurn(phase: ScribblePhase, viewOverrides: Partial<ScribbleView> = {}, roomOverrides: Partial<RoomState> = {}): ScribbleRoomState {
  return room({ phase: 'playing', game: view(phase, viewOverrides), ...roomOverrides }) as ScribbleRoomState;
}

export function resetScribbleStore(): void {
  useScribbleStore.setState({ guessDraft: '', feedFrom: 0 });
  scribbleCanvas.store.setState({ canvas: [], canvasEpoch: 0 });
}
