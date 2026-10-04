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

Requires Node 20 or newer.

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

## Production

```bash
npm run build          # client -> dist/client, server -> dist/server/index.js
PORT=3001 npm start    # one process serves the client, /api and the /ws WebSocket
```

Everything runs in a single Node process with rooms held in memory, so deploy it anywhere that runs Node and allows WebSocket upgrades (Fly.io, Railway, Render, a VPS behind nginx or Caddy). Put TLS in front of it; the client picks `wss://` automatically on HTTPS pages.

With Docker:

```bash
docker build -t skribble .
docker run -p 3001:3001 skribble
```

Rooms vanish 60 seconds after the last player leaves. There is no database and nothing to configure beyond `PORT`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server with hot reload (`tsx watch`) and Vite client together |
| `npm run typecheck` | Strict TypeScript for server, client and shared code |
| `npm test` | Vitest unit tests (game engine, protocol helpers, guess matching, codes) |
| `npm run build` | Production build of both halves |
| `npm run test:e2e` | Playwright end-to-end tests driving several browser contexts through whole games, reloads, kicks and phone layouts |
| `npm run check` | Typecheck, unit tests and build in one go |

## How it's built

```
shared/     The contract both sides compile against: zod-validated wire protocol,
            room settings and limits, room-code alphabet, guess matching, scoring,
            hint masks, avatars, word lists.
server/     Node + ws + express. RoomManager owns rooms by code; Room is a
            socket-free game engine (injectable clock, rng and transport) covering
            the lobby, word choice, drawing with scheduled hints, guessing and
            scoring, canvas history with undo, reconnection grace, kicks and host
            transfer. connection.ts validates every message with zod, rate-limits
            chat and heartbeats sockets.
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

- Single process, in-memory rooms: restart the server and rooms are gone. Fine for friends, not for a public matchmaking service.
- English only for now; adding a language is a word list in `shared/words/` plus one entry in `shared/settings.ts`.
- No public rooms or matchmaking by design: this is for playing with people you know.
