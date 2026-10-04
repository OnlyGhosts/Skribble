import { useEffect, useState } from 'react';
import { isValidRoomCode } from '@shared/roomCode';

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
  const o = v as Record<string, unknown>;
  if (typeof o.exists !== 'boolean') return null;
  return {
    exists: o.exists,
    players: typeof o.players === 'number' ? o.players : 0,
    maxPlayers: typeof o.maxPlayers === 'number' ? o.maxPlayers : 0,
    inProgress: o.inProgress === true,
    joinable: typeof o.joinable === 'boolean' ? o.joinable : o.exists,
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
        const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
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
