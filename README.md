# boredgames.io

Phone-first party games for people in the same room, built on one platform. One person creates a
room, shares a **4-character code** (or a link), everyone else types it into the four boxes on the
front door and you are playing within seconds. The host picks the game inside the room and the
party stays together between games. No accounts, no app store, works in any modern browser on
desktop and phones, installable as a home-screen app.

Every game added gets the rooms, codes, seats, lobby, notices, kicks, reconnects, scores and the
podium for free: a game is a pure reducer on the server and a React screen on the client, and
nothing else. The owner adds games over time; [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md) is
the copy-paste guide for the next one.

## The games

| Game | Players | Status | What it is |
| --- | --- | --- | --- |
| **Scribble** | 2+ | live | A better skribbl.io: draw a word, everyone guesses, fast guesses and clear drawings score |
| **The Spy Game** | 3+ | live | One player is the spy and does not know the location; ask questions out loud, vote the spy out before they guess where you are |
| **Quip Game** | 3+ | live | Write the funniest answer: two prompts each, answers go head to head, the room votes, the biggest laughs score |
| **Click Race** | 1+ | hidden | The template game: tap a button, first to the target wins. Never offered in the picker; a party starts on it through `/?game=template` for development and tests. It proves the platform contract end to end and is the copy base for new games |

A new party starts on the first live game (Scribble); the lobby's game picker offers every game
whose status is `live`, and the host can switch the party at any time. There is no game catalogue
on the front door: `/` has exactly two things to do, join a room or create one.

## The brand

The site is **boredgames.io**, always one lowercase word. The brand direction is **Pocket Party**,
kept with the code in [`branding/pocket-party/`](branding/pocket-party/START_HERE.md): the approved
board, the specs (brand, components, motion and copy, screens), the design tokens, the line icons,
the mascots and the app icon. The outlined wordmark files are in [`branding/logo/`](branding/logo/);
the first rebrand pack is archived in `branding/archive/first-rebrand/`. Where the owner's later
decisions differ from the pack (two content modes, no taglines, sound effects wanted, the game is
called Scribble), the owner's decisions win. The short version:

- **Dark by default.** Near-black page (`#141514`), flat graphite panels (`#20221F`) separated by
  fine borders, off-white type (`#F1F0E8`), lime (`#C7E976`, always with ink text) for actions and
  the brand, lilac (`#A699D5`) for selection. No glow, gradients or blur. A light theme on the same
  system sits in the settings menu (the gear in the header); the choice is remembered on the
  device. Tokens, including a `--game-<id>` accent per game: `client/src/platform/styles/tokens.css`.
- **Type.** Space Grotesk for headings, Inter for text, IBM Plex Mono for room codes, self-hosted
  latin subsets under the SIL Open Font License (`client/public/fonts/`, with the licences).
- **Sound.** Short effects for every game (cards, chips, chimes, stings), from Kenney's
  CC0 packs, mono MP3 under 800 KB in all (`client/public/sounds/`, with `CREDITS.md` listing each
  file's pack and original and what plays when). A game's sounds load when its screen mounts;
  the switch in the settings menu mutes everything.
- **Avatars.** 50 faces drawn as Microsoft Fluent Emoji (the Color style, MIT licence), bundled
  as 104px WebP pictures (169 KB in all, `client/public/avatars/`, with the licence and a README)
  so every phone shows the same faces. The list is `shared/platform/avatarFaces.ts`; a saved
  avatar keeps only its index, so new faces go at the end.
- **The wordmark is outlined Poppins, not text.** "boredgames" is Poppins Black and ".io" Poppins Regular (SIL OFL). The app inlines it
  (`client/src/platform/components/Wordmark.tsx`, accessible name "boredgames.io"): "bored" and
  ".io" in the text colour, "games" in lime (on light with an ink outline, like the phones').
- **Mascots.** Two small phone characters (lime happy, lilac bored), drawn in Illustrator
  (`branding/mascots/boredgames-mascots.svg`), as the logo's icon and on celebrations only,
  never above or between controls.
- **Game glyphs.** Each game has a 24px line icon (`GameMeta.glyph`) on its accent, on the lobby
  tiles and in the game's header. The app icon is the lime smile (`node scripts/brand-icons.mjs`
  renders the opaque apple-touch and maskable PNGs).
- **Copy.** Short, plain and human. No taglines, no filler, and no em dashes in anything a player
  sees or hears.

## Quick start

Requires Node 22.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/ws` and `/api` to the game server on port 3001.

## Playing with friends

1. One player opens the site and taps **Create a room** (a first visit asks "Who's playing?" for a
   name and an avatar; both are remembered on the device). The lobby opens with **Pick a game**
   at the top, the code (for example `XK4P`) and an invite link such as
   `https://your-host/scribble/XK4P`.
2. Friends open the site and type the code into the four boxes on the front door (codes are one
   namespace across games, so the code alone finds the party whatever it is playing), or open the
   link, which fills the boxes for them, and tap **Join room**.
3. Everyone taps **Ready** (or **Sit out** to watch this one from the party), the host adjusts
   the settings and hits **Start** once enough players are ready (two for Scribble, three for
   the Spy Game and Quip Game). There is no cap on a game: everyone in the room plays, up to the
   50 seats a room holds.
4. The room is a party. After the podium nobody has to rejoin: ready up for the next game, sit it
   out, or let the host switch the party to another game from the lobby. The code and the invite
   link stay the same whatever game is on.

For the games with words, prompts or places (Scribble, The Spy Game and Quip Game) the
host also picks a **content mode** for the whole party: *Family* keeps it clean, *Unhinged (18+)*
is adults only and plays only the adult packs, the cheeky ones plus the explicit ones (sex, drink
and drugs, bodily fluids, death and family shame; never slurs, never jokes aimed at a group,
nothing sexual involving anyone under 18), with none of the family words or places mixed in. The
lobby only shows the choice for those games; for the others it stays stored, so switching back
restores it.

Reload, lock your phone or drop off Wi-Fi and you come back to the same seat with the same name
and score: a seat survives ten minutes without a connection. A running game never ends over a
dropped connection: when too few players are connected to go on, it holds at its next round or
turn boundary with a "Waiting for … to reconnect" overlay (the host can remove a player who is not
coming back) and resumes as soon as enough are back. Only when fewer seats remain than the game
needs does it return everyone to the lobby.

## Scribble

- **Friend codes that are actually readable.** Codes use letters and digits but never `I`, `L`, `O`, `0` or `1`, so nothing gets misread over voice chat. Paste a code or a whole invite link into the join box and it just works.
- **Type into the blanks.** On your turn to guess, the word-length tiles *are* your input: each letter you type lands in the next slot, spaces and hyphens in the word are skipped for you, revealed hint letters show faintly until you type over them, Enter submits. Uses your phone's normal keyboard, never a custom on-screen one.
- **Built for phones.** A non-scrolling game layout that keeps the canvas, the guesses and the guess bar above the keyboard, a players sheet, landscape support, 44px tap targets, safe-area aware.
- **Reconnect without losing your seat.** Come back with the same name, score and the drawing so far. If the drawer drops, the turn waits 20 seconds for them before moving on; if the room is short of players, the game holds at the turn summary until they are back.
- **Hints that help.** Letters are revealed on a schedule spread over the turn; "close" guesses are flagged privately so you know you're nearly there; `icecream` counts for `ice cream`.
- **Fair scoring.** Guessers earn 50–400 points by speed. The drawer earns up to 300 points scaled by how many people got it, so drawing clearly for everyone beats racing one fast friend.
- **Real drawing tools.** Smooth strokes, five brush sizes, 24 colours plus a colour picker, eraser, flood fill, undo and clear, with keyboard shortcuts (`B`, `E`, `F`, `Ctrl+Z`, `[` and `]`).
- **Host controls and fair play.** Rounds, hints, word choices, custom word lists typed in or uploaded as a .txt file (optionally custom-only), kick, vote-kick, automatic host hand-over. There is no chat to give the word away in: only a guesser who has not got it yet types, and only guesses.
- **Polish.** Light and dark themes, sound cues, like/dislike the drawing, turn summaries, a podium at the end, and a 1,390-word English list of things you can actually draw (plus 498 adult ones that make up the whole pack of an Unhinged room).

Each round, every player draws once. The drawer picks one of three words, everyone else types
guesses straight into the blanks, and the turn ends when time runs out or everyone has guessed.

## The Spy Game

Three or more players in the same room. Each round one player is secretly the spy; everyone
else sees the location (one of 24 candidates drawn from the pack in `shared/games/spygame/locations.ts`).
Questions are asked out loud; the spy has two guesses, the agents one group accusation each
round (a vote that pauses the clock). The host sets the number of rounds; the round clock (8 minutes)
and the vote window (30 seconds) are fixed.

**Location pictures.** Every location has a generated placeholder tile in
`client/src/games/spygame/assets/locations/<id>.svg`, written by
`node scripts/spygame-location-images.mjs` from the pack (re-run it after adding locations). To
use a real picture, drop `<id>.jpg` (or `.jpeg`, `.png`, `.webp`) into that folder next to the
svg, e.g. `beach.jpg`: the client prefers a photo over the svg and bundles whatever is there.
Landscape pictures around 4:3 look best; the tiles crop to fit.

## Adding a game

The full guide is [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md): the contract, the rules a game
module must follow, the template game's code with commentary, the design system, and a
verification checklist. In short:

1. Add a `GameId` and a `GameMeta` card to `shared/platform/games.ts` (slug: lowercase letters,
   never 4 characters) and the id to `gameIdSchema` in `shared/platform/protocol.ts`.
2. Copy `shared/games/template/protocol.ts`: settings schema and defaults, client messages, the view.
3. Copy `server/games/template/` and register the module in `server/games/index.ts`. A module is
   `start` / `handle` / `nextDeadline` / `view`: a pure reducer that never reads the clock or
   randomness, never mutates its input and returns the same object when nothing changed. Give the
   cross-game test suites their per-game entry in `server/games/testFixtures.ts` (TypeScript asks).
4. Copy `client/src/games/template/` and register the module in `client/src/games/index.ts`: a
   `Screen`, optional `SettingsFields`, optional hooks for the player list, chat lines and the
   game's own server messages.
5. Add an end-to-end test, then set the card's `status` to `'live'`.

## Deploy it

Production runs on two hosts. **Vercel** serves the site from its CDN, and the game server runs on
**one always-on Fly.io machine in London** that holds every room in its memory. Sockets there stay
open all night: nothing cuts them on a timer and nothing splits a room between instances.

### The game server on Fly.io

1. Create a Fly.io account and add a card (the trial only covers two hours of machine time; the
   one small machine costs about $2 to $3 a month).
2. In the [Fly dashboard](https://fly.io/dashboard) pick your organization, open **Tokens**, create
   a token and add it to this GitHub repository as the Actions secret `FLY_API_TOKEN`.
3. Run the **Deploy to Fly.io** workflow (Actions tab), or push a server change to `main`. The
   first run creates the app named in `fly.toml` (`boredgames-io`, so the server is
   `https://boredgames-io.fly.dev`) and deploys one machine. `/api/health` there answers
   `{"ok":true,"driver":"memory",...}`.

`fly.toml` keeps exactly one machine and never stops it: rooms live in that process, so do not
scale it to two without adding a Redis first. The workflow only deploys when `server/`, `shared/`,
the dependencies, the Dockerfile, `fly.toml` or the workflow change, because a deploy restarts the
process and ends the rooms in progress. Avoid pushing server changes in the middle of a party.

A push to `main` that changes `server/` or `shared/` starts this workflow and the Vercel build at
the same time, and nothing orders the two; Vercel usually finishes first. So a change to what the
two sides send each other has to work both ways round, and the site should go live before the
server or with it, never long after. A game rename is the example: the new client reads a game's
former id (`formerIds` in `shared/platform/games.ts`) in snapshots and previews from the old server,
and the new server accepts it from old clients. Until the server is redeployed, creating a room of
the renamed game or switching to it fails with an error toast. A tab still running the old client
cannot read the new id at all: in a room of that game the page goes blank, and reloading only
helps once Vercel serves the new client. For the Scribble rename (`'skribble'` became
`'scribble'`), check that the Vercel production deployment is live by the time the Fly workflow
ends, and promote it by hand if it is not, so that window stays short.

Some changes only work the other way round: the server must go first. The 50 avatar faces and the
host's End game are one. An older server refuses a face past the first 24 (about half of new
players could not create or join a room) and the `endGame` message. For such a change, run the
**Deploy to Fly.io** workflow by hand on the branch before merging it to `main` (the new server
still serves the old client), then merge; the deploy ends every room either way.

### The site on Vercel

1. Import the repository at https://vercel.com/new and keep the detected settings: `vercel.json`
   builds the client into `dist/client` and serves it.
2. Production builds set `VITE_GAME_SERVER` to the Fly server (the `buildCommand` in `vercel.json`),
   so the client opens its WebSocket and fetches room previews there. The server's `/api` answers
   any origin; WebSockets need no CORS.
3. Preview deployments leave it unset and talk to their own Vercel Function (`api/server.ts`, routed
   from `/ws` and `/api/*`), so a branch's server changes can be tried before they ship. That
   function is only good for a quick test: Vercel cuts every WebSocket at the function's max
   duration (5 minutes on Hobby) and a reconnect can land on another instance, which without a
   Redis (`REDIS_URL` or `KV_URL` from a Marketplace store) has none of the rooms. That is why
   production moved to Fly: on Vercel alone a reconnect that landed on the wrong instance dropped
   the player and left the room waiting for them.

Good to know:

- Room links use the site's address, for example `https://theboredgames.vercel.app/scribble/XK4P`
  (a bare `https://theboredgames.vercel.app/XK4P` works too: both open the front door with the code
  filled in).
- The production domain follows the production branch (`main`). Change it under **Settings →
  Environments → Production → Branch Tracking**; every other branch gets a preview URL.
- Custom domain: once `boredgames.io` is registered, add it under **Settings → Domains** in the
  Vercel project and create the DNS records Vercel shows at the registrar. Share links use whatever
  origin the site is served from, so nothing in the code changes.
- `VITE_GAME_SERVER` is the only link between the two hosts. To move the server, run the Dockerfile
  anywhere that allows WebSocket upgrades and point the variable at it.
- Adding a game needs no deploy setup: both the Fly build and `api/server.ts` bundle whatever the
  game registries import.

### Alternatives

The app is also one Node process that serves the client, `/api` and `/ws` together, so any
container host can run the whole thing on its own. Set `REDIS_URL` if you run more than one
instance; a single instance needs nothing.

- **Railway.** Create a project from this GitHub repository; Railway detects the Dockerfile. Set
  the `PORT` variable to `3001` and generate a public domain in the service settings.
- **Docker.** `docker build -t bored-games . && docker run -p 3001:3001 bored-games`.
- **Your own server.** `npm ci && npm run build && PORT=3001 npm start` behind nginx or Caddy with
  WebSocket upgrades enabled.

Share the deployed URL with friends; room links look like `https://your-host/scribble/XK4P`.

## Production

```bash
npm run build          # client -> dist/client, server -> dist/server/index.js
PORT=3001 npm start    # one process serves the client, /api and the /ws WebSocket
```

Without `REDIS_URL` everything runs in a single Node process with rooms held in memory: deploy it anywhere that runs Node and allows WebSocket upgrades (Fly.io, Railway, a VPS behind nginx or Caddy). Put TLS in front of it; the client picks `wss://` automatically on HTTPS pages.

With `REDIS_URL` (or `KV_URL`) set, rooms, game side stores (Scribble's canvases) and presence live in Redis and any number of processes share them: a player's socket can land on any instance, actions are applied with optimistic concurrency and their effects are published to every instance holding a socket for that room. `rediss://` URLs use TLS. Room keys expire six hours after their last write; rooms still vanish 60 seconds after the last player leaves.

With Docker:

```bash
docker build -t bored-games .
docker run -p 3001:3001 bored-games
```

There is no database to set up: `PORT` is the only required setting, `REDIS_URL` the only optional one.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server with hot reload (`tsx watch`) and Vite client together |
| `npm run typecheck` | Strict TypeScript for server, client and shared code |
| `npm test` | Vitest unit tests (the platform engine and both game modules, protocol helpers, guess matching, codes, the client platform and game modules, the Redis driver across two instances; the Redis tests spawn `redis-server` and are skipped when it is not installed) |
| `npm run build` | Production build of both halves |
| `npm run test:e2e` | Playwright end-to-end tests driving several browser contexts through the front door (the four boxes, paste, keys, errors, deep links, the name step, themes, four viewport widths), whole games of Scribble and Click Race, reloads, kicks and phone layouts, plus two server instances sharing a Redis |
| `node scripts/avatars.mjs [fluentui-emoji clone]` | Redraws the avatar pictures (`client/public/avatars/`) from the Fluent Emoji SVGs, downloaded from the pinned commit unless a local clone is given |
| `node scripts/brand-icons.mjs` | Regenerates the opaque apple-touch and maskable PNG icons from the app icon (`client/public/icons/icon.svg`) |
| `npm run check` | Typecheck, unit tests and build in one go |

## How it's built

The site is a set of party games on one platform. The platform owns everything a room needs that is
not game-specific; a game is a self-contained module on each side.

```
shared/platform/   The contract both sides compile against: site identity (site.ts), the game
                   registry (games.ts: GameId, GameMeta, GAME_LIST), the flat wire protocol
                   (protocol.ts: platform messages, RoomState<V>, PlayerPublic, ChatMessage,
                   PodiumEntry, RoomPreview), platform settings, room codes, avatars.
shared/games/<id>/ A game's own protocol: its settings schema + defaults + limits, its client and
                   server messages, its per-recipient view. Scribble keeps guess matching, scoring,
                   hint masks and the word lists here.
server/platform/   Node + ws + express. engine/ is the pure platform reducer: PlatformRoomData is a
                   JSON-safe snapshot of a room (seats, host, settings, phase, podium, chat, votes,
                   grace deadlines and the game module's own state in `game`) and
                   applyAction(data, action, ctx) returns the next state plus the effects to run
                   without ever touching a clock, randomness or a timer; nextDeadline(data) merges
                   the platform's deadlines with the game's. game.ts is the module contract
                   (GameServerModule: start / handle / nextDeadline / view, effects such as send,
                   snapshot, chat, score, gameOver, abort). storage.ts is GameStorage, a per-room
                   list + hash + sequence for games with a side store (memory and Redis
                   implementations). drivers/ run rooms: MemoryDriver (Room + RoomManager, one
                   process) and RedisDriver (rooms, side stores and presence in Redis, actions
                   applied with compare-and-set Lua scripts, effects fanned out over pub/sub so
                   every instance delivers to its own sockets). connection.ts validates platform
                   messages with zod, rate-limits chat and game messages and heartbeats sockets;
                   app.ts is the express + ws factory both entry points share.
server/games/      GAMES, the server registry (index.ts), and one folder per game. scribble/ holds
                   the turn/guess/hint reducer and the canvas side store (drawing never goes through
                   the reducer; the driver hands draw/undo/clear to the store). template/ is Click
                   Race, the hidden example game every new game starts from.
api/               server.ts, the Vercel Function that preview deployments talk to: the same app
                   exported as an http.Server (Vercel handles the WebSocket upgrade), Redis when a
                   store is connected, no static files. Production uses the Fly.io machine instead.
client/src/platform/ React 19 + zustand. game.ts is the client contract (GameClientModule: Screen,
                   SettingsFields, playerBadge/playerMeta/playerClassName, onServerMessage,
                   onWelcome, onRoom, onChat, onLeave) and registry.ts the slot the
                   games are installed into by main.tsx (the platform never imports a game). router.ts
                   maps '/' (the front door), '/:slug/:CODE' and legacy '/:CODE' (the front door with
                   the code filled in) and '/:slug' (redirects to '/') with pushState; store/ holds
                   the connection, seat, room, chat, toasts and prefs; net/server.ts says where the
                   game server is (VITE_GAME_SERVER, else the page's own origin); net/socket.ts is the one
                   WebSocket with auto-reconnect that hands game messages and welcome extras to the
                   room's module; screens/ are Home and Lobby; components/ is the design system
                   (SiteHeader, Wordmark, Mascots, GameGlyph/GameMark, Avatar, AvatarPicker, CodeInput,
                   PlayerList, Chat, SettingsPanel + SettingControls, BottomSheet, Toasts, Preferences
                   (the settings gear: theme and sound), ConnectionPill, Timer, PodiumOverlay, GamePicker, ReadyControls, ContentModeSetting,
                   Icons); lib/sound.ts and lib/audio/ the sound engine (banks, cooldowns, effects
                   made in code); brand/ the outlined wordmark paths; canvas/ the shared drawing canvas
                   (renderer, flood fill, drawing hook, batching queue, Toolbar and GameCanvas) any
                   game can opt into; styles/ the tokens, base, components, home and lobby CSS.
branding/          The brand pack: brief, guide, landing spec, tokens, mascots, references and the
                   outlined logo files (logo/).
client/src/games/  GAMES, the client registry (index.ts), and one folder per game: its module, store,
                   screen, components and stylesheet. scribble/ wires up the platform canvas and keeps
                   the type-into-the-blanks guess bar; quipgame/ and spygame/ their screens and
                   components; template/ is Click Race.
e2e/               Playwright specs. One browser, several contexts, real server.
docs/              ADDING_A_GAME.md, the guide for the next game.
```

## Room codes

Room codes are one namespace: a room carries its `gameId`, `GET /api/rooms/:code` reveals it, and
the front door's four boxes find the party whatever it is playing. In a room the URL is
`/:slug/:CODE`, which is also the invite link; pasting a whole link into the boxes extracts the code.

**Format and compatibility.** A code is four characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
(`ROOM_CODE_ALPHABET` in `shared/platform/roomCode.ts`): letters without the look-alikes `I`, `L`
and `O`, plus the digits `2`–`9`, so nothing gets misread over voice chat (923,521 codes). The
rebrand brief asked for "four letters"; the live format was deliberately **not** changed, because
active rooms, saved seats and invitations already carry alphanumeric codes, so the boxes accept
letters and digits and show `A B C D` as placeholders only. Strict letter-only codes would mean
changing `ROOM_CODE_ALPHABET` (generation and validation share it): existing rooms would stay
joinable only as long as validation kept accepting digits, so such a move needs a two-step
rollout (generate letters only first; drop digits from validation once every digit-bearing room
has expired).

Scribble's drawing coordinates live in a fixed 800×600 logical space, so every device sees the same
picture regardless of screen size. The drawer renders locally and the server forwards ops to
everyone else; undo and clear are applied by the drawer as they are sent and broadcast to everyone
else, so the shared history stays authoritative. A drawer whose ops the server had to cap gets a
canvas resync.

## Default settings

Every room has the platform settings; each game adds its own, flat next to them.

| Platform setting | Default | Range |
| --- | --- | --- |
| Content mode | Family | Family or Unhinged (18+); picks the words, prompts and locations of the games that use it |

There is no max-players setting: a room holds up to 50 seats and every player who is ready takes
part. Players who sit a game out stay in the party and watch. Anyone who joins while a game is
running is let in to watch it and plays from the next game on; a player who drops and comes back
keeps their own seat.

| Scribble | Default | Range |
| --- | --- | --- |
| Rounds | 3 | 1–10 |
| Hint letters | 2 | 0–5 (never more than half the word) |
| Word choices | 3 | 2–5 |
| Custom words | none | up to 500; "custom only" needs at least 10 |

No game has a timing setting: every clock is a named constant in the game's shared protocol
(Scribble's turn is 80 seconds, `SCRIBBLE_DRAW_SECONDS`), so a timing changes in one place.

| Click Race | Default | Range |
| --- | --- | --- |
| Taps to win | 30 | 10–100 |
| Time limit | 30 s | 10–120 s |

## Limits and ideas

- Without Redis, rooms are in memory: restart the server and they are gone. With Redis they survive restarts and instance churn, but there is still no matchmaking, no accounts and no history. Fine for friends, not for a public service.
- Scribble is English only for now; adding a language is a word list in `shared/games/scribble/words/` plus one entry in `LANGUAGES` in `shared/games/scribble/protocol.ts`.
- No public rooms or matchmaking by design: this is for playing with people you know.
