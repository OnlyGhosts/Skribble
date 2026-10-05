import { useEffect, useState } from 'react';
import { isGameId, type GameId } from '@shared/platform/games';
import { ROOM_PREVIEW_PATH, type RoomPreview as WirePreview } from '@shared/platform/protocol';
import { isValidRoomCode } from '@shared/platform/roomCode';

/** The wire `RoomPreview` with safe defaults; the game id tells which game home a bare code belongs to. */
export type RoomPreview = { exists: false } | { exists: true; gameId: GameId; players: number; maxPlayers: number; inProgress: boolean; joinable: boolean };

export type PreviewState =
  | { status: 'idle'; preview: null }
  | { status: 'loading'; preview: null }
  | { status: 'ok'; preview: RoomPreview }
  | { status: 'unavailable'; preview: null };

const DEBOUNCE_MS = 250;

export function parsePreview(v: unknown): RoomPreview | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Partial<Record<keyof Extract<WirePreview, { exists: true }>, unknown>>;
  if (typeof o.exists !== 'boolean') return null;
  if (!o.exists) return { exists: false };
  if (typeof o.gameId !== 'string' || !isGameId(o.gameId)) return null;
  return {
    exists: true,
    gameId: o.gameId,
    players: typeof o.players === 'number' ? o.players : 0,
    maxPlayers: typeof o.maxPlayers === 'number' ? o.maxPlayers : 0,
    inProgress: o.inProgress === true,
    joinable: typeof o.joinable === 'boolean' ? o.joinable : true,
  };
}

export async function fetchPreview(code: string, signal?: AbortSignal): Promise<RoomPreview | null> {
  const init: RequestInit = { headers: { accept: 'application/json' } };
  if (signal) init.signal = signal;
  const res = await fetch(`${ROOM_PREVIEW_PATH}/${encodeURIComponent(code)}`, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsePreview((await res.json()) as unknown);
}

/** Optional lookup of a room before joining; any failure degrades to "no preview". */
export function useRoomPreview(code: string): PreviewState {
  const [state, setState] = useState<PreviewState>({ status: 'idle', preview: null });

  useEffect(() => {
    if (!isValidRoomCode(code)) {
      setState({ status: 'idle', preview: null });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState({ status: 'loading', preview: null });
      try {
        const preview = await fetchPreview(code, controller.signal);
        if (controller.signal.aborted) return;
        setState(preview ? { status: 'ok', preview } : { status: 'unavailable', preview: null });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'unavailable', preview: null });
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [code]);

  return state;
}
