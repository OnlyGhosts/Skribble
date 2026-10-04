import { isValidRoomCode, normalizeRoomCode } from '@shared/roomCode';

/** Reads a room code from `/XK4P` or `?room=XK4P`; `null` when the URL carries none. */
export function codeFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('room');
  if (fromQuery) {
    const code = normalizeRoomCode(fromQuery);
    if (isValidRoomCode(code)) return code;
  }
  const segment = window.location.pathname.split('/').filter(Boolean)[0];
  if (segment) {
    const code = normalizeRoomCode(segment);
    if (isValidRoomCode(code)) return code;
  }
  return null;
}

/** Makes the address bar reflect the room; pushes a history entry unless the URL already names it. */
export function pushRoomUrl(code: string): void {
  const target = `/${code}`;
  if (codeFromLocation() === code) {
    if (window.location.pathname !== target || window.location.search) {
      window.history.replaceState({ room: code }, '', target);
    }
    return;
  }
  window.history.pushState({ room: code }, '', target);
}

export function resetUrl(): void {
  if (window.location.pathname !== '/' || window.location.search) {
    window.history.replaceState(null, '', '/');
  }
}

export function inviteLink(code: string): string {
  return `${window.location.origin}/${code}`;
}
