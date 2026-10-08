# Adding a game to Bored Games

This is the owner's guide to adding the next game. It is written against the code as it is: every
file it names exists, every interface it quotes is the real one, and the template game's code is
embedded verbatim from the repository so you can copy it line for line.

The one-sentence model: **a game is a pure reducer on the server plus a React screen on the
client; the platform owns everything else.** Rooms, codes, seats, tokens, reconnects, the host,
the lobby, settings, chat, scores, the podium, kicks, Redis, routing, the library card and the
design system are already built. You write what happens *inside* a running game.

Contents

1. [Where a game lives](#1-where-a-game-lives)
2. [What the platform already provides](#2-what-the-platform-already-provides)
3. [The contract](#3-the-contract)
4. [Pure-reducer rules](#4-pure-reducer-rules)
5. [The recipe, step by step](#5-the-recipe-step-by-step)
6. [The template game, in full](#6-the-template-game-in-full)
7. [Advanced: side stores (how Skribble streams drawing)](#7-advanced-side-stores-how-skribble-streams-drawing)
8. [The design system](#8-the-design-system)
9. [Platform APIs a game may call](#9-platform-apis-a-game-may-call)
10. [Verification checklist](#10-verification-checklist)
11. [Gotchas](#11-gotchas)

---

## 1. Where a game lives

A game with id `<id>` is four folders plus the entries TypeScript asks for: every
`Record<GameId, ...>` in the repository must name the new id, and `npm run typecheck` lists them
after step 1. Today those are the two registries and one test-fixture record. No other file
changes; in particular no platform test needs an edit, because the cross-game suites read what
they need about each game from the registries and that record.

| Piece | Path | What goes there |
| --- | --- | --- |
| Registry entry | [`shared/platform/games.ts`](../shared/platform/games.ts) and `gameIdSchema` in [`shared/platform/protocol.ts`](../shared/platform/protocol.ts) | The `GameId`, the `GameMeta` card data, the slug |
| Test fixture | [`server/games/testFixtures.ts`](../server/games/testFixtures.ts) | Deterministic test settings, "long game" settings and one valid in-game message, read by the harnesses and the cross-game suites |
| Shared protocol | `shared/games/<id>/protocol.ts` | Settings schema + defaults + limits, client message schema, server message type, the per-recipient view type |
| Server module | `server/games/<id>/module.ts` (+ tests), registered in [`server/games/index.ts`](../server/games/index.ts) | `start` / `handle` / `nextDeadline` / `view` |
| Client module | `client/src/games/<id>/` (`module.tsx`, `Screen.tsx`, `SettingsFields.tsx`, `<id>.css`), registered in [`client/src/games/index.ts`](../client/src/games/index.ts) | The screen, the settings rows, optional hooks |
| E2E | a `test(...)` in `e2e/` | One whole game through the real server |

The two existing games are the reference: [`template`](../server/games/template/module.ts) (Click
Race, the hidden copy base) and [`skribble`](../server/games/skribble/module.ts) (the full-size
game with the advanced side-store path).

Import conventions: files under `shared/`, `server/` and `api/` use relative imports **with the
`.js` extension** (`'../../platform/game.js'`), because `api/server.ts` is compiled by Vercel
without specifier rewriting; [`server/imports.test.ts`](../server/imports.test.ts) fails the build
otherwise. The client imports shared code through the `@shared/*` alias
(`'@shared/games/template/protocol'`) and its own platform code relatively without extensions.

---

## 2. What the platform already provides

Everything below is done for you; do not reimplement any of it inside a game.

**Rooms and codes.** One global namespace of 4-character codes
([`shared/platform/roomCode.ts`](../shared/platform/roomCode.ts): alphabet without I, L, O, 0, 1).
A room carries its `gameId`; `GET /api/rooms/:code` ([`RoomPreview`](../shared/platform/protocol.ts))
tells the client which game a code belongs to, so a code typed anywhere lands in the right game.
Empty rooms are deleted after `EMPTY_ROOM_TTL_MS` (60 s).

**Seats, tokens, reconnects.** `create` / `join` / `rejoin` / `leave`, a secret seat token per
player, a 10 min reconnect grace (`RECONNECT_GRACE_MS`) during which the seat and score survive,
presence (`connected` on every player), a stand-in host while the host's socket is down and the
role handed back on rejoin ([`server/platform/engine/seats.ts`](../server/platform/engine/seats.ts)).

**Lobby and settings.** The lobby screen, the invite card (code, copy link, native share), the
profile editor, `maxPlayers` and `allowMidGameJoin` ([`shared/platform/settings.ts`](../shared/platform/settings.ts)),
validation of settings patches (platform schema merged with your game's `patchSchema`), the
start button gated on `meta.minPlayers` connected players, scores reset to 0 on start, and
`returnToLobby` after a game ends ([`server/platform/engine/lobby.ts`](../server/platform/engine/lobby.ts)).

**Chat.** The chat panel, rate limiting (6 lines per 4 s per socket, in
[`server/platform/connection.ts`](../server/platform/connection.ts)), history for late joiners
(`CHAT_HISTORY_LENGTH` = 60), system lines for joins, leaves, host changes, kicks, start and game
over. Every chat line is offered to the running game first (a `'chat'` event) so a game can treat
chat as input (Skribble's guesses).

**Scores and podium.** Players carry a `score`; your game adds to it with `score` effects. When
the game emits `gameOver` the platform ranks everyone (ties share a rank), stores
`RoomState.podium`, announces the winner in chat, moves the room to `phase: 'ended'` and the client
shows the `PodiumOverlay` with the host's Back-to-lobby button.

**Kicks and vote-kicks.** Host kick, majority vote-kick (at least two other connected players,
never a single voter), kicked tokens refused on rejoin.

**Low-player handling.** A running game is sent back to the lobby only when fewer *seats* than
`meta.minPlayers` remain: on a leave, a kick or a reconnect-grace expiry. A dropped socket never
ends a game; the player keeps their seat for the grace and your game decides what to do
meanwhile. A game that cannot go on without them holds at its next boundary and says so with a
`waiting` effect, which the platform shows as `RoomState.waiting` (the client's waiting overlay
names the missing players and lets the host remove them).

**Time.** A deadline-driven tick: you return epoch-ms deadlines from `nextDeadline(data)`, the
driver arms one timer at the earliest platform-or-game deadline and calls your `handle` with
`{ type: 'tick' }` when it is due. No timers in game code, ever.

**Multi-instance Redis.** Rooms, presence and side stores live in Redis when `REDIS_URL` is set;
actions are applied with compare-and-set Lua scripts and effects fan out over pub/sub. Because
your module is a pure function of JSON-safe data, it works on the memory driver and on Redis
without knowing which one runs it.

**Routing and the library.** `/` (library), `/:slug` (game home with name, avatar, create, join,
hero and how-to from `GameMeta`), `/:slug/:CODE` (join link and in-room URL), legacy `/:CODE`
resolved through the preview ([`client/src/platform/router.ts`](../client/src/platform/router.ts)).
The library card is rendered from `GameMeta` the moment `status` is `'live'`.

**Transport.** The one WebSocket with backoff reconnect, ping/pong clock sync (`clockOffset`),
seat persistence in `sessionStorage`, a 60-messages-per-second cap on game messages per socket
(excess is dropped silently) ([`client/src/platform/net/socket.ts`](../client/src/platform/net/socket.ts)).

**Design system and mobile rules.** Tokens, cards, buttons, inputs, pills, sheets, toasts, the
timer, the player list, the chat, the code input, avatars, light/dark themes, the phone layout
helpers. Section 8 lists them.

---

## 3. The contract

### 3.1 Registry: `GameMeta`

[`shared/platform/games.ts`](../shared/platform/games.ts)

```ts
export type GameId = 'skribble' | 'template';
export type GameStatus = 'live' | 'soon' | 'hidden';

export interface GameMeta {
  id: GameId;
  /** URL segment. Lowercase letters only and never 4 characters long, so it can never collide with a room code. */
  slug: string;
  name: string;
  tagline: string;
  description: string;
  howToPlay: string[];
  minPlayers: number;
  maxPlayers: number;
  /** Emoji shown on the library card. */
  icon: string;
  /** Accent colour (#rrggbb) for the card tile and the game's screens. */
  accent: string;
  /** 'hidden' games never show in the library but stay reachable at /:slug (development, tests). */
  status: GameStatus;
}

export const GAME_LIST: readonly GameMeta[] = [ /* library order */ ];
export function gameById(id: GameId): GameMeta;            // throws on an unknown id
export function gameBySlug(slug: string): GameMeta | undefined;
export function isGameSlug(s: string): boolean;
export function isGameId(s: string): s is GameId;
export const GAME_IDS: readonly GameId[];
```

`status` drives the library: `'live'` cards link to `/:slug`; `'soon'` cards render muted and
disabled with a "Coming soon" pill; `'hidden'` cards are not rendered at all but `/:slug` still
works (that is how Click Race ships). [`shared/platform/games.test.ts`](../shared/platform/games.test.ts)
checks every entry: lowercase-letter slug, never 4 characters, unique id and slug, a non-empty
name/tagline/howToPlay, a `#rrggbb` accent, `1 <= minPlayers <= maxPlayers`, and that
`gameIdSchema` in `protocol.ts` lists every id.

### 3.2 Shared protocol: what crosses the wire

Platform messages are flat and fixed ([`shared/platform/protocol.ts`](../shared/platform/protocol.ts)):

- client to server: `create { gameId, name, avatar }`, `join { code, name, avatar }`,
  `rejoin { code, token }`, `leave`, `ping`, `updateSettings { settings }` (one flat patch of
  platform and game fields), `updateProfile { name?, avatar? }`, `start`, `chat { text }`,
  `kick { playerId }`, `voteKick { playerId }`, `returnToLobby`.
- server to client: `welcome { playerId, token, room, chat, extra? }`, `room { room }`,
  `chat { message }`, `error { code, message }`, `kicked { reason }`, `pong { serverTime }`.

**Any other `t` is a game message.** Inbound, it is validated with your module's
`clientMessageSchema` and handed to `handle` as `{ type: 'message' }` (only while the room is
`'playing'`; otherwise the sender gets `NOT_ALLOWED` "The game is not running."). Outbound, your
`send` effects pass through unchanged to the client module's `onServerMessage`. A game message
must be a JSON object with a string `t` (the engine throws on anything else).

The snapshot every client holds:

```ts
export interface RoomState<V = unknown, S = Record<string, unknown>> {
  code: string;
  gameId: GameId;
  hostId: string;
  settings: PlatformSettings & S;   // flat: { maxPlayers, allowMidGameJoin, ...your fields }
  players: PlayerPublic[];          // { id, name, avatar, score, isHost, connected, joinOrder }
  phase: 'lobby' | 'playing' | 'ended';
  podium: PodiumEntry[] | null;     // { playerId, score, rank }, set by the platform on gameOver
  game: V | null;                   // your view; null in the lobby
  serverTime: number;
}
```

Anything game-specific about a player (Skribble: `guessedThisTurn`, `turnPoints`) lives inside
`V`, keyed by player id, never on `PlayerPublic`.

Your `shared/games/<id>/protocol.ts` declares, with zod where it is validated:

| Export | Used by |
| --- | --- |
| `<ID>_SETTINGS_LIMITS` | Your `SettingsFields` sliders and your schema |
| `<id>SettingsSchema` / `<Id>Settings` / `DEFAULT_<ID>_SETTINGS` | `defineSettings(...)` on the server, `RoomState<V, S>` on both sides |
| `<id>ClientMessageSchema` / `<Id>ClientMessage` | `clientMessageSchema` on the server; `socket.send(...)` on the client |
| `<Id>ServerMessage` (a type; `never` when snapshots are enough) | `send` effects; `onServerMessage` |
| `<Id>View` | `view()` on the server; `room.game` on the client |
| `<Id>RoomState = RoomState<<Id>View, <Id>Settings>` | Typed room in the client module |

### 3.3 Server module: `GameServerModule`

[`server/platform/game.ts`](../server/platform/game.ts), quoted in full where it matters:

```ts
/** What a game may know about a seated player. Names and scores are the platform's; per-game state lives in D. */
export interface PlatformPlayer { id: string; name: string; joinOrder: number; connected: boolean; score: number; }

/** Identity and randomness are injected so the reducer is deterministic. */
export interface GameCtx<S> {
  /** Epoch ms: the real clock, or the deadline being processed while a tick catches up. */
  now: number;
  /** Uniform in [0, 1). */
  rng: () => number;
  /** Fresh unique id. */
  newId: () => string;
  settings: S;
  /** Every seated player (connected or in reconnect grace), in join order. */
  players: PlatformPlayer[];
  hostId: string;
}

export interface GameViewCtx<S> { settings: S; players: PlatformPlayer[]; hostId: string; now: number; }

export type GameEvent<CMsg> =
  /** A validated game message from a seated, connected player (only while the room is 'playing'). */
  | { type: 'message'; playerId: string; msg: CMsg }
  /** A chat line; the game may consume it (a guess) by returning a 'chatHandled' effect. */
  | { type: 'chat'; playerId: string; text: string }
  /** A new player was seated mid-game (ctx.players already includes them). */
  | { type: 'playerJoined'; playerId: string }
  /**
   * The player left, was kicked or their reconnect grace ran out (ctx.players no longer includes
   * them). Not delivered when the removal left fewer seats than `meta.minPlayers`: the platform
   * abandoned the game first.
   */
  | { type: 'playerLeft'; playerId: string }
  /**
   * A socket dropped / a disconnected player rejoined. The seat (and score) survives for
   * RECONNECT_GRACE_MS, and the platform never abandons a game over a disconnect alone: a game
   * that cannot go on without the player holds at its next boundary (see the 'waiting' effect).
   */
  | { type: 'playerDisconnected'; playerId: string }
  | { type: 'playerReconnected'; playerId: string }
  /**
   * The earliest deadline from `nextDeadline` is due at ctx.now. Resolve it (and anything else
   * due); the platform calls again while deadlines remain, so one deadline per call is fine.
   */
  | { type: 'tick' };

/** 'all' and `except` mean the players connected once the action has been applied. */
export type Recipients = string[] | 'all' | { except: string[] };

export type GameEffect<SMsg> =
  | { type: 'send'; to: Recipients; msg: SMsg }
  /** Send every recipient a fresh room snapshot (rendered where this effect sits in the list). */
  | { type: 'snapshot'; to: Recipients }
  /** A chat line. Lines addressed to everyone are kept in the history for late joiners. */
  | { type: 'chat'; to: Recipients; kind: ChatKind; text: string; playerId?: string; name?: string }
  /** The triggering chat text was consumed (a guess): the platform does not broadcast it as a chat line. */
  | { type: 'chatHandled' }
  /** An error for one player (a refused move, say). */
  | { type: 'error'; playerId: string; code: 'NOT_ALLOWED' | 'INVALID_MESSAGE'; message: string }
  | { type: 'score'; playerId: string; delta: number }
  /** The game is over: the platform computes the podium and moves the room to 'ended'. */
  | { type: 'gameOver' }
  /** Abandon the game and return everyone to the lobby. */
  | { type: 'abort'; reason: string }
  /**
   * The game is holding at a boundary until the players in `missing` (seated, disconnected) come
   * back; the platform shows it as RoomState.waiting. Emit it again when the list changes and
   * `null` when the game goes on; abort, gameOver and the lobby clear it by themselves.
   */
  | { type: 'waiting'; missing: string[] | null }
  /** For games with a side store: 'reset' empties it and stamps it with `payload.stamp`. */
  | { type: 'side'; name: 'reset'; payload?: { stamp: string } };

export interface GameResult<D, SMsg> {
  /** The same object as the input `data` when nothing changed. */
  data: D;
  effects: GameEffect<SMsg>[];
}

export interface GameSettingsSpec<S> {
  schema: z.ZodType<S>;
  /** `schema.partial()`: validates the game part of an updateSettings patch. */
  patchSchema: Parser<Partial<S>>;
  defaults: S;
  /** Fixes up invariants after a patch (e.g. dependent fields). */
  normalize?(s: S): S;
}

export interface GameServerModule<S = unknown, D = unknown, V = unknown, CMsg = unknown, SMsg = unknown> {
  meta: GameMeta;
  settings: GameSettingsSpec<S>;
  clientMessageSchema: z.ZodType<CMsg>;
  /** Called when the host starts the game. */
  start(ctx: GameCtx<S>): GameResult<D, SMsg>;
  /** PURE: never mutates `data`; returns the same object when nothing changed. */
  handle(ctx: GameCtx<S>, data: D, event: GameEvent<CMsg>): GameResult<D, SMsg>;
  /** Epoch ms at which the platform must deliver the next 'tick', or null. */
  nextDeadline(data: D): number | null;
  /** Per-recipient view; a null viewer is a spectator (HTTP previews, tests). */
  view(data: D, viewerId: string | null, ctx: GameViewCtx<S>): V;
  /** Advanced: message types the driver hands to the side store instead of the reducer. Requires `createSideStore`. */
  sideMessages?: ReadonlySet<string>;
  createSideStore?(storage: GameStorage): GameSideStore<D, CMsg, SMsg>;
}

/** Builds a settings spec from a zod object schema. */
export function defineSettings<S>(schema, defaults: S, normalize?: (s: S) => S): GameSettingsSpec<S>;

/** Helper for writing `handle` as mutations on a private copy; returns the original object when nothing changed. */
export function withDraft<D, SMsg>(data: D, fn: (draft: D, effects: GameEffect<SMsg>[]) => void): GameResult<D, SMsg>;
```

Type parameters: `S` settings, `D` your JSON-safe state (stored in `PlatformRoomData.game`,
opaque to the platform), `V` the per-recipient view, `CMsg` client messages, `SMsg` server
messages. The registry erases them to `AnyGameServerModule`.

**How the engine applies your effects** ([`server/platform/engine/delegate.ts`](../server/platform/engine/delegate.ts),
[`lobby.ts`](../server/platform/engine/lobby.ts)). They run in order, after `data` is stored:

| Effect | What happens |
| --- | --- |
| `send` | Delivered to the recipients that are connected. |
| `snapshot` | Rendered **where it sits**: each recipient gets `{ t: 'room', room: viewFor(...) }` built from the state at that point. Later effects that change state need another snapshot. |
| `chat` | A `ChatMessage` with a fresh id. `to: 'all'` or `{ except }` is stored in the history (cap 60) and broadcast; an explicit id list is private, sent only to connected players and never stored. `playerId` without `name` fills the name in. `kind` is one of `ChatKind = 'chat' \| 'system' \| 'guessed' \| 'correct' \| 'close' \| 'hint'` (`CHAT_KINDS` in [`shared/platform/protocol.ts`](../shared/platform/protocol.ts)); the chat styles each kind and prints the name for `chat` and `guessed` lines. Any game may use any kind. |
| `chatHandled` | Marks the triggering `'chat'` event as consumed: the platform does not broadcast the player's line. Only meaningful while handling a `'chat'` event. |
| `error` | `{ t: 'error', code, message }` to that player (if connected). |
| `score` | `player.score += delta`. **No snapshot is sent for you**; add one (or end the game) so the player list updates. Negative deltas are allowed and totals are not clamped: the podium prints `-50 pts` as it is. |
| `gameOver` | Ignored unless the room is `'playing'`. Clears any `waiting` state, builds the podium (score desc, then join order; rank = 1 + number of players with a higher score), sets `phase: 'ended'`, posts "Game over! Alice wins with 100 points." (or a tie line), broadcasts a snapshot. After this `nextDeadline` is no longer consulted and `handle` is not called again; game messages are refused. |
| `abort` | Posts `reason` as a system line, then `resetToLobby`: phase `'lobby'`, `podium` and `game` null, any `waiting` state cleared, votes cleared, every score reset to 0, the side store reset (when the module has one), a snapshot. **Any effects after `abort` in the same list are skipped.** |
| `waiting` | Stores `missing` as the room's hold. Every later snapshot carries `RoomState.waiting = { reason: 'players', missing, needed: meta.minPlayers, connected }` with the live connected count, `missing` narrowed to players still seated and disconnected; `missing: null` clears it, as do `abort`, `gameOver` and the return to the lobby. **No snapshot is sent for you**; add one so everyone sees the hold (a tick carries none). A holding game returns `null` from `nextDeadline` while too few are connected (only the seat expiries are pending then); once enough are back it waits a short settle (`RESUME_SETTLE_MS`, restarted by every further reconnect) before going on, so a group whose sockets were all cut at once is seated together rather than from the first one back. See `server/games/waiting.ts` for the shared helpers the three games use. |
| `side` | Forwarded to the driver, which resets the side store with the given stamp (section 7). |

Around your module the platform also does: a system line "The game has started!" before
`start`; if your `start` effects contain no `snapshot`, the platform broadcasts one; the first
`nextDeadline` after `start` arms the timer.

**When each event arrives** ([`seats.ts`](../server/platform/engine/seats.ts), [`chat.ts`](../server/platform/engine/chat.ts), [`reduce.ts`](../server/platform/engine/reduce.ts)):

- `message`: after `clientMessageSchema.safeParse` succeeded and only while `'playing'`. Invalid
  messages get `INVALID_MESSAGE` with the first zod issue and path.
- `chat`: for every chat line while `'playing'`. If you do **not** return `chatHandled`, the
  platform inserts the player's line **before** your effects, so a reaction ("close!") follows
  the line it reacts to.
- `playerJoined`: the seat is already in `ctx.players`; your effects are appended after the
  newcomer's `welcome` and everyone else's snapshot, so the welcome already reflects your updated
  data (the template puts the newcomer at 0 clicks and snapshots).
- `playerLeft`: after the removal (leave, kick, vote-kick or grace expiry). Not delivered when the
  room became empty, or when the departure already dropped the room below `minPlayers` (the
  platform aborted the game first).
- `playerDisconnected` / `playerReconnected`: a socket dropped / a disconnected player rejoined
  (a socket merely replaced by a reload on the same seat does not fire `playerReconnected`). A
  disconnected player **stays in `ctx.players`** with `connected: false` until the reconnect grace
  (10 min) runs out, so anything that picks a player (the next one to act, a random holder) must
  filter on `connected`; the template never picks and so never shows this. The platform never
  abandons a game over a disconnect: if yours needs `meta.minPlayers` connected to go on, hold at
  your next boundary with a `waiting` effect (`ctx.players.length` tells you whether enough seats
  remain at all; `abort` only when they do not) and resume on `playerReconnected` / `playerJoined`.
- `tick`: `nextDeadline(data) <= now`. `ctx.now` is the deadline's own time while the platform
  catches up on several overdue deadlines, so chained deadlines stay anchored.

**Views.** `view(data, viewerId, ctx)` is called once per recipient for every snapshot, with the
viewer's id when they are seated and `null` for spectators (the HTTP preview, tests). Hide
secrets per viewer here (Skribble sends the word only to the drawer and solved guessers).

### 3.4 Client module: `GameClientModule`

[`client/src/platform/game.ts`](../client/src/platform/game.ts):

```ts
export interface GameScreenProps<V = unknown, S = Record<string, unknown>> {
  room: RoomState<V, S>;
  meId: string;
  isHost: boolean;
}

export interface SettingsFieldsProps<S = Record<string, unknown>> {
  settings: PlatformSettings & S;
  /** False for everyone but the host: render read-only values. */
  canEdit: boolean;
  /** Sends one flat settings patch (game fields only; the platform fields have their own controls). */
  patch(partial: Partial<S>): void;
}

export interface ChatInputProps {
  /** Shared between the inputs that take turns at the bottom of the chat: set by an input that
   *  unmounts while focused so its replacement takes the focus (and keeps the phone keyboard open). */
  focusMemory: RefObject<boolean>;
  /** The platform's own input form; render it whenever the game has nothing special to show. */
  defaultInput: ReactNode;
}

export interface GameClientModule<V = unknown, S = Record<string, unknown>> {
  meta: GameMeta;
  /** Rendered while the room is 'playing' or 'ended' (the platform adds the podium overlay for 'ended'). */
  Screen: ComponentType<GameScreenProps<V, S>>;
  /** Extra rows inside the lobby settings panel, under the platform fields. */
  SettingsFields?: ComponentType<SettingsFieldsProps<S>>;
  /** A small badge in the corner of the player's avatar (Skribble: pencil / check). */
  playerBadge?(room: RoomState<V, S>, player: PlayerPublic): ReactNode;
  /** Extra text next to the score in the player list (Skribble: "+120" this turn). */
  playerMeta?(room: RoomState<V, S>, player: PlayerPublic): ReactNode;
  /** Extra class for the player's row (Skribble: the green "guessed" tint). */
  playerClassName?(room: RoomState<V, S>, player: PlayerPublic): string | undefined;
  /** Replaces the chat input (Skribble's type-into-the-blanks guess bar). */
  ChatInput?: ComponentType<ChatInputProps>;
  chatPlaceholder?(room: RoomState<V, S>, meId: string | null): string | undefined;
  /** A server message that is not a platform message; return true when handled. */
  onServerMessage?(msg: WireMessage): boolean;
  /** `welcome.extra`, the game's bootstrap (Skribble: the canvas history). The room is already in the store. */
  onWelcome?(extra: unknown): void;
  /** Every snapshot, welcome included; `prev` is null when this one enters the room. */
  onRoom?(room: RoomState<V, S>, prev: RoomState<V, S> | null): void;
  /** A freshly appended chat line (history from a welcome does not count). */
  onChat?(message: ChatMessage): void;
  /** The room is being left (leave, kick, seat lost): drop local game state, flush what must still go out. */
  onLeave?(): void;
}

export type AnyGameClientModule = GameClientModule<unknown, Record<string, unknown>>;
/** Erases a module's type parameters for the registry. */
export function defineGameClient<V, S extends Record<string, unknown>>(module: GameClientModule<V, S>): AnyGameClientModule;
```

Only `meta` and `Screen` are required. The platform's shell ([`client/src/App.tsx`](../client/src/App.tsx))
renders `Lobby` while `phase === 'lobby'`, your `Screen` (keyed by room code) while `'playing'`
or `'ended'`, and the `PodiumOverlay` on top of it while `'ended'`. The player list applies your
`playerBadge` / `playerMeta` / `playerClassName` only in game mode and while `room.game !== null`;
the chat uses your `ChatInput` only while `room.game !== null`.

**Hook order** ([`client/src/platform/net/socket.ts`](../client/src/platform/net/socket.ts)) per
inbound message:

- `welcome`: the session is remembered, the platform store takes the room, then
  `onWelcome(msg.extra)`, then `onRoom(room, prev)` where `prev` is the previous room when the
  same seat reconnected and `null` for a fresh entry.
- `room`: store first, then `onRoom(room, prev)`.
- `chat`: store first, then `onChat(message)`.
- any non-platform message: `onServerMessage(msg)`, only while a room is held.
- leaving (Leave button, kick, lost seat): `onLeave()` runs **before** the URL moves and the store
  clears, so the seat is still yours if something must be flushed.

Game-specific client state belongs in the game's own zustand store
(`client/src/games/<id>/store.ts`, see Skribble's [`store.ts`](../client/src/games/skribble/store.ts)),
never in the platform store.

---

## 4. Pure-reducer rules

These are enforced by tests that run against **every** game in `GAME_IDS`
([`determinism.test.ts`](../server/platform/engine/determinism.test.ts),
[`purity.test.ts`](../server/platform/engine/purity.test.ts),
[`registry.test.ts`](../server/games/registry.test.ts)), so a new game that breaks one fails
`npm test` without you writing a test for it. The determinism suite drives your game with the
`validMessage` you put in [`server/games/testFixtures.ts`](../server/games/testFixtures.ts), so
make that a message that really changes state right after `start`. The platform room suite
([`room.platform.test.ts`](../server/platform/drivers/room.platform.test.ts): seats, hosts, kicks,
settings, chat, reconnects, the lobby) also runs every scenario against every game and reads the
same record plus your `settings.defaults`; it should pass for a new game without changes.

1. **No clock, randomness or timers.** Nothing under `server/games/` may contain `Date.now`,
   `new Date`, `Math.random`, `setTimeout`, `setInterval`, `process.`, `node:crypto`,
   `randomUUID` or `randomBytes` (the only exemption is Skribble's `canvas.ts`). Use `ctx.now`,
   `ctx.rng()`, `ctx.newId()`. The same holds for the engine itself.
2. **Never mutate the input.** `handle` receives a frozen copy in the determinism test; spread
   into new objects (`{ ...data, clicks: { ...data.clicks, [id]: n } }`) or use `withDraft`,
   which clones, lets you mutate the clone and returns the original when nothing changed.
3. **Return the same object when nothing changed.** `{ data, effects: [] }` for a no-op, so the
   driver skips the write (and Redis skips a round trip). `withDraft` does this with a deep
   comparison.
4. **Tick is idempotent and resolves its deadline.** After your `'tick'` handling,
   `nextDeadline(data)` must be `null` or later than the deadline that fired; the engine throws
   `"<gameId>: tick left its deadline at <t> unresolved"` otherwise. A tick with nothing due
   returns `{ data, effects: [] }`.
5. **Data is JSON-safe.** No `Map`, `Set`, `Date`, class instances, functions or `undefined`
   inside arrays: `JSON.parse(JSON.stringify(data))` must be the identity, because Redis stores it
   and `structuredClone` copies it. Use `Record<string, number>` and arrays.
6. **Don't import the engine or the drivers.** Nothing under `server/games/` may import from
   `server/platform/engine/` or `server/platform/drivers/` (only `drivers/types.js` is allowed, for
   `MaybePromise` / `after`). What a module needs is `shared/`, `server/platform/game.js` and, for
   side stores, `server/platform/storage.js` and `server/platform/cas.js`.
7. **Settings must pass their own schema.** `settings.defaults` must satisfy `settings.schema`,
   `patchSchema` must accept `{}`, and both must strip platform fields (`{ maxPlayers: 3 }`
   parses to `{}`), which a `z.object(...)` does by default.
8. **Game modules don't import each other** and the platform never imports a game by name; the
   registries are the only coupling.

---

## 5. The recipe, step by step

Pick an id (`GameId`, a lowercase identifier), a slug (lowercase letters, **never exactly 4
characters**), a name, an emoji and an accent. Below the new game is called `wordle` as an example;
replace throughout.

### Step 1: registry entry

[`shared/platform/games.ts`](../shared/platform/games.ts): add the id and a `GameMeta` in library order.

```ts
export type GameId = 'skribble' | 'template' | 'wordle';

// inside GAME_LIST
{
  id: 'wordle',
  slug: 'wordle',
  name: 'Wordle Royale',
  tagline: 'Five letters, six tries, one winner.',
  description: 'Everyone solves the same hidden word. Fewest guesses wins.',
  howToPlay: ['Type a five-letter word.', 'Green is right, yellow is misplaced.', 'Solve it in the fewest tries.'],
  minPlayers: 1,
  maxPlayers: 20,
  icon: '🟩',
  accent: '#16a34a',
  status: 'hidden', // flip to 'live' when ready; 'soon' shows a muted card
},
```

[`shared/platform/protocol.ts`](../shared/platform/protocol.ts): add the id to the wire schema.

```ts
export const gameIdSchema = z.enum(['skribble', 'template', 'wordle']);
```

`npm run typecheck` now fails wherever a full `Record<GameId, ...>` is built, until steps 3 and 4
are done: the two registries (`server/games/index.ts`, `client/src/games/index.ts`) and the test
fixture record (`server/games/testFixtures.ts`, filled in step 3). The client tests build their
stub registries from `GAME_IDS` (`registryOf` in [`client/src/test/fixtures.ts`](../client/src/test/fixtures.ts)),
so no test file needs an edit.

### Step 2: shared protocol

```bash
mkdir -p shared/games/wordle && cp shared/games/template/protocol.ts shared/games/wordle/protocol.ts
```

Rename `TEMPLATE_` / `template` / `Template` to your prefix. Keep the four things the template
has: limits, settings schema + type + defaults, client message schema + type, server message type,
view type, `RoomState` alias. Server messages are only needed for streams that are not worth a
snapshot; most games keep `type WordleServerMessage = never` and let snapshots carry everything.

### Step 3: server module and tests

```bash
mkdir -p server/games/wordle
cp server/games/template/module.ts server/games/wordle/module.ts
cp server/games/template/template.test.ts server/games/wordle/wordle.test.ts
```

Register it in [`server/games/index.ts`](../server/games/index.ts):

```ts
import { wordleModule } from './wordle/module.js';

export const GAMES: Readonly<Record<GameId, AnyGameServerModule>> = {
  skribble: skribbleModule,
  template: templateModule,
  wordle: wordleModule,
};
```

Add the game to [`server/games/testFixtures.ts`](../server/games/testFixtures.ts), which the
harnesses and the cross-game suites read:

```ts
wordle: {
  settings: { rounds: 1 },                 // applied by startGame before 'start': deterministic and short
  longSettings: { rounds: 10 },            // the longest game the settings allow (ideally still running 10 min in)
  validMessage: { t: 'guess', word: 'crane' },  // accepted from the host right after 'start'
},
```

Write the module as the template does: a `Data` interface, `start`, `handle` (a `switch` on
`event.type`, default `{ data, effects: [] }`), `nextDeadline`, `view`, and the exported module
object with `meta: gameById('wordle')`, `settings: defineSettings(schema, defaults, normalize?)`
and `clientMessageSchema`.

Tests use the deterministic harness in [`server/platform/engine/testHarness.ts`](../server/platform/engine/testHarness.ts):

```ts
const s = sim('wordle');                                   // a room at START (2026-01-01T12:00Z), ids 'id-1', 'id-2', ..., rng () => 0
const [alice, bob] = startGame(s, ['Alice', 'Bob'], { /* settings patch */ });  // create + join + updateSettings + start
s.game(alice, { t: 'guess', word: 'crane' });              // a game message; returns that action's effects
s.platform(bob, { t: 'chat', text: 'hi' });                // a platform message
s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
s.now += 30_000; s.tick();                                 // advance the clock, fire due deadlines
s.data.phase; s.data.podium; s.data.players[0].score;      // the engine state
viewFor(s.data, alice, s.now).game;                        // a recipient's view
nextDeadline(s.data);                                      // the merged platform + game deadline
chatTexts(effects);                                        // chat lines in a set of effects
```

`sim(gameId, code?, now?, rng?)` lets you pass another rng (`() => 0.99`) to exercise random
choices. Also test the module directly as a function (`module.handle(ctx, data, event).data` is
`data` for a no-op), as the last test in the template does.

### Step 4: client module and styles

```bash
mkdir -p client/src/games/wordle
cp client/src/games/template/{module.tsx,Screen.tsx,SettingsFields.tsx} client/src/games/wordle/
cp client/src/games/template/template.css client/src/games/wordle/wordle.css
```

Register it in [`client/src/games/index.ts`](../client/src/games/index.ts):

```ts
import { wordleClient } from './wordle/module';

export const GAMES: Readonly<Record<GameId, AnyGameClientModule>> = {
  skribble: skribbleClient,
  template: templateClient,
  wordle: wordleClient,
};
```

`main.tsx` already calls `registerGames(GAMES)`; nothing else to wire. In `module.tsx` import your
stylesheet (`import './wordle.css'`) and build the module with
`defineGameClient<WordleView, WordleSettings>({ meta: gameById('wordle'), Screen, SettingsFields })`.

Style rules that keep the look consistent (details in section 8):

- Use a unique root class for the screen (`.wordle`) and BEM-style children (`.wordle__board`).
- Platform CSS is imported first in `main.tsx`, so a game stylesheet wins ties. **Inside a media
  query, prefix overrides of platform classes with your root class** (`.wordle .timer--lg`),
  because an equal-specificity rule depends on bundle order.
- Only tokens for colours, spacing, radii and shadows; `meta.accent` is the one literal colour,
  applied inline (`style={{ background: meta.accent }}`) as the template and the library card do.
- Sends go through `socket.send({ t: 'guess', word })` from `client/src/platform/net/socket.ts`;
  wrap them in a small `actions.ts` once there are several (see Skribble's
  [`actions.ts`](../client/src/games/skribble/actions.ts)).

Unit tests for client modules live next to them (`client/src/games/wordle/wordle.test.ts`) and
run in node; copy [`template.test.ts`](../client/src/games/template/template.test.ts) (section 6.8).
The shape: call `installBrowserGlobals()` from [`client/src/test/env.ts`](../client/src/test/env.ts)
before dynamically importing the modules (it stubs the address bar, `matchMedia`, timers and the
absent web storage, so a whole `Screen` including `SiteHeader` renders), register the module with
`registerGames(registryOf(module))`, build rooms with `room(...)`, `player(...)`, `welcome(...)`
from [`client/src/test/fixtures.ts`](../client/src/test/fixtures.ts), call
`usePlatformStore.getState().handleServerMessage(...)` then your hooks in the socket's order, and
render components with `renderToString(createElement(...))` to assert on markup. Assert on
attributes (`data-testid`, `data-*`, `aria-label`) rather than on text: `renderToString` separates
adjacent text nodes with `<!-- -->`, so `Round {a} of {b}` does not contain `Round 2 of 3` (a
template string does). [`skribble.test.ts`](../client/src/games/skribble/skribble.test.ts) shows
the store, hooks and offline-queue side of a bigger module.

### Step 5: end-to-end test

Add a `test(...)` to a spec in `e2e/` (or a new `e2e/wordle.spec.ts` with the same shape as
[`e2e/library.spec.ts`](../e2e/library.spec.ts)): open `/wordle`, fill `home-name`, click
`home-create`, read `room-code`, open `/wordle/<CODE>` in a second context and click `home-join`,
adjust a setting through `settings-<id>`, click `start-game`, drive your screen through its own
`data-testid`s, then assert the `overlay-game-end` podium (`podium-entry` with `data-rank`),
`back-to-lobby` for the host and `room-code` again afterwards. The Click Race test in
`library.spec.ts` ("the hidden template game plays a whole Click Race between two players") is
exactly this and is the one to copy. Keep the "no page errors" assertion pattern.

The platform test ids you will use: `home-name`, `home-create`, `home-join`, `code-input-0..3`,
`room-code`, `invite-banner`, `room-preview`, `player-item` (with `data-name`, `data-score`),
`player-count`, `settings-row-<id>`, `settings-value-<id>`, `settings-<id>`, `start-game`,
`start-hint`, `waiting-for-host`, `leave-room`, `chat-input`, `chat-send`, `chat-log`,
`chat-message` (with `data-kind`), `timer` (with `data-seconds`), `overlay-game-end`,
`podium-entry`, `back-to-lobby`, `podium-leave`, `toast`, `connection-status` (with `data-status`),
`site-header`, `brand-link`, `game-card` (with `data-game`), `game-grid`, `library-join`.

### Step 6: ship it

Set `status: 'live'` in `GameMeta`. The library card (icon in an accent tile, name, tagline,
`min-max players`) appears from `GAME_LIST`; `/wordle` and `/wordle/CODE` already route; the
PWA, Vercel function and Redis driver need no change.

---

## 6. The template game, in full

Click Race (`id: 'template'`, hidden, reachable at `/template`): settings `targetClicks`
(10–100, default 30) and `timeLimit` seconds (10–120, default 30); `start` sets everyone to 0
clicks and a deadline; `{ t: 'click' }` increments the sender; the first to reach the target ends
the game with +100 and everyone else gets +clicks; the deadline ends it with everyone +clicks;
mid-game joiners start at 0. `minPlayers` is 1 so a solo race is playable (handy for tests).

### 6.1 `shared/games/template/protocol.ts`

What crosses the wire. `TemplateServerMessage` is `never`: snapshots carry everything, so the
client module needs no `onServerMessage`.

```ts
/**
 * Click Race: the template game. Copy this file for a new game and replace the settings,
 * messages and view. Everything a game needs on the wire lives here; the platform handles rooms,
 * seats, chat, scores and the podium.
 */
import { z } from 'zod';
import type { RoomState } from '../../platform/protocol.js';

export const TEMPLATE_SETTINGS_LIMITS = {
  targetClicks: { min: 10, max: 100 },
  timeLimit: { min: 10, max: 120 },
} as const;

export const templateSettingsSchema = z.object({
  /** Clicks needed to win. */
  targetClicks: z.number().int().min(TEMPLATE_SETTINGS_LIMITS.targetClicks.min).max(TEMPLATE_SETTINGS_LIMITS.targetClicks.max),
  /** Seconds before the race ends on its own. */
  timeLimit: z.number().int().min(TEMPLATE_SETTINGS_LIMITS.timeLimit.min).max(TEMPLATE_SETTINGS_LIMITS.timeLimit.max),
});

export type TemplateSettings = z.infer<typeof templateSettingsSchema>;

export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = { targetClicks: 30, timeLimit: 30 };

export const templateClientMessageSchema = z.discriminatedUnion('t', [z.object({ t: z.literal('click') })]);
export type TemplateClientMessage = z.infer<typeof templateClientMessageSchema>;

/** Click Race sends nothing beyond snapshots. */
export type TemplateServerMessage = never;

export interface TemplateView {
  /** Clicks so far, by player id (0 for players who joined mid-game). */
  clicks: Record<string, number>;
  /** Epoch ms (server clock) when the race ends. */
  endsAt: number;
  /** Set once somebody reached the target. */
  winnerId: string | null;
}

export type TemplateRoomState = RoomState<TemplateView, TemplateSettings>;
```

### 6.2 `server/games/template/module.ts`

The reducer. Note what it does **not** do: it never reads a clock (`ctx.now`), never mutates
`data` (every change spreads into a new object), returns the input object untouched for events it
ignores, and only emits `snapshot`, `score` and `gameOver`. `finish` emits the scores and then
`gameOver`; the platform builds the podium from the resulting scores. `view` copies `clicks` so a
snapshot never shares an object with the state.

```ts
/**
 * Click Race: the template game module. Copy this folder to start a new game. A module is a pure
 * reducer: `start` builds the initial state, `handle` folds one event into it and returns the
 * next state plus effects, `nextDeadline` tells the platform when to tick, `view` renders what
 * one player may see. The platform owns everything else (seats, chat, scores, podium, lobby).
 */
import {
  DEFAULT_TEMPLATE_SETTINGS,
  templateClientMessageSchema,
  templateSettingsSchema,
  type TemplateClientMessage,
  type TemplateServerMessage,
  type TemplateSettings,
  type TemplateView,
} from '../../../shared/games/template/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defineSettings, type GameCtx, type GameEffect, type GameEvent, type GameResult, type GameServerModule } from '../../platform/game.js';

/** JSON-safe game state: everything the race needs, nothing about seats or scores. */
export interface TemplateData {
  clicks: Record<string, number>;
  endsAt: number;
  winnerId: string | null;
  over: boolean;
}

type Result = GameResult<TemplateData, TemplateServerMessage>;
type Effect = GameEffect<TemplateServerMessage>;

const WIN_BONUS = 100;

function start(ctx: GameCtx<TemplateSettings>): Result {
  const clicks: Record<string, number> = {};
  for (const p of ctx.players) clicks[p.id] = 0;
  return { data: { clicks, endsAt: ctx.now + ctx.settings.timeLimit * 1000, winnerId: null, over: false }, effects: [{ type: 'snapshot', to: 'all' }] };
}

function handle(ctx: GameCtx<TemplateSettings>, data: TemplateData, event: GameEvent<TemplateClientMessage>): Result {
  if (data.over) return { data, effects: [] };
  switch (event.type) {
    case 'message':
      return click(ctx, data, event.playerId);
    case 'playerJoined':
      return { data: { ...data, clicks: { ...data.clicks, [event.playerId]: 0 } }, effects: [{ type: 'snapshot', to: 'all' }] };
    case 'tick':
      return ctx.now >= data.endsAt ? finish(ctx, data, null) : { data, effects: [] };
    default:
      // Chat, leaves and reconnects need no reaction: the platform already handles them.
      return { data, effects: [] };
  }
}

function click(ctx: GameCtx<TemplateSettings>, data: TemplateData, playerId: string): Result {
  const count = (data.clicks[playerId] ?? 0) + 1;
  const next: TemplateData = { ...data, clicks: { ...data.clicks, [playerId]: count } };
  if (count >= ctx.settings.targetClicks) return finish(ctx, next, playerId);
  return { data: next, effects: [{ type: 'snapshot', to: 'all' }] };
}

/** Ends the race: the winner (if any) takes the bonus, everyone else scores their clicks; the platform builds the podium. */
function finish(ctx: GameCtx<TemplateSettings>, data: TemplateData, winnerId: string | null): Result {
  const effects: Effect[] = [];
  for (const p of ctx.players) {
    const delta = p.id === winnerId ? WIN_BONUS : (data.clicks[p.id] ?? 0);
    if (delta > 0) effects.push({ type: 'score', playerId: p.id, delta });
  }
  effects.push({ type: 'gameOver' });
  return { data: { ...data, winnerId, over: true }, effects };
}

function nextDeadline(data: TemplateData): number | null {
  return data.over ? null : data.endsAt;
}

function view(data: TemplateData): TemplateView {
  return { clicks: { ...data.clicks }, endsAt: data.endsAt, winnerId: data.winnerId };
}

export const templateModule: GameServerModule<TemplateSettings, TemplateData, TemplateView, TemplateClientMessage, TemplateServerMessage> = {
  meta: gameById('template'),
  settings: defineSettings(templateSettingsSchema, DEFAULT_TEMPLATE_SETTINGS),
  clientMessageSchema: templateClientMessageSchema,
  start,
  handle,
  nextDeadline,
  view,
};
```

### 6.3 `server/games/template/template.test.ts`

Through the pure engine with the deterministic harness: start, counting, both ways a race ends,
mid-game joiners, and a direct purity check on the module.

```ts
/** Click Race through the pure engine: the template every new game's tests can copy. */
import { describe, expect, it } from 'vitest';
import type { TemplateView } from '../../../shared/games/template/protocol.js';
import type { PlatformServerMessageOf } from '../../../shared/platform/protocol.js';
import type { Effect } from '../../platform/engine/effects.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { viewFor } from '../../platform/engine/view.js';
import { AVATAR, START, chatTexts, sim, startGame } from '../../platform/engine/testHarness.js';
import { templateModule, type TemplateData } from './module.js';

const view = (s: { data: Parameters<typeof viewFor>[0]; now: number }, viewer: string | null = null): TemplateView => {
  const game = viewFor(s.data, viewer, s.now).game;
  if (!game) throw new Error('no game');
  return game as TemplateView;
};

const snapshots = (effects: Effect[]): number => effects.filter((e) => e.type === 'send' && e.msg.t === 'room').length;

describe('Click Race', () => {
  it('starts everyone at zero with a deadline and snapshots the room', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { timeLimit: 30, targetClicks: 10 });
    expect(s.data.phase).toBe('playing');
    expect(s.data.game).toEqual({ clicks: { [alice]: 0, [bob]: 0 }, endsAt: START + 30_000, winnerId: null, over: false });
    expect(view(s)).toEqual({ clicks: { [alice]: 0, [bob]: 0 }, endsAt: START + 30_000, winnerId: null });
    expect(nextDeadline(s.data)).toBe(START + 30_000);
    const last = s.effects.filter((e): e is Extract<Effect, { type: 'send' }> => e.type === 'send' && e.msg.t === 'room').at(-1);
    expect((last?.msg as PlatformServerMessageOf<'room'>).room.game).toEqual(view(s));
  });

  it('counts clicks per player and tells everyone', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { targetClicks: 10 });
    const effects = s.game(alice, { t: 'click' });
    expect(snapshots(effects)).toBe(2);
    s.game(alice, { t: 'click' });
    s.game(bob, { t: 'click' });
    expect(view(s).clicks).toEqual({ [alice]: 2, [bob]: 1 });
    expect(s.data.players.map((p) => p.score)).toEqual([0, 0]);
  });

  it('ends the race when someone reaches the target: +100 for the winner, +clicks for everyone else', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { targetClicks: 10 });
    for (let i = 0; i < 4; i++) s.game(bob, { t: 'click' });
    for (let i = 0; i < 9; i++) s.game(alice, { t: 'click' });
    expect(s.data.phase).toBe('playing');
    const effects = s.game(alice, { t: 'click' });
    expect(s.data.phase).toBe('ended');
    expect(view(s)).toMatchObject({ winnerId: alice, clicks: { [alice]: 10, [bob]: 4 } });
    expect(s.data.podium).toEqual([
      { playerId: alice, score: 100, rank: 1 },
      { playerId: bob, score: 4, rank: 2 },
    ]);
    expect(chatTexts(effects)).toEqual(['Game over! Alice wins with 100 points.']);
    expect(nextDeadline(s.data)).toBeNull();
    // Clicks after the finish are refused by the platform: the game is not running.
    const late = s.game(bob, { t: 'click' });
    expect(late).toEqual([{ type: 'send', to: [bob], msg: { t: 'error', code: 'NOT_ALLOWED', message: 'The game is not running.' } }]);
  });

  it('ends at the time limit with everyone scoring their clicks', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { timeLimit: 15, targetClicks: 100 });
    for (let i = 0; i < 5; i++) s.game(bob, { t: 'click' });
    s.now += 15_000;
    s.tick();
    expect(s.data.phase).toBe('ended');
    expect(view(s).winnerId).toBeNull();
    expect(s.data.podium).toEqual([
      { playerId: bob, score: 5, rank: 1 },
      { playerId: alice, score: 0, rank: 2 },
    ]);
  });

  it('seats mid-game joiners at zero clicks', () => {
    const s = sim('template');
    const [alice] = startGame(s, ['Alice', 'Bob'], { targetClicks: 10 });
    s.game(alice, { t: 'click' });
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expect(view(s).clicks[carol]).toBe(0);
    s.game(carol, { t: 'click' });
    expect(view(s).clicks).toMatchObject({ [alice]: 1, [carol]: 1 });
    // Leaving mid-race keeps the others going; the leaver's clicks stay in the tally for the view.
    s.apply({ type: 'leave', playerId: carol });
    expect(s.data.phase).toBe('playing');
  });

  it('is a pure module: the same object comes back when nothing changed', () => {
    const data: TemplateData = { clicks: { a: 1 }, endsAt: 1000, winnerId: null, over: false };
    const ctx = { now: 500, rng: () => 0, newId: () => 'x', settings: templateModule.settings.defaults, players: [{ id: 'a', name: 'A', joinOrder: 0, connected: true, score: 0 }], hostId: 'a' };
    expect(templateModule.handle(ctx, data, { type: 'tick' }).data).toBe(data);
    expect(templateModule.handle(ctx, data, { type: 'chat', playerId: 'a', text: 'hi' }).data).toBe(data);
    const clicked = templateModule.handle(ctx, data, { type: 'message', playerId: 'a', msg: { t: 'click' } });
    expect(clicked.data).not.toBe(data);
    expect(data.clicks.a).toBe(1);
    expect(templateModule.view(data, 'a', { ...ctx })).toEqual({ clicks: { a: 1 }, endsAt: 1000, winnerId: null });
  });
});
```

### 6.4 `client/src/games/template/module.tsx`

The smallest possible client module: `meta`, `Screen`, `SettingsFields`, its stylesheet.

```tsx
/**
 * Click Race: the template client module. Copy this folder for a new game. The platform renders
 * the library card, the game home, the lobby, chat, players and the podium; a module only needs
 * a Screen (and, optionally, settings rows and the hooks listed in platform/game.ts).
 */
import type { TemplateSettings, TemplateView } from '@shared/games/template/protocol';
import { gameById } from '@shared/platform/games';
import { defineGameClient } from '../../platform/game';
import { ClickRaceScreen } from './Screen';
import { ClickRaceSettingsFields } from './SettingsFields';
import './template.css';

export const templateClient = defineGameClient<TemplateView, TemplateSettings>({
  meta: gameById('template'),
  Screen: ClickRaceScreen,
  SettingsFields: ClickRaceSettingsFields,
});
```

### 6.5 `client/src/games/template/Screen.tsx`

The screen gets `{ room, meId, isHost }`. It reads the view from `room.game` and the game's
settings from `room.settings` (typed through `GameScreenProps<TemplateView, TemplateSettings>`),
sends `{ t: 'click' }` straight through the socket, and composes platform components: `SiteHeader`
with a Leave button, `Timer`, `Avatar`, `Chat`. The podium is not its concern. Every interactive
element carries a `data-testid` for the e2e test.

```tsx
import { gameById } from '@shared/platform/games';
import type { TemplateSettings, TemplateView } from '@shared/games/template/protocol';
import { Avatar } from '../../platform/components/Avatar';
import { Chat } from '../../platform/components/Chat';
import { LogoutIcon } from '../../platform/components/Icons';
import { SiteHeader } from '../../platform/components/SiteHeader';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { leaveRoom } from '../../platform/net/actions';
import { socket } from '../../platform/net/socket';

const meta = gameById('template');

/** One big button, a live ranking and the clock. The platform draws the podium when the race ends. */
export function ClickRaceScreen({ room, meId }: GameScreenProps<TemplateView, TemplateSettings>) {
  const view = room.game;
  if (!view) return null;
  const target = room.settings.targetClicks;
  const mine = view.clicks[meId] ?? 0;
  const racing = room.phase === 'playing';
  const ranking = room.players.slice().sort((a, b) => (view.clicks[b.id] ?? 0) - (view.clicks[a.id] ?? 0) || a.joinOrder - b.joinOrder);

  return (
    <div className="race">
      <SiteHeader crumb={meta.name}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room">
          <LogoutIcon size={16} /> Leave
        </button>
      </SiteHeader>
      <div className="race__grid">
        <main className="card race__main">
          <header className="race__head">
            <div>
              <p className="overlay__kicker">{meta.name}</p>
              <h1 className="race__title">First to {target} taps wins</h1>
            </div>
            <Timer endsAt={view.endsAt} warnUnder={5} tickUnder={3} />
          </header>
          <button
            type="button"
            className="race__button"
            style={{ background: meta.accent }}
            onClick={() => socket.send({ t: 'click' })}
            disabled={!racing}
            aria-label={`Tap! ${mine} of ${target}`}
            data-testid="click-button"
          >
            <span className="race__count" data-testid="click-count">
              {mine}
            </span>
            <span className="race__target">/ {target}</span>
          </button>
          <ol className="race__list" aria-label="Progress" data-testid="race-list">
            {ranking.map((p) => {
              const clicks = view.clicks[p.id] ?? 0;
              return (
                <li key={p.id} className={`race__row${p.id === meId ? ' race__row--me' : ''}`} data-testid="race-row" data-name={p.name} data-clicks={clicks}>
                  <Avatar avatar={p.avatar} size="sm" dimmed={!p.connected} />
                  <span className="race__name">{p.name}</span>
                  <progress className="race__bar" value={Math.min(clicks, target)} max={target} aria-label={`${p.name}: ${clicks} of ${target}`} />
                  <span className="race__clicks">{clicks}</span>
                </li>
              );
            })}
          </ol>
        </main>
        <aside className="card race__chat" aria-label="Chat">
          <Chat />
        </aside>
      </div>
    </div>
  );
}
```

### 6.6 `client/src/games/template/SettingsFields.tsx`

Two `RangeSetting` rows; `patch` sends one flat object the server validates with the game's
`patchSchema`. `revision={settings}` makes the slider follow a server echo that rejected or
clamped a value.

```tsx
import { TEMPLATE_SETTINGS_LIMITS, type TemplateSettings } from '@shared/games/template/protocol';
import { RangeSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';

const L = TEMPLATE_SETTINGS_LIMITS;

/** Click Race's two rows in the lobby settings panel. */
export function ClickRaceSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<TemplateSettings>) {
  return (
    <>
      <RangeSetting
        id="targetClicks"
        label="Taps to win"
        canEdit={canEdit}
        value={settings.targetClicks}
        min={L.targetClicks.min}
        max={L.targetClicks.max}
        onCommit={(v) => patch({ targetClicks: v })}
        hint="The first player to reach this many taps wins the race."
        revision={settings}
      />
      <RangeSetting
        id="timeLimit"
        label="Time limit in seconds"
        rowLabel="Time limit"
        canEdit={canEdit}
        value={settings.timeLimit}
        display={`${settings.timeLimit}s`}
        min={L.timeLimit.min}
        max={L.timeLimit.max}
        onCommit={(v) => patch({ timeLimit: v })}
        revision={settings}
      />
    </>
  );
}
```

### 6.7 `client/src/games/template/template.css`

Tokens only, a two-column grid that collapses at the shared 760px breakpoint, safe-area padding,
a 44px+ tap target. The accent colour comes from `meta.accent` inline, not from here.

```css
/* ---------- Click Race ---------- */
.race {
  width: min(1040px, 100%);
  margin: 0 auto;
  padding: calc(var(--space-4) + env(safe-area-inset-top)) max(var(--gutter), env(safe-area-inset-right)) calc(var(--space-6) + env(safe-area-inset-bottom))
    max(var(--gutter), env(safe-area-inset-left));
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.race__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 1fr);
  gap: var(--space-4);
  align-items: start;
}

.race__main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-5);
}

.race__head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.race__title {
  font-size: 1.4rem;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.race__button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: min(260px, 70vw);
  aspect-ratio: 1;
  border-radius: 50%;
  color: #fff;
  box-shadow: var(--shadow-lg);
  transition: transform 0.06s ease;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}

.race__button:active:not(:disabled) {
  transform: scale(0.95);
}

.race__button:disabled {
  opacity: 0.6;
}

.race__count {
  font-size: 4rem;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.race__target {
  font-weight: 700;
  opacity: 0.85;
}

.race__list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.race__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(80px, 2fr) auto;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}

.race__row--me {
  background: var(--color-primary-soft);
}

.race__name {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.race__bar {
  width: 100%;
  height: 10px;
  accent-color: var(--color-primary);
}

.race__clicks {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  min-width: 2ch;
  text-align: right;
}

.race__chat {
  display: flex;
  flex-direction: column;
  height: min(70vh, 640px);
}

@media (max-width: 760px) {
  .race__grid {
    grid-template-columns: 1fr;
  }

  .race__chat {
    height: 50vh;
  }
}
```

---

### 6.8 `client/src/games/template/template.test.ts`

```ts
/**
 * Click Race's client module under test: the template every new game's client tests can copy.
 * The tests run in node: browser globals are stubbed, components render through react-dom/server.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { TemplateRoomState } from '@shared/games/template/protocol';
import { installBrowserGlobals, setLocation } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../../platform/store/usePlatformStore');
const { registerGames } = await import('../../platform/registry');
const { templateClient } = await import('./module');
const { player, registryOf, resetStore, room, welcome } = await import('../../test/fixtures');

/** A race in progress between the host (7 taps) and bob (3 taps), as the server would snapshot it. */
function race(overrides: Partial<TemplateRoomState> = {}): TemplateRoomState {
  return {
    ...room({ gameId: 'template', phase: 'playing', players: [player('host'), player('bob', { joinOrder: 1 })] }),
    settings: { maxPlayers: 12, allowMidGameJoin: true, targetClicks: 10, timeLimit: 30 },
    game: { clicks: { host: 7, bob: 3 }, endsAt: Date.now() + 20_000, winnerId: null },
    ...overrides,
  };
}

/** Attributes of the first tag carrying `data-testid="<id>"` in the markup. */
function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid=${testId} in ${html}`);
  return match[0];
}

beforeEach(() => {
  resetStore();
  setLocation('/template/ABCD');
  registerGames(registryOf(templateClient));
});

describe('Click Race screen', () => {
  it('renders the tap button with my count, the ranking and the clock', () => {
    const state = race();
    usePlatformStore.getState().handleServerMessage(welcome('bob', state));
    const html = renderToString(createElement(templateClient.Screen, { room: state, meId: 'bob', isHost: false }));
    expect(tagWith(html, 'click-button')).not.toContain('disabled');
    expect(tagWith(html, 'click-button')).toContain('aria-label="Tap! 3 of 10"');
    // Mixed JSX text renders with comment separators under renderToString; assert on attributes instead.
    const rows = html.match(/<li[^>]*data-testid="race-row"[^>]*>/g) ?? [];
    expect(rows.map((r) => r.match(/data-name="([^"]+)"/)?.[1])).toEqual(['host', 'bob']);
    expect(rows.map((r) => r.match(/data-clicks="(\d+)"/)?.[1])).toEqual(['7', '3']);
    expect(tagWith(html, 'timer')).toMatch(/data-seconds="(19|20)"/);
  });

  it('disables the button once the race ended (the platform shows the podium over it)', () => {
    const state = race({ phase: 'ended', podium: [{ playerId: 'host', score: 100, rank: 1 }] });
    usePlatformStore.getState().handleServerMessage(welcome('host', state));
    const html = renderToString(createElement(templateClient.Screen, { room: state, meId: 'host', isHost: true }));
    expect(tagWith(html, 'click-button')).toContain('disabled');
  });
});

describe('Click Race settings rows', () => {
  it('renders both sliders with the shared limits for the host, read-only values otherwise', () => {
    const { settings } = race();
    if (!templateClient.SettingsFields) throw new Error('no settings fields');
    const host = renderToString(createElement(templateClient.SettingsFields, { settings, canEdit: true, patch: () => undefined }));
    expect(tagWith(host, 'settings-targetClicks')).toContain('min="10"');
    expect(tagWith(host, 'settings-timeLimit')).toContain('max="120"');
    const guest = renderToString(createElement(templateClient.SettingsFields, { settings, canEdit: false, patch: () => undefined }));
    expect(guest).not.toContain('data-testid="settings-targetClicks"');
    expect(tagWith(guest, 'settings-value-timeLimit')).toBeTruthy();
    expect(guest).toContain('30s');
  });
});
```

---

## 7. Advanced: side stores (how Skribble streams drawing)

Most games do not need this; the template deliberately does not use it. Reach for a side store
only when a game has a **high-rate stream whose every message would be wasteful to run through
the reducer** (Skribble's drawing: dozens of batches a second that must reach the other players
with minimal latency and be replayed for late joiners). Everything else belongs in the reducer.

The pieces, all in [`server/platform/game.ts`](../server/platform/game.ts) and
[`server/platform/storage.ts`](../server/platform/storage.ts):

```ts
// On the module:
sideMessages?: ReadonlySet<string>;                         // message types the driver routes to the store
createSideStore?(storage: GameStorage): GameSideStore<D, CMsg, SMsg>;

/** What the room looks like to a side store: the platform's record with the game's data inside. */
export interface SideRoom<D> { code: string; phase: 'lobby' | 'playing' | 'ended'; game: D | null; players: PlatformPlayer[]; }

export type SideOutcome<SMsg> =
  | { ok: true; seq: number; sends: Array<{ to: Recipients; msg: SMsg }>; resync?: string }
  /** Refused; `message` (if any) is sent to the player as a NOT_ALLOWED error. */
  | { ok: false; message: string | null };

export interface GameSideStore<D, CMsg, SMsg> {
  /** The stamp the store must carry for `room`'s current game data ('' when none). */
  stamp(room: SideRoom<D>): string;
  handleMessage(room: SideRoom<D>, playerId: string, msg: CMsg, now: number): MaybePromise<SideOutcome<SMsg>>;
  /** The bootstrap for `welcome.extra` and the sequence number it is current to. */
  welcomeExtra(room: SideRoom<D>, playerId: string): MaybePromise<{ extra: unknown; seq: number }>;
  /** A full resync for a drifted player, or null when they no longer need one. */
  resync(room: SideRoom<D>, playerId: string, now: number): MaybePromise<{ msg: SMsg; seq: number } | null>;
}

export const SIDE_RESYNC_DEBOUNCE_MS = 1000;

// The storage a side store is built over: one per room, a list + a string hash + a sequence number.
export interface GameStorage {
  state(code): MaybePromise<{ hash: Record<string, string>; seq: number }>;
  list(code): MaybePromise<{ items: unknown[]; seq: number }>;
  length(code): MaybePromise<number>;
  range(code, start, stop): MaybePromise<unknown[]>;                                   // inclusive, like LRANGE
  append(code, seq, items, fields): MaybePromise<number | 'conflict'>;                 // conditional on seq
  pop(code, seq, count, increments, deletes): MaybePromise<number | 'conflict'>;
  reset(code, seq | null, stamp): MaybePromise<number | 'conflict'>;                   // empties list + hash, stamps
  drop(code): MaybePromise<void>;
}
export const STAMP_FIELD = 'stamp';
```

How it flows:

1. **Routing.** The connection layer passes every non-platform message to the driver. If the
   room's module has `sideMessages` containing `msg.t`, the driver validates the message with
   `clientMessageSchema` and calls `store.handleMessage(room, playerId, msg, now)` instead of
   dispatching an engine action ([`drivers/room.ts`](../server/platform/drivers/room.ts),
   [`drivers/redis.ts`](../server/platform/drivers/redis.ts)). The reducer still receives these
   types in its `CMsg` union; Skribble's `handle` simply ignores `draw` / `undo` / `clear`.
2. **Storage.** `MemoryStorage` ([`storage.ts`](../server/platform/storage.ts)) and
   `RedisStorage` ([`drivers/redisStorage.ts`](../server/platform/drivers/redisStorage.ts), keys
   `room:CODE:side`, `room:CODE:side:meta`, `room:CODE:side:seq`) implement the same interface; writes
   are conditional on the `seq` the caller read, so concurrent instances never interleave. Wrap
   attempts in `retryCas` from [`server/platform/cas.ts`](../server/platform/cas.ts) and chain
   sync-or-async results with `after` from [`drivers/types.ts`](../server/platform/drivers/types.ts).
3. **Fan-out.** The driver broadcasts `outcome.sends` (memory: straight to sockets; Redis: a
   `{ kind: 'side', seq, stamp, sends }` channel message every instance applies to its own
   sockets, skipping changes a joiner's welcome snapshot already included).
4. **Stamps.** The reducer mints a new id for each "round" of side data (Skribble: `canvasId` via
   `ctx.newId()`) and emits `{ type: 'side', name: 'reset', payload: { stamp } }`; the driver
   empties the store and stamps it. `handleMessage` compares `stamp(room)` with the stored stamp and
   refuses writes authorised against stale data. Platform-level lobby transitions (abort, return to
   lobby, empty room) reset the store with stamp `''` automatically when the module has
   `createSideStore`.
5. **Welcome.** The driver completes every `welcome` with `extra` from `store.welcomeExtra`
   (Skribble: `{ canvas: CanvasAction[] }`). Games without a side store have `extra` undefined.
6. **Resync.** When the store had to cut a player's input (Skribble's per-turn caps),
   `outcome.resync = playerId` schedules `store.resync` after `SIDE_RESYNC_DEBOUNCE_MS`.

Skribble's implementation is [`server/games/skribble/canvas.ts`](../server/games/skribble/canvas.ts)
(`CanvasStore`, `createCanvasStore`), with the message types in `SKRIBBLE_SIDE_MESSAGE_TYPES` from
[`shared/games/skribble/protocol.ts`](../shared/games/skribble/protocol.ts). On the client the
counterpart is the module's `onServerMessage` (apply `draw` / `undo` / `clear` / `canvas` to the
game's own store), `onWelcome` (seed the store from `extra`) and `onLeave` (flush the outgoing
queue), plus a batching queue ([`client/src/games/skribble/net.ts`](../client/src/games/skribble/net.ts)).

Constraints: the store receives `now` as a parameter and must not read the clock itself (the
purity test exempts only `canvas.ts`, so a new side store file would have to be added to that
exemption deliberately, and it still should not need it); side messages are rate limited like any
game message (60/s per socket); a side store never touches `PlatformRoomData`, it only reads the
`SideRoom` it is given. Document the stream in the game's protocol file and test the store over
`MemoryStorage` the way [`canvas.test.ts`](../server/games/skribble/canvas.test.ts) does.

---

## 8. The design system

Everything a game screen needs to look like the rest of the site is in
`client/src/platform/styles/` and `client/src/platform/components/`. Use these; add game CSS only
for what is truly game-specific.

### 8.1 Tokens ([`tokens.css`](../client/src/platform/styles/tokens.css))

Defined on `:root`, redefined under `:root[data-theme='dark']` (the theme attribute is set before
first paint by the inline script in `index.html` and kept by the `ThemeToggle`).

| Group | Tokens |
| --- | --- |
| Type | `--font-sans`, `--font-mono` |
| Spacing | `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 24px, `--space-6` 32px, `--space-7` 48px, `--gutter` 16px |
| Radii | `--radius-sm` 10px, `--radius-md` 14px, `--radius-lg` 22px, `--radius-pill` |
| Shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg` |
| Surfaces | `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-surface-3`, `--color-border`, `--color-border-strong`, `--color-blob-1/2` (the background blobs) |
| Text | `--color-text`, `--color-text-muted`, `--color-text-faint` (small text, AA on surfaces) |
| Brand | `--color-primary`, `--color-primary-hover`, `--color-primary-soft`, `--color-primary-contrast`, `--color-primary-text`; `--color-secondary*` (orange) with the same five |
| Status | `--color-success`, `-soft`, `-text`; `--color-warning*`; `--color-danger*`; `--color-info-soft`; `--color-focus` |
| Chat | `--chat-correct-bg/fg`, `--chat-close-bg/fg`, `--chat-guessed-bg/fg` |
| Misc | `--canvas-bg`, `--overlay-bg`, `--mobile-breakpoint` (760px, informational: media queries need the literal) |

Use `*-text` variants for coloured text and the bright variants for icons, borders and fills.

### 8.2 Classes ([`components.css`](../client/src/platform/styles/components.css))

| Purpose | Classes |
| --- | --- |
| Layout | `.card` (surface, border, `--radius-lg`, `--shadow-md`, `--space-5` padding), `.card__head`, `.card__title`, `.card__text` |
| Buttons | `.btn` with `.btn--primary`, `.btn--secondary`, `.btn--ghost`, `.btn--danger`, sizes `.btn--lg` / `.btn--sm` / `.btn--xs`, `.btn--block`, `.btn--choice` (big option buttons); `.icon-btn`, `.icon-btn--sm` |
| Text inputs | `.input`, `.input--lg`, `.input.is-invalid`, `.textarea`, `.field`, `.field__label`, `.field__hint`, `.field__error`, `.field__ok` |
| Badges | `.pill`, `.pill--accent`, `.banner`, `.banner--info`, `.banner--invite`, `.spinner`, `.ellipsis` (animated dots) |
| Overlays | `.overlay__card`, `.overlay__card--wide`, `.overlay__kicker`, `.overlay__title`, `.overlay__hint`, `.overlay__footer` (the podium uses these; a game's own in-screen overlay can too) |
| Player list | `.player-list`, `.player`, `.player--me`, `.player--offline`, `.player--guessed`, `.player__avatar`, `.player__badge`, `.player__badge--drawer`, `.player__badge--guessed`, `.player__rank`, `.player__name`, `.player__meta`, `.player__score`, `.player__turn-points` |
| Chat | `.chat`, `.chat__log`, `.chat__form`, `.chat__input`, `.chat__send`, `.chat-msg` with the kind modifiers `.chat-msg--system/guessed/correct/close/hint` (a plain `chat` line has no modifier rule) |
| Timer | `.timer`, `.timer--lg`, `.timer--md`, `.timer--urgent` |
| Sheets and toasts | `.sheet*`, `.menu-sheet*` (a phone options sheet: `.menu-sheet__row`, `.menu-sheet__label`, `.menu-sheet__leave`), `.toasts`, `.toast` with `.toast--success/warning/error` (an `info` toast uses the base style) |
| Header | `.site-header`, `.site-header__actions`, `.brand`, `.brand__mark`, `.brand__crumb`, `.conn-pill` |
| Misc | `.avatar--sm/md/lg/xl`, `.swatch`, `.emoji-choice`, `.code-input`, `.range`, `.toggle`, `.setting*`, `.podium*`, `.hide-mobile`, `.sr-only` |

Game-specific classes live in the game's stylesheet; Skribble's `skribble.css` owns `.word*`,
`.tile*`, `.guess-*`, `.toolbar*`, `.canvas-*`, `.rating*`, `.overlay` (its in-canvas overlay
position), and the whole `.game` layout, which is a good reference for a non-scrolling phone game.

### 8.3 Components and their props

| Component | Props | Notes |
| --- | --- | --- |
| [`SiteHeader`](../client/src/platform/components/SiteHeader.tsx) | `crumb?: string`, `children?`, `showConnection?: boolean` (default true) | Brand links to `/` (inside a room that leaves the room: any navigation away from `/:slug/:CODE` does); renders the connection pill and the sound/theme toggles; put a Leave button in `children` |
| [`Avatar`](../client/src/platform/components/Avatar.tsx) | `avatar`, `size?: 'sm' \| 'md' \| 'lg' \| 'xl'`, `dimmed?`, `className?` | Dim disconnected players |
| [`AvatarPicker`](../client/src/platform/components/AvatarPicker.tsx) | `value`, `onChange(next)`, `compact?` | Used by the game home and the lobby |
| [`CodeInput`](../client/src/platform/components/CodeInput.tsx) | `value`, `onChange(code)`, `onSubmit()`, `onInvalidChar()`, `disabled?`, `invalid?`, `autoFocus?` | The 4-box code field |
| [`PlayerList`](../client/src/platform/components/PlayerList.tsx) | `room`, `meId: string \| null`, `isHost`, `mode: 'lobby' \| 'game'`, `game: AnyGameClientModule \| null` | Game mode ranks by score and shows kick / vote-kick; pass `useActiveGame()` as `game` to get your badges |
| [`Chat`](../client/src/platform/components/Chat.tsx) | none | Reads the store; honours your `ChatInput` and `chatPlaceholder` |
| [`SettingsPanel`](../client/src/platform/components/SettingsPanel.tsx) | `room`, `isHost`, `game` | Platform rows then your `SettingsFields`; the lobby renders it |
| [`SettingRow`](../client/src/platform/components/SettingControls.tsx) | `label`, `value: string`, `testId`, `hint?`, `control?` | Test ids `settings-row-<id>`, `settings-value-<id>` |
| `RangeControl` | `id`, `value`, `min`, `max`, `step?`, `onCommit(v)`, `label`, `revision` | Debounced 150 ms; test id `settings-<id>` |
| `RangeSetting` | `RangeControl` props + `canEdit`, `display?`, `hint?`, `rowLabel?` | A row with the slider for editors and the value for everyone |
| `ToggleSetting` | `id`, `checked`, `onChange(checked)`, `label`, `disabled?`, `hint?` | Test ids `settings-row-<id>`, `settings-<id>` |
| [`Timer`](../client/src/platform/components/Timer.tsx) | `endsAt: number \| null \| undefined`, `warnUnder?` (10), `tickUnder?`, `size?: 'md' \| 'lg'` | Server-clock countdown; `tickUnder` plays a tick cue for the final seconds |
| [`BottomSheet`](../client/src/platform/components/BottomSheet.tsx) | `open`, `title`, `onClose()`, `children`, `testId` | Phone sheet with focus trap and Escape; `${testId}-close`, `${testId}-backdrop` |
| [`PodiumOverlay`](../client/src/platform/components/PodiumOverlay.tsx) | `room`, `isHost` | Rendered by the shell on `'ended'`; you never render it |
| [`Toasts`](../client/src/platform/components/Toasts.tsx), [`ConnectionPill`](../client/src/platform/components/ConnectionPill.tsx), [`ThemeToggle`](../client/src/platform/components/ThemeToggle.tsx) / `SoundToggle` | none | Toasts is rendered once by the shell; add toasts with `usePlatformStore.getState().addToast(kind, text)` |
| [`Icons`](../client/src/platform/components/Icons.tsx) | `Icon({ paths, size?, ...svg })` plus `DiceIcon`, `CrownIcon`, `CheckIcon`, `CopyIcon`, `LinkIcon`, `SunIcon`, `MoonIcon`, `SoundOnIcon`, `SoundOffIcon`, `CloseIcon`, `UsersIcon`, `ChevronIcon`, `ArrowRightIcon`, `LogoutIcon`, `PlayIcon`, `KickIcon`, `SparkIcon`, `EditIcon`, `SendIcon`, `MoreIcon`, `GamepadIcon` | Build game icons from the `Icon` primitive (24×24 stroke paths), as Skribble's [`Icons.tsx`](../client/src/games/skribble/components/Icons.tsx) does |

### 8.4 Mobile layout rules

- **Breakpoint 760px.** `@media (max-width: 760px)` is the phone layout everywhere; the lobby
  also collapses columns at 1100px. Width-check at 390×844 (portrait), 320×568 (small portrait),
  375×375 / 360×304 / 320×310 (keyboard open) and 844×390 (landscape); `e2e/mobile.spec.ts` runs
  Skribble through all of them.
- **`PHONE_QUERY`** in [`lib/media.ts`](../client/src/platform/lib/media.ts)
  (`(max-width: 760px), (min-aspect-ratio: 3/2) and (max-height: 520px)`) with
  `useMediaQuery(PHONE_QUERY)` decides between desktop columns and phone stacking in JS when CSS
  alone is not enough (Skribble swaps its players and chat columns for `BottomSheet`s).
- **Non-scrolling screens.** `useAppMode(isPhone)` from [`lib/useViewport.ts`](../client/src/platform/lib/useViewport.ts)
  puts `html.is-app` on the document (page never scrolls, `height: 100%`), and the shell publishes
  the visible viewport height as `--app-height` so a fixed layout sits above the on-screen
  keyboard. Scrolling screens like Click Race need neither.
- **Safe areas.** Pad the root with `env(safe-area-inset-*)` as `template.css` does.
- **Targets.** 44px minimum for anything tappable (the e2e specs assert it); inputs at `16px` or
  more (`base.css` enforces `max(1em, 16px)`) so iOS does not zoom.
- **Order and specificity.** Platform CSS is imported first by `main.tsx`; a game stylesheet is
  imported by its module. Overriding a platform class inside a media query needs your root class
  in front (`.game .timer--lg` in Skribble), otherwise the result depends on bundle order.
- `prefers-reduced-motion` is honoured globally in `base.css`; `touch-action: manipulation` on
  buttons removes the double-tap delay.

### 8.5 Sound, haptics, formatting

- [`lib/sound.ts`](../client/src/platform/lib/sound.ts): `playCue('correct' | 'yourTurn' | 'tick' | 'turnEnd')`, silent when the user muted sound.
- [`lib/haptics.ts`](../client/src/platform/lib/haptics.ts): `vibrate(ms)`.
- [`lib/format.ts`](../client/src/platform/lib/format.ts): `formatSeconds`, `formatPoints` (+N), `plural`, `ordinal`, `friendlyError`.
- [`lib/useCountdown.ts`](../client/src/platform/lib/useCountdown.ts): `useCountdown(endsAt)` (ms) and `useCountdownSeconds(endsAt)` on the server clock; `remainingMs(endsAt, clockOffset)` for non-hook code.
- [`lib/clipboard.ts`](../client/src/platform/lib/clipboard.ts): `copyText(text)`.

---

## 9. Platform APIs a game may call

From [`client/src/platform/net/socket.ts`](../client/src/platform/net/socket.ts) and
[`net/actions.ts`](../client/src/platform/net/actions.ts):

```ts
socket.send(msg: PlatformClientMessage | WireMessage): boolean;   // false when the socket is closed
socket.isOpen(): boolean;
leaveRoom(); sendChat(text); updateSettings(patch); startGame(); kickPlayer(id); voteKick(id); returnToLobby();
```

From [`store/usePlatformStore.ts`](../client/src/platform/store/usePlatformStore.ts) and
[`store/selectors.ts`](../client/src/platform/store/selectors.ts):

```ts
usePlatformStore((s) => s.room)        // RoomState | null (cast to your RoomState<V,S> inside your module, as Skribble's hooks.ts does)
usePlatformStore((s) => s.playerId)    // string | null
usePlatformStore((s) => s.connection)  // 'connecting' | 'connected' | 'reconnecting'
usePlatformStore((s) => s.clockOffset) // serverTime - Date.now()
usePlatformStore.getState().addToast('info' | 'success' | 'warning' | 'error', text)
selectMe, selectIsHost, playerName(room, id), activeGame(), useActiveGame()
```

Read `room.players` for names, avatars, scores and connection state; read `room.game` for your
view; read `room.settings.<field>` for settings. Do not write to the platform store.

---

## 10. Verification checklist

Run from the repository root; everything is green at HEAD.

1. `npm run typecheck`: strict TypeScript for server (`server/tsconfig.json`, which includes
   `shared/` and `api/`) and client (`client/tsconfig.json`). No `any`, no `@ts-ignore`, no
   `@ts-expect-error`.
2. `npm test` (vitest, 39 files / 303 tests today). Automatically covers your game through
   `GAME_IDS`: registry metadata and settings schemas (`server/games/registry.test.ts`),
   determinism and non-mutation (`engine/determinism.test.ts`), purity and import boundaries
   (`engine/purity.test.ts`), the whole platform room behaviour
   (`drivers/room.platform.test.ts`), `.js` import extensions (`server/imports.test.ts`), the
   library slug rules (`shared/platform/games.test.ts`). These `describe.each(GAME_IDS)` suites
   grow by about 45 tests per game, so expect the total to jump. Add your own
   `server/games/<id>/<id>.test.ts` and `client/src/games/<id>/<id>.test.ts`. The Redis driver
   tests spawn a local `redis-server` and are skipped when it is not installed.
3. `npm run build`: Vite client to `dist/client`, esbuild server to `dist/server/index.js`.
4. `npm run test:e2e` (Playwright, 41 tests today): builds if `dist/server/index.js` is missing,
   starts the in-memory server on 4173 and, for `multi-instance.spec.ts`, a throw-away Redis with
   two instances on 4181/4182. `PW_BASE_URL=http://localhost:PORT` points the specs at a server
   you already run (the config still launches the Redis cluster, even for a single spec; it needs
   `redis-server` on the PATH). `npx playwright test e2e/<id>.spec.ts` runs one spec. CI
   (`.github/workflows/ci.yml`) installs Chromium with `npx playwright install --with-deps chromium`.
5. Phone viewport: add at least one e2e check for your screen at 390×844 (`isMobile`, `hasTouch`)
   asserting no horizontal overflow (`document.documentElement.scrollWidth <= 390`) and 44px
   targets, as `library.spec.ts` does for the library and `mobile.spec.ts` for Skribble.
6. Manual pass: two browser tabs (or a phone on the same network via `npm run dev`), reload one
   mid-game (the seat survives, the view comes back from the snapshot and `welcome.extra`), let a
   player leave mid-game, join mid-game with the code, kick someone, finish a game and return to
   the lobby, and one run with `REDIS_URL` pointing at a local Redis.
7. Hygiene: no `Date.now` / `Math.random` / timers in `server/games/<id>/`, `.js` extensions on
   relative imports in `shared/` and `server/`, comments only where the logic is not obvious,
   small modules.

---

## 11. Gotchas

- **Slugs and codes share the URL.** A slug of exactly 4 characters would be parsed as a room
  code; the registry test refuses it.
- **Codes are one namespace across games.** A code typed on Skribble's home can belong to a
  Click Race room; the preview says so and joining it enters that game. Don't assume the game from
  the URL before the room arrives; `room.gameId` is the truth.
- **`room.game` is `null` in the lobby** and your `Screen` is not mounted then. `PlayerList`,
  `Chat` and the settings hooks guard on it.
- **`score` does not snapshot.** Follow it with `{ type: 'snapshot', to: 'all' }` unless the same
  effect list ends the game.
- **Effects after `abort` are dropped**, and `gameOver` is ignored unless the room is `'playing'`.
- **Scores reset to 0** on `start` and on every return to the lobby; the podium is the only
  record of a finished game.
- **Settings patches** are validated as a whole: one invalid field rejects the patch with
  `INVALID_MESSAGE` ("Invalid settings at <path>: <message>"); unknown keys are stripped; your
  `normalize` runs on the merged settings and may rewrite dependent fields; `maxPlayers` is then
  clamped to `[meta.minPlayers, meta.maxPlayers]` and never below the seated count.
- **Chat history** is capped at 60 lines and replayed in `welcome.chat`; private lines (explicit
  recipient lists) are never stored, so a late joiner does not see them.
- **`playerJoined` arrives mid-game only** (joins in the lobby are not game events) and only when
  `allowMidGameJoin` is on; `ctx.players` already contains the newcomer.
- **Rate limits**: 60 game messages per second per socket are accepted, the rest dropped
  silently; chat is 6 per 4 s with a `RATE_LIMITED` error; room create/join 5 per 10 s.
- **Message size**: 64 KB per WebSocket frame (`MAX_WS_MESSAGE_BYTES`).
- **`welcome.extra` is `undefined`** without a side store; `onWelcome` still fires.
- **Document titles** are the platform's: "Bored Games" (library), "<Game> · Bored Games" (game
  home), "<Game> · room CODE" (in a room).
- **Storage keys** (`boredgames.name`, `boredgames.avatar`, `boredgames.prefs`, session
  `boredgames.session`) belong to the platform; a game that needs to remember something per device
  uses its own prefixed key and wraps every access in try/catch like
  [`lib/storage.ts`](../client/src/platform/lib/storage.ts).
- **Negative scores** are legal (`{ type: 'score', delta: -50 }`) and shown as `-50 pts`; clamp in
  your reducer if the game should never go below zero.
- **`renderToString` and text**: adjacent JSX text nodes come out separated by `<!-- -->`, so
  assert on attributes in unit tests (or build the string with a template literal); Playwright's
  `toHaveText` is unaffected.
- **Static assets per game** (pictures, sounds) live under the game's client folder and are
  loaded with `import.meta.glob` so a dropped-in file needs no code change: The Spy Game's
  [`images.ts`](../client/src/games/spygame/images.ts) globs `assets/locations/*.{jpg,jpeg,png,webp,svg}`
  and prefers a photo over the generated svg (`scripts/spygame-location-images.mjs` writes those).
  Small files are inlined by Vite; keep photos a few hundred kilobytes at most.
- **Cross-game records**: the only `Record<GameId, ...>` outside the registries is
  `server/games/testFixtures.ts`; if `npm run typecheck` names another one after you add an id,
  that file is a bug in the platform, not a step you missed.
- **Vercel**: nothing per game. `api/server.ts` bundles whatever the registries import; keep the
  `.js` extensions and the deploy keeps working.
