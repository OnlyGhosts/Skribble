import { avatarSchema, type Avatar } from '@shared/platform/avatar';
import { NAME_MAX_LENGTH, RECONNECT_GRACE_MS } from '@shared/platform/constants';
import { isGameId } from '@shared/platform/games';
import { SESSION_STORAGE_KEY, type StoredSession } from '@shared/platform/protocol';

export type Theme = 'light' | 'dark';

export interface Prefs {
  /** `null` follows the operating system preference. */
  theme: Theme | null;
  sound: boolean;
}

const NAME_KEY = 'boredgames.name';
/** Prefix of the per-room seat entries (`${SEAT_KEY_PREFIX}${code}`). */
export const SEAT_KEY_PREFIX = 'boredgames.seat.';
/** A seat entry is refreshed by snapshots at most this often. */
export const SEAT_REFRESH_MS = 60_000;
const AVATAR_KEY = 'boredgames.avatar';
/** Also read by the inline script in index.html that applies the theme before first paint. */
export const PREFS_KEY = 'boredgames.prefs';

type StorageKind = 'local' | 'session';

// Every storage access is wrapped: private windows, blocked site data and quota errors
// must never break the app — remembered values are a convenience only.
function getStorage(kind: StorageKind): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readRaw(kind: StorageKind, key: string): string | null {
  try {
    return getStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(kind: StorageKind, key: string, value: string | null): void {
  try {
    const storage = getStorage(kind);
    if (!storage) return;
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function readJson(kind: StorageKind, key: string): unknown {
  const raw = readRaw(kind, key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function loadName(): string {
  return (readRaw('local', NAME_KEY) ?? '').slice(0, NAME_MAX_LENGTH);
}

export function saveName(name: string): void {
  writeRaw('local', NAME_KEY, name.slice(0, NAME_MAX_LENGTH));
}

export function loadAvatar(): Avatar | null {
  const parsed = avatarSchema.safeParse(readJson('local', AVATAR_KEY));
  return parsed.success ? parsed.data : null;
}

export function saveAvatar(avatar: Avatar): void {
  writeRaw('local', AVATAR_KEY, JSON.stringify(avatar));
}

export function loadPrefs(): Prefs {
  const prefs: Prefs = { theme: null, sound: true };
  const v = readJson('local', PREFS_KEY);
  if (isRecord(v)) {
    if (v.theme === 'light' || v.theme === 'dark') prefs.theme = v.theme;
    if (typeof v.sound === 'boolean') prefs.sound = v.sound;
  }
  return prefs;
}

export function savePrefs(prefs: Prefs): void {
  writeRaw('local', PREFS_KEY, JSON.stringify(prefs));
}

export function loadSession(): StoredSession | null {
  const v = readJson('session', SESSION_STORAGE_KEY);
  if (!isRecord(v)) return null;
  if (typeof v.code !== 'string' || typeof v.token !== 'string' || typeof v.playerId !== 'string') return null;
  if (typeof v.gameId !== 'string' || !isGameId(v.gameId)) return null;
  return { code: v.code, gameId: v.gameId, token: v.token, playerId: v.playerId };
}

export function saveSession(session: StoredSession): void {
  writeRaw('session', SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  writeRaw('session', SESSION_STORAGE_KEY, null);
}

/**
 * A seat remembered in localStorage, keyed by room code. sessionStorage only survives reloads;
 * when a phone discards the tab (iOS does so freely in the background) and the player opens the
 * room link again, this entry gets them back into their seat as long as the server still holds it.
 */
export interface StoredSeat {
  code: string;
  token: string;
  playerId: string;
  /** Epoch ms of the last write; the server forgets the seat RECONNECT_GRACE_MS after a disconnect. */
  savedAt: number;
}

function seatKey(code: string): string {
  return `${SEAT_KEY_PREFIX}${code}`;
}

export function loadSeat(code: string): StoredSeat | null {
  const v = readJson('local', seatKey(code));
  if (!isRecord(v)) return null;
  if (typeof v.token !== 'string' || typeof v.playerId !== 'string' || typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt)) return null;
  return { code, token: v.token, playerId: v.playerId, savedAt: v.savedAt };
}

export function saveSeat(seat: StoredSeat): void {
  writeRaw('local', seatKey(seat.code), JSON.stringify(seat));
}

export function clearSeat(code: string): void {
  writeRaw('local', seatKey(code), null);
}

/** Whether a stored seat may still be held by the server; a clock set back in time counts as fresh too. */
export function isSeatFresh(seat: StoredSeat, now: number): boolean {
  return now - seat.savedAt < RECONNECT_GRACE_MS;
}

/**
 * The seat to resume for the room the page landed on: the session's own seat when it names that
 * room, else a fresh localStorage seat for the code (the tab was discarded). Null means "join form".
 */
export function seatToResume(code: string | null, session: StoredSession | null, now: number): { code: string; token: string } | null {
  if (!code) return null;
  if (session && session.code === code) return { code, token: session.token };
  const seat = loadSeat(code);
  return seat && isSeatFresh(seat, now) ? { code, token: seat.token } : null;
}
