# Skribble

A better skribbl.io: real-time multiplayer drawing & guessing. Friends connect with a **4-character code** (letters + digits, no look-alikes).

> Work in progress — see the task list in this README as it fills in.

## Development

```bash
npm install
npm run dev        # server on :3001, Vite client on :5173 (proxies /ws)
npm run check      # typecheck + unit tests + production build
npm start          # serve the production build from dist/ on $PORT (default 3001)
npm run test:e2e   # Playwright end-to-end tests (run `npm run build` first)
```

The end-to-end tests in `e2e/` drive the production build with several browser contexts as
players. They start `dist/server/index.js` on port 4173 themselves (building first only if
`dist/` is missing), or reuse a server already listening there.
