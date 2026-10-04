/**
 * The unit tests run in node (vitest's default environment here); this gives the client modules
 * the handful of browser globals they touch at import time or on the paths under test: the URL
 * helpers, toasts' timers and the (absent) web storage. Nothing here renders a DOM.
 */
export function installBrowserGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  if (g.window === globalThis) return;
  const location = { protocol: 'http:', host: 'localhost:4173', pathname: '/', search: '' };
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
  Object.assign(g, {
    window: globalThis,
    location,
    history,
    document: { visibilityState: 'visible', addEventListener: noop, removeEventListener: noop },
    addEventListener: noop,
    removeEventListener: noop,
  });
}

/** Points the fake address bar at a path such as "/ABCD". */
export function setLocation(pathname: string, search = ''): void {
  const location = (globalThis as { location: { pathname: string; search: string } }).location;
  location.pathname = pathname;
  location.search = search;
}
