import { useEffect, useState } from 'react';
import { ROOM_PREVIEW_PATH, type RoomPreview as WirePreview } from '@shared/protocol';
import { isValidRoomCode } from '@shared/roomCode';

/** Flattened view of the wire `RoomPreview`, with safe defaults when the room does not exist. */
export interface RoomPreview {
  exists: boolean;
  players: number;
  maxPlayers: number;
  inProgress: boolean;
  joinable: boolean;
}

type PreviewState =
  | { status: 'idle'; preview: null }
  | { status: 'loading'; preview: null }
  | { status: 'ok'; preview: RoomPreview }
  | { status: 'unavailable'; preview: null };

const DEBOUNCE_MS = 250;

function parsePreview(v: unknown): RoomPreview | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Partial<WirePreview> & Record<string, unknown>;
  if (typeof o.exists !== 'boolean') return null;
  if (!o.exists) return { exists: false, players: 0, maxPlayers: 0, inProgress: false, joinable: false };
  return {
    exists: true,
    players: typeof o.players === 'number' ? o.players : 0,
    maxPlayers: typeof o.maxPlayers === 'number' ? o.maxPlayers : 0,
    inProgress: o.inProgress === true,
    joinable: typeof o.joinable === 'boolean' ? o.joinable : true,
  };
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
        const res = await fetch(`${ROOM_PREVIEW_PATH}/${encodeURIComponent(code)}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const preview = parsePreview((await res.json()) as unknown);
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
