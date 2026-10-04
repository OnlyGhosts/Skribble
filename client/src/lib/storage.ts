import { avatarSchema, type Avatar } from '@shared/avatar';
import { NAME_MAX_LENGTH } from '@shared/constants';
import { SESSION_STORAGE_KEY, type StoredSession } from '@shared/protocol';

export type Theme = 'light' | 'dark';

export interface Prefs {
  /** `null` follows the operating system preference. */
  theme: Theme | null;
  sound: boolean;
}

const NAME_KEY = 'skribble.name';
const AVATAR_KEY = 'skribble.avatar';
const PREFS_KEY = 'skribble.prefs';

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
  return { code: v.code, token: v.token, playerId: v.playerId };
}

export function saveSession(session: StoredSession): void {
  writeRaw('session', SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  writeRaw('session', SESSION_STORAGE_KEY, null);
}
