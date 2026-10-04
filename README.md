# Skribble

A better skribbl.io. Real-time multiplayer draw-and-guess for friends: one person creates a room, shares a **4-character code** (or a link), everyone else types it in and you're playing within seconds. No accounts, no app store, works in any modern browser on desktop and phones.

## Why it's better

- **Friend codes that are actually readable.** Codes use letters and digits but never `I`, `L`, `O`, `0` or `1`, so nothing gets misread over voice chat. Paste a code or a whole invite link into the join box and it just works.
- **Type into the blanks.** On your turn to guess, the word-length tiles *are* your input: each letter you type lands in the next slot, spaces and hyphens in the word are skipped for you, revealed hint letters show faintly until you type over them, Enter submits. Uses your phone's normal keyboard, never a custom on-screen one.
- **Built for phones.** A non-scrolling game layout that keeps the canvas, the chat and the guess bar above the keyboard, a players sheet, landscape support, 44px tap targets, safe-area aware, installable as a home-screen app.
- **Reconnect without losing your seat.** Reload or drop off Wi-Fi and you come back with the same name, score and the drawing so far. If the drawer drops, the game waits 10 seconds before moving on.
- **Hints that help.** Letters are revealed on a schedule spread over the turn; "close" guesses are flagged privately so you know you're nearly there; `icecream` counts for `ice cream`.
- **Fair scoring.** Guessers earn 50–400 points by speed. The drawer earns up to 300 points scaled by how many people got it, so drawing clearly for everyone beats racing one fast friend.
- **Real drawing tools.** Smooth strokes, five brush sizes, 24 colours plus a colour picker, eraser, flood fill, undo and clear, with keyboard shortcuts (`B`, `E`, `F`, `Ctrl+Z`, `[` and `]`).
- **Host controls and fair play.** Rounds, draw time, hints, word choices, max players, custom word lists (optionally custom-only), mid-game join on or off, kick, vote-kick, automatic host hand-over. The drawer can't type the word into chat; players who've guessed can only chat with each other and the drawer.
- **Polish.** Light and dark themes, sound cues, like/dislike the drawing, turn summaries, a podium at the end, and a 1,390-word English list of things you can actually draw.

## Quick start

Requires Node 22.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/ws` and `/api` to the game server on port 3001.

## Playing with friends

1. One player clicks **Create private room**. The lobby shows the code (for example `XK4P`) and an invite link such as `https://your-host/XK4P`.
2. Friends open the site, type the code into the four boxes, or open the link, and pick a name and avatar.
3. The host adjusts settings and hits **Start** once at least two players are in.

Each round, every player draws once. The drawer picks one of three words, everyone else guesses in chat (or straight into the blanks on a phone), and the turn ends when time runs out or everyone has guessed.

## Deploy it

### Vercel (recommended)

Vercel serves the client from its CDN and runs the game server as one Vercel Function that speaks WebSockets (public beta, available on every plan, needs Fluid compute, which is the default). Function instances come and go, so rooms live in Redis and any instance can serve any player.

1. Push this repository to GitHub and open https://vercel.com/new. **Import** the repository and choose the branch to deploy.
2. Keep the detected settings. `vercel.json` drives everything: it builds the client with `npm run build:client`, serves `dist/client`, routes `/ws` and `/api/*` to `api/server.ts`, gives that function a 300-second max duration and asks for Fluid compute. WebSockets need Fluid compute: it is on by default for new projects, but on a project created before April 2025 (or where it was switched off) enable it under **Settings → Functions → Fluid Compute**, otherwise `/api/*` works while every `/ws` upgrade is refused.
3. Add a Redis store: in the project, open **Storage → Marketplace** and create a Redis (the Upstash or Redis Cloud free tier is plenty). Connect it to the project so it injects `REDIS_URL` (some providers call it `KV_URL`; both are read). Without it the function logs a loud warning and falls back to in-memory rooms, which only work while every player happens to hit the same instance.
4. **Deploy**, then share the URL. Room links look like `https://your-project.vercel.app/XK4P`.

Good to know:

- WebSockets on Vercel Functions are in public beta. A connection is cut when the function reaches its max duration (5 minutes on Hobby, close code 1006). The client reconnects with backoff and rejoins with its seat token, resending any strokes drawn while offline, so players see at most a brief "reconnecting" toast. Nothing to configure.
- The production domain follows the production branch (`main` by default). Change it under **Settings → Git → Production Branch**; every other branch gets a preview URL.
- `/api/health` reports `driver: "redis"` and an approximate room count once the store is connected.

### Alternatives

The app is also one Node process that needs WebSockets, so any container host works. Set `REDIS_URL` if you run more than one instance; a single instance needs nothing.

- **Railway.** Create a project from this GitHub repository; Railway detects the Dockerfile. Set the `PORT` variable to `3001` and generate a public domain in the service settings.
- **Fly.io.** `fly launch --copy-config --yes` then `fly deploy` using the included `fly.toml`. The `deploy-fly.yml` workflow deploys on every push to `main` once you add a `FLY_API_TOKEN` secret and set the repository variable `FLY_DEPLOY_ENABLED` to `true`.
- **Docker.** `docker build -t skribble . && docker run -p 3001:3001 skribble`.
- **Your own server.** `npm ci && npm run build && PORT=3001 npm start` behind nginx or Caddy with WebSocket upgrades enabled.

Share the deployed URL with friends; room links look like `https://your-host/XK4P`.

## Production

```bash
npm run build          # client -> dist/client, server -> dist/server/index.js
PORT=3001 npm start    # one process serves the client, /api and the /ws WebSocket
```

Without `REDIS_URL` everything runs in a single Node process with rooms held in memory: deploy it anywhere that runs Node and allows WebSocket upgrades (Fly.io, Railway, a VPS behind nginx or Caddy). Put TLS in front of it; the client picks `wss://` automatically on HTTPS pages.

With `REDIS_URL` (or `KV_URL`) set, rooms, canvases and presence live in Redis and any number of processes share them: a player's socket can land on any instance, actions are applied with optimistic concurrency and their effects are published to every instance holding a socket for that room. `rediss://` URLs use TLS. Room keys expire six hours after their last write; rooms still vanish 60 seconds after the last player leaves.

With Docker:

```bash
docker build -t skribble .
docker run -p 3001:3001 skribble
```

There is no database to set up: `PORT` is the only required setting, `REDIS_URL` the only optional one.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server with hot reload (`tsx watch`) and Vite client together |
| `npm run typecheck` | Strict TypeScript for server, client and shared code |
| `npm test` | Vitest unit tests (game engine, protocol helpers, guess matching, codes, the Redis driver across two instances; the Redis tests spawn `redis-server` and are skipped when it is not installed) |
| `npm run build` | Production build of both halves |
| `npm run test:e2e` | Playwright end-to-end tests driving several browser contexts through whole games, reloads, kicks and phone layouts, plus two server instances sharing a Redis |
| `npm run check` | Typecheck, unit tests and build in one go |

## How it's built

```
shared/     The contract both sides compile against: zod-validated wire protocol,
            room settings and limits, room-code alphabet, guess matching, scoring,
            hint masks, avatars, word lists.
server/     Node + ws + express. engine/ is the pure game engine: RoomData is a
            JSON-safe snapshot of a room (players, settings, phase, deadlines as
            epoch ms, chat, votes) and applyAction(data, action, ctx) returns the
            next state plus the effects to run (messages to send, sockets to
            close, canvas resets, room deletion) without ever touching a clock,
            randomness or a timer itself; nextDeadline(data) says when to tick.
            Room (room.ts) drives it in one process: it holds the data and a
            CanvasStore, executes effects through Transport and keeps one timer
            armed. RoomManager owns rooms by code. drivers/ is what the socket
            layer talks to: MemoryDriver wraps Room + RoomManager, RedisDriver
            keeps RoomData, canvas ops and presence in Redis, applies actions
            with WATCH/MULTI/EXEC and fans the effects out over pub/sub so every
            instance delivers to its own sockets. connection.ts validates every
            message with zod, rate-limits chat and heartbeats sockets; app.ts is
            the express + ws factory both entry points share.
api/        server.ts, the Vercel Function: the same app exported as an
            http.Server (Vercel handles the WebSocket upgrade) with the Redis
            driver and no static files.
client/     React 19 + zustand. One WebSocket with auto-reconnect; the server
            pushes full per-player room snapshots for state changes and streams
            drawing ops and chat incrementally. The canvas renderer replays the
            action history so late joiners and undo always match the drawer.
e2e/        Playwright specs. One browser, several contexts, real server.
```

Drawing coordinates live in a fixed 800×600 logical space, so every device sees the same picture regardless of screen size. The drawer renders locally and the server forwards ops to everyone else; undo and clear are applied by the drawer as they are sent and broadcast to everyone else, so the shared history stays authoritative. A drawer whose ops the server had to cap gets a canvas resync.

## Default settings

| Setting | Default | Range |
| --- | --- | --- |
| Rounds | 3 | 1–10 |
| Draw time | 80 s | 20–180 s |
| Max players | 12 | 2–20 |
| Hint letters | 2 | 0–5 (never more than half the word) |
| Word choices | 3 | 2–5 |
| Custom words | none | up to 500; "custom only" needs at least 10 |
| Mid-game join | on | |

## Limits and ideas

- Without Redis, rooms are in memory: restart the server and they are gone. With Redis they survive restarts and instance churn, but there is still no matchmaking, no accounts and no history. Fine for friends, not for a public service.
- English only for now; adding a language is a word list in `shared/words/` plus one entry in `shared/settings.ts`.
- No public rooms or matchmaking by design: this is for playing with people you know.
