import { roomCodeHint } from '@shared/roomCode';
import type { ErrorCode, TurnEndReason } from '@shared/protocol';

export type JoinErrorCode = ErrorCode | 'TIMEOUT' | 'OFFLINE';

const FRIENDLY_ERRORS: Record<JoinErrorCode, string> = {
  INVALID_CODE: `That doesn't look like a room code. ${roomCodeHint()}`,
  ROOM_NOT_FOUND: "We couldn't find a room with that code. Double-check it or ask your friend for a fresh link.",
  ROOM_FULL: 'That room is full right now. Ask the host to raise the player limit.',
  GAME_IN_PROGRESS: "A game is running in that room and the host isn't letting people join mid-game.",
  REJOIN_FAILED: "Couldn't rejoin your previous seat — the room may have closed.",
  INVALID_MESSAGE: 'Something went wrong with that request.',
  NOT_ALLOWED: "You can't do that right now.",
  RATE_LIMITED: 'Slow down a little — too many messages at once.',
  INTERNAL: 'The server hit a snag. Please try again.',
  TIMEOUT: 'The server did not answer in time. Please try again.',
  OFFLINE: "Can't reach the server. Check your connection and try again.",
};

export function friendlyError(code: JoinErrorCode, fallback?: string): string {
  return FRIENDLY_ERRORS[code] ?? fallback ?? 'Something went wrong.';
}

/** "45" below a minute, "1:20" above. */
export function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return String(s);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatPoints(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function turnEndReasonText(reason: TurnEndReason, drawerName: string): string {
  switch (reason) {
    case 'allGuessed':
      return 'Everyone guessed it!';
    case 'timeUp':
      return "Time's up!";
    case 'drawerLeft':
      return `${drawerName} left or lost connection, so the turn was skipped.`;
    case 'noWordChosen':
      return `${drawerName} didn't pick a word in time.`;
  }
}

/** Letter counts per word, e.g. "ice cream" -> "3 5". */
export function letterCounts(mask: string): string {
  return mask
    .split(' ')
    .filter(Boolean)
    .map((w) => String(w.replace(/-/g, '').length))
    .join(' ');
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
