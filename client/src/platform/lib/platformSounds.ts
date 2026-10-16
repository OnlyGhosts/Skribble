/**
 * The platform's own sounds: someone joining between games, readying up, a game starting, and
 * the results (a fanfare on the winner's phone, a softer sting on everyone else's). They load
 * after the first gesture, when audio may play at all.
 */
import type { RoomState } from '@shared/platform/protocol';
import { defineSounds, soundEngine } from './sound';

export const PLATFORM_SOUNDS = defineSounds('platform', {
  join: { file: 'ui/pop', volume: 0.35, cooldownMs: 250 },
  ready: { file: 'ui/click', volume: 0.45 },
  start: { file: 'stings/start', volume: 0.55, cooldownMs: 2000 },
  fanfare: { file: 'stings/fanfare', volume: 0.7, cooldownMs: 3000 },
  gameOver: { file: 'stings/game-over', volume: 0.5, cooldownMs: 3000 },
});

export function loadPlatformSoundsAfterGesture(): void {
  soundEngine.afterFirstGesture(() => PLATFORM_SOUNDS.load());
}

/** The platform's moments in a new snapshot of the same room. */
export function platformRoomSounds(room: RoomState, prev: RoomState | null, meId: string | null): void {
  if (!prev || prev.code !== room.code) return;
  if (room.phase !== 'playing' && prev.phase !== 'playing') {
    const before = new Set(prev.players.map((p) => p.id));
    if (room.players.some((p) => p.id !== meId && !before.has(p.id))) PLATFORM_SOUNDS.play('join');
  }
  if (room.phase === 'playing' && prev.phase !== 'playing') PLATFORM_SOUNDS.play('start');
}
