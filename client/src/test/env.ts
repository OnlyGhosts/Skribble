/**
 * The unit tests run in node (vitest's default environment here); this gives the client modules
 * the handful of browser globals they touch at import time or on the paths under test: the
 * router's address bar, media queries (nothing matches), toasts' timers and the (absent) web
 * storage. Nothing here renders a DOM; components render through react-dom/server.
 */
type Listener = (ev: unknown) => void;

const listeners = { window: new Map<string, Listener[]>(), document: new Map<string, Listener[]>() };

function listenerApi(target: 'window' | 'document') {
  const map = listeners[target];
  return {
    addEventListener(type: string, fn: Listener) {
      map.set(type, [...(map.get(type) ?? []), fn]);
    },
    removeEventListener(type: string, fn: Listener) {
      map.set(type, (map.get(type) ?? []).filter((l) => l !== fn));
    },
  };
}

/** An in-memory web storage for tests that need one (the globals install none). */
export class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  get length(): number {
    return this.map.size;
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

export function installBrowserGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  if (g.window === globalThis) return;
  const location = { protocol: 'http:', host: 'localhost:4173', origin: 'http://localhost:4173', pathname: '/', search: '' };
  const history = {
    replaceState(_state: unknown, _title: string, url: string) {
      const u = new URL(url, 'http://localhost:4173');
      location.pathname = u.pathname;
      location.search = u.search;
    },
    pushState(state: unknown, title: string, url: string) {
      this.replaceState(state, title, url);
    },
  };
  const noop = () => undefined;
  const matchMedia = (media: string) => ({ media, matches: false, addEventListener: noop, removeEventListener: noop });
  Object.assign(g, {
    window: globalThis,
    location,
    history,
    matchMedia,
    document: { visibilityState: 'visible', ...listenerApi('document') },
    ...listenerApi('window'),
  });
}

/** Installs fresh in-memory localStorage and sessionStorage; returns them for inspection. */
export function installFakeStorage(): { local: FakeStorage; session: FakeStorage } {
  const local = new FakeStorage();
  const session = new FakeStorage();
  Object.assign(globalThis as Record<string, unknown>, { localStorage: local, sessionStorage: session });
  return { local, session };
}

/** Points the fake address bar at a path such as "/skribble/ABCD". */
export function setLocation(pathname: string, search = ''): void {
  const location = (globalThis as { location: { pathname: string; search: string } }).location;
  location.pathname = pathname;
  location.search = search;
}

/** Fires an event registered through the fake window/document (`online`, `visibilitychange`, ...). */
export function fireEvent(target: 'window' | 'document', type: string): void {
  for (const fn of listeners[target].get(type) ?? []) fn({ type });
}

export function setVisibility(state: 'visible' | 'hidden'): void {
  (globalThis as { document: { visibilityState: string } }).document.visibilityState = state;
}
