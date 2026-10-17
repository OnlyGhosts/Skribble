# Adding a game to boredgames.io

This is the owner's guide to adding the next game. It is written against the code as it is: every
file it names exists, every interface it quotes is the real one, and the template game's code is
embedded verbatim from the repository so you can copy it line for line.

The one-sentence model: **a game is a pure reducer on the server plus a React screen on the
client; the platform owns everything else.** Rooms, codes, seats, tokens, reconnects, the host,
the lobby, settings, notices, scores, the end of a game and its results, kicks, Redis, routing, the lobby's game picker and the
design system are already built. You write what happens *inside* a running game.

Contents

1. [Where a game lives](#1-where-a-game-lives)
2. [What the platform already provides](#2-what-the-platform-already-provides)
3. [The contract](#3-the-contract)
4. [Pure-reducer rules](#4-pure-reducer-rules)
5. [The recipe, step by step](#5-the-recipe-step-by-step)
6. [The template game, in full](#6-the-template-game-in-full)
7. [Advanced: side stores (how Scribble streams drawing)](#7-advanced-side-stores-how-scribble-streams-drawing)
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
Race, the hidden copy base) and [`scribble`](../server/games/scribble/module.ts) (the full-size
game with the advanced side-store path).

The drawing game's id is now `'scribble'`, like its name, its `/scribble/` links, its folders, CSS
classes and test ids. Before the rename it was `'skribble'`, and that id is still accepted wherever it
can come from: a client loaded before the deploy may send it (`gameIdSchema` reads it as
`'scribble'`), a room stored in Redis may carry it (`upgradeRoomData` loads it as `'scribble'`), a
saved session may name it, and old `/skribble/` and `?game=skribble` links redirect. Renaming a game
works the same way: list its old id in `formerIds` and its old slug in `formerSlugs` in its `GameMeta`
([`shared/platform/games.ts`](../shared/platform/games.ts)), and `upgradeGameId` does the rest.

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

**Parties, lobby and settings.** A room is a party: it outlives any one game. The host picks the
game in the lobby (`selectGame`; the game settings reset to the new game's defaults, the platform
settings and everyone's ready flags carry over, a system line says "Host switched the party to
<game>"), everyone readies up (`ready`) or sits the next game out (`sitOut`, which clears ready
and persists until the player changes it; both accepted in the lobby only), and the
host starts. The lobby screen (only the host sees the settings and the game grid; everyone else
sees the next game, the players and their own buttons), the room header at its top (one bar: the logo, the code, Copy
and Share; Copy invite link and Leave room in the gear menu; a phone centres the logo over the
code card), the footer with Start or I'm ready, Sit this one out and Change my look pinned
to the bottom of the screen at every size (its line spans the page), each player row's kick button
last, after the status, in a 44px column that lines up down the list, the profile editor (a centred
box on a desktop, a drawer on a tablet or phone), the browser tab's title in a room
("boredgames.io 🚪 𝗔𝗕𝟮𝟯": the door and the code in Mathematical Sans-Serif Bold, `roomTitle` in
[`lib/tabTitle.ts`](../client/src/platform/lib/tabTitle.ts)), the platform setting `contentMode` (`'family' |
'unhinged'`, [`shared/platform/settings.ts`](../shared/platform/settings.ts)), validation of
settings patches (platform schema merged with your game's `patchSchema`), the start rule, scores
reset to 0 on start, the host's End game (`endGame`) and the way back to the lobby with the
results after a game ends are all in [`server/platform/engine/lobby.ts`](../server/platform/engine/lobby.ts).

**Who plays.** `start` needs at least `meta.minPlayers` *ready* players: connected, `ready` and
not `sittingOut` (the host counts as ready by pressing start unless they sit out). Every ready
player becomes a participant, a readied player whose socket happens to be down at that moment
included (they are in reconnect grace, so the game holds for them like for any participant; only
connected ones count towards the minimum, so a game never starts straight into a hold). Everyone
else stays seated in the party as a spectator ("Carol and Dave sit this one out"). A game with a seat limit (`meta.maxPlayers`, `null` for no limit) takes the
first ready players by join order and benches the rest with a line. Every `ready` flag resets
when the game starts. A newcomer who joins while a game runs is let into the party but watches
it as a spectator and plays from the next game on; your module never hears of them (there is no
join event), so the set of participants never grows during a game. A player already in the game
who reconnects (or reloads, or opens a second tab on the same seat) keeps their seat.
`PlayerPublic` carries `ready`, `sittingOut` and `participating` so the client can render all of
this; your module only ever sees the participants (`GameCtx.players`) and, separately, the
spectators (`GameCtx.spectators`). Spectators get snapshots and chat, but their game messages are
refused with `NOT_ALLOWED` before your module sees them, and they neither vote-kick nor count
towards a vote-kick majority while a game runs. The one exception is the host's own controls: a
module lists the message types the host may send while sitting out in `hostMessages` (Spy Game:
`nextRound`, Quip Game: `next`, Poker: `next`, Blackjack: `dealNow` and `skip`, which the players
may also send while the table waits on the host; End game is the platform's `endGame`, which the
host sends whether they play or not), and
those reach `handle` whoever the host is (so a game names a host who watches from
`GameCtx.spectators` too). Only the room's cap (`ROOM_HARD_CAP`) turns a newcomer away, mid-game
or not; the front door's preview says a running game can be joined to watch. A room stored with
the retired `allowMidGameJoin` switch loads and ignores it.

**Content modes.** `settings.contentMode` is the room's single switch for what the packs contain:
`family` is clean, `unhinged` is adults only (it plays the rude-but-harmless "cheeky" tiers and the
explicit "unhinged" ones together, and never the clean family pack; there is no middle mode, and a
room stored with the retired `'cheeky'` mode loads as `family`). The unhinged tiers are written at
party-card level: explicit sex, drink and drugs, bodily fluids, death and family shame, British
wording. The hard lines hold for every tier: no slurs, no jokes aimed at a group (race, ethnicity,
nationality, religion, disability, sexuality, gender identity), nothing sexual involving anyone
under 18, no real private people. A game that reads it sets `contentModes: true` in its
`GameMeta`, which is what makes the lobby offer the choice (Scribble, The Spy Game and Quip Game
do; for the others the setting is hidden but kept). Such a game reads it from
`ctx.settings.contentMode` and picks its content with a shared pure helper: Quip Game's prompt
tiers (`promptsForContentMode` in
[`shared/games/quipgame/prompts.ts`](../shared/games/quipgame/prompts.ts): family = clean,
unhinged = cheeky + unhinged), Scribble's words (`wordPoolForMode` /
`buildWordPool(lang, custom, customOnly, mode)` in
[`shared/games/scribble/words/index.ts`](../shared/games/scribble/words/index.ts): family = the
language list, unhinged = the cheeky and unhinged word tiers only, custom words merged into either;
any word game may reuse it) and The Spy Game's locations (`locationsForMode` in
[`shared/games/spygame/locations.ts`](../shared/games/spygame/locations.ts): family = the family
pack, unhinged = the cheeky and unhinged tiers in `locationTiers.ts` only, with generated tiles for
every tier). An Unhinged pool must be big enough on its own: tests hold Scribble's adult words to
at least 480 (so a long game keeps offering fresh choices) and the Spy Game's adult places to at
least 70 (a round shows 24), and keep the family and adult packs disjoint (Spy names compared
letters only, Scribble words with plurals and spacing folded). A game never ships its own content
switch; it reads the room's mode.

**Chat lines, without a chat.** There is no general chat on screen anywhere.
The wire still carries chat lines, because typed input can be a game's mechanic: Scribble's
guesses travel as chat lines, and its guess feed lists them. The platform keeps rate limiting (6
lines per 4 s per socket, in [`server/platform/connection.ts`](../server/platform/connection.ts)),
history for late joiners (`CHAT_HISTORY_LENGTH` = 60) and system lines for joins, leaves, kicks,
start and game over (Scribble's feed shows the ones from its own game). Every chat line is offered
to the running game first (a `'chat'` event) so a game can treat it as input. An event a player
needs to know about and the screen does not show (a new host, a vote-kick tally, "Not enough
players"; Blackjack's "Pia is away and stands.", Poker's "Blinds up", The Spy
Game's failed vote) goes out as a `'notice'` line: every client shows it as a toast.

**Scores and the end of a game.** Players carry a `score`; your game adds to it with `score`
effects. However a game ends (it finishes on its own with `gameOver`, the host's End game, or too
few players are left: a leave, a kick, a seat expiry or an `abort`), the platform ranks the
participants (ties share a rank) into `RoomState.results` (`{ id, gameId, reason, entries }`, each
entry with the player's name and avatar so it reads right after they leave; `reason` is
`'finished'`, `'host'` or `'players'`), sends a system line naming the winner (none when too few
were left) and takes the room straight back to `phase: 'lobby'`: nobody is held on a podium. Every
phone that took part or watched the game end shows the `ResultsPopup` over the lobby once
(a reload or a reconnect still shows it until closed; a newcomer never sees it); closing it (Back
to the room, the X, Escape, a tap beside it on a desktop) leaves the player in the lobby. The
results stay in the lobby until the next game starts. A room stored on the retired `'ended'` phase
loads as a lobby carrying its podium as the results.

**End game and Leave room.** Every game's top bar and options sheet carry them; a game adds
nothing. The host's End game (the platform message `endGame`, host only, while playing; behind a
confirm step that says what happens) ends the game for everyone at once, on the scores so far, or
at the game's own next boundary when its module has an `end` hook (Blackjack finishes the hand in
play; `RoomState.endRequested` is true meanwhile and the button reads "Ending soon"). Leave room
(behind its confirm step) takes out only the player who leaves; the game goes on for everyone
else (`playerLeft`) unless too few are left, when it ends with the results. The leaving player
lands on the front door.

**Kicks and vote-kicks.** Host kick, majority vote-kick (a majority of the other connected
players in the game, at least two of them, never a single voter; in the lobby every connected
player counts), kicked tokens refused on rejoin. Joins are refused only at the room's hard cap
(`ROOM_HARD_CAP` = 50 seats, players in reconnect grace included); games never cap the party.

**Low-player handling.** A running game is sent back to the lobby only when fewer *participating
seats* than `meta.minPlayers` remain: on a leave, a kick or a reconnect-grace expiry (a spectator
leaving changes nothing). A dropped socket never
ends a game; the player keeps their seat for the grace and your game decides what to do
meanwhile. A game that cannot go on without them holds at its next boundary and says so with a
`waiting` effect, which the platform shows as `RoomState.waiting` (the client's waiting overlay
names the missing players and lets the host remove them).

**Time.** A deadline-driven tick: you return epoch-ms deadlines from `nextDeadline(data)`, the
driver arms one timer at the earliest platform-or-game deadline and calls your `handle` with
`{ type: 'tick' }` when it is due. No timers in game code, ever.

**Restarts.** A deploy or a crash restarts the server, and a few phones of every room hold a sealed
copy of it (a checkpoint) to bring it back. Your `D` travels in it as it is, so a game survives a
restart for free as long as its times are epoch ms: on the way back every number in `D` within 30
days of the checkpoint moves on by the downtime, so no clock loses time to it, while durations
(a paused clock's remaining ms), chips and counts stay put. Two optional hooks: `milestone(data)`
names where the game stands (phase, round, turn) so a change sends a fresh checkpoint at once,
and `restored(ctx, data)` lets a game whose side store held part of the state restart that part
(the store comes back empty; Scribble restarts the turn in progress).

**Multi-instance Redis.** Rooms, presence and side stores live in Redis when `REDIS_URL` is set;
actions are applied with compare-and-set Lua scripts and effects fan out over pub/sub. Because
your module is a pure function of JSON-safe data, it works on the memory driver and on Redis
without knowing which one runs it.

**Routing and the game picker.** `/` is the front door: join a room with the four code boxes or
create one; there is no game catalogue on it and no visible heading ("Join a room" names the boxes
for screen readers only). `/:slug/:CODE` is the join link and the in-room URL,
the legacy `/:CODE` and `/?room=CODE` open the front door with the boxes filled, `/:slug` alone
redirects to `/`, and `/?game=slug` makes Create start the party on that game (the way to reach a
hidden game) ([`client/src/platform/router.ts`](../client/src/platform/router.ts)). A new party
starts on the first live game of `GAME_LIST`; the host picks any other live game from the
picker at the top of the lobby ([`GamePicker`](../client/src/platform/components/GamePicker.tsx)),
which is rendered from `GameMeta` the moment `status` is `'live'`.

**Transport.** The one WebSocket with backoff reconnect, ping/pong clock sync (`clockOffset`),
seat persistence in `sessionStorage`, a 60-messages-per-second cap on game messages per socket
(excess is dropped silently) ([`client/src/platform/net/socket.ts`](../client/src/platform/net/socket.ts)).
The site has one connection notice
([`ConnectionNotice`](../client/src/platform/components/ConnectionNotice.tsx), driven by
[`lib/connectionNotice.ts`](../client/src/platform/lib/connectionNotice.ts)): a card at the top
centre of every screen that comes up only once the link has been gone for `NOTICE_DELAY_MS` (2 s),
says plainly what is happening ("Reconnecting…", with "Your place in the room is kept." in a room)
and goes the moment the link is back. There is no header pill, banner or connection toast besides
it, and while it shows the waiting overlay steps aside (its list of who is missing is stale then).
A game never draws its own.

**Design system and mobile rules.** Tokens, cards, buttons, inputs, pills, sheets, toasts, the
timer, the player list, the code input, avatars, light/dark themes, the phone layout
helpers. Section 8 lists them.

**Playing cards.** A standard deck lives in [`shared/platform/cards.ts`](../shared/platform/cards.ts):
`Card` / `CardRank` / `CardSuit`, `CARD_RANKS` / `CARD_SUITS`, `freshDeck(decks)`, `shuffle(cards, rng)`
(Fisher-Yates over a copy, every index from the injected rng) and `cardOf('10H')` for tests and
fixtures. Blackjack's deck and Poker's both come from it (Blackjack's is endless, an infinite
shoe: `drawCard(rng)` in [`shared/games/blackjack/cards.ts`](../shared/games/blackjack/cards.ts)
picks every card on its own, uniformly from the 52, with one call to the injected rng, so it never
runs out, never needs a reshuffle and has no decks setting; its tests script `ctx.rng` to deal
exact cards. Pairs split, and re-split, with no cap while the chips last; Poker deals
from one deck with no burn cards, so its table seats 23, two hole cards each and five on the board,
and anyone beyond that, ready at the start or joining later, watches, `waitingForSeat` in their view,
until a seat frees up, first come first seated: the module sets `queuesSeats`, so the platform makes
every ready player a participant and Poker's queue seats them; `ranks` keeps a player who never got
a seat out of the results). On the client the cards are drawn by
[`PlayingCard`](../client/src/platform/components/PlayingCard.tsx) (`sm` / `md` / `lg` / `xl`; a face is a
big bold rank at the top left with one big suit under it; `null` is face down, every back the
boredgames back drawn in `cards.css`: a cream border, a lime field with a fine ink lattice and the
two phones on an ink medallion, point-symmetric; `slot` for an empty place, `highlight` for the
five that play) and chip counts by
[`Chips`](../client/src/platform/components/Chips.tsx) (`ChipIcon`, `formatChips` in `lib/format.ts`);
a chip amount setting with presets and a numeric field is
[`ChipsSetting`](../client/src/platform/components/ChipsSetting.tsx). Their styles are the platform's
`cards.css`. Poker's hand rankings (`evaluateBest`, `compareHands`, `handName`) are in
[`shared/games/poker/hands.ts`](../shared/games/poker/hands.ts).

**Card tables.** A Stake-style card table is a kit in
[`client/src/platform/table/`](../client/src/platform/table) (styles: the platform's `table.css`, `.tbl*`),
used by Blackjack and Poker: `TableShell` (the top bar in one row at every size: the game's name,
the players button with the count, End game and the gear on a desktop, the options button on a
phone; no round or phase in it, those are on the table; then the table, and the control panel
docked under the table on a phone and a portrait tablet, in a left column on a desktop, plus the
players and options sheets). Both lay their felt out as a calm table that never scrolls
(`.tbl-felt.tbl-felt--calm`, four grid rows): the game's centre piece big at the top centre
(Blackjack's dealer with the word Dealer centred over its first two cards, Poker's pot over the
board), `TableRibbon` across the middle (a low-contrast banner with folded ends carrying the
table's rule in plain words, the round or hand beside a smaller rule or the street under it,
"Round 1 · Dealer stands on 17", "Hand 1 · Flop", and a `note`, the `TurnLine`: the one line on
the table that says what is happening, whose turn it is or where I stand, a quieter second part
and, in Poker, the turn clock; read out as it changes), the other players as compact seats, and a
`TableStage` at the bottom with the hand that matters to me, big and centred, nothing in columns
beside it. The first row sits at the top edge and the stage at the bottom; the seats ask for no
more height than their tiles need at their natural size (`naturalHeight` in `grid.ts`), and what
is left is shared evenly between the rows, so the ribbon and the seats keep one rhythm. The first
row and the stage have a fixed height (`--tbl-head-h`, `--tbl-stage-h`) and their cards a fixed
size that the game works out from the room its table has (`cq` units of the `tbl` container on
`.tbl__table`, registered with `@property` as lengths so they are worked out once on the table),
never from the phase or the number of players. My own hand is on the stage whenever I am dealt
in, in every phase and on every turn, my stake by its total ("Bet 10"); the player on turn plays in
their own seat (lit, and nowhere else). Not dealt in (watching, sitting out, out of chips), the
stage shows the hand in play with its owner's name by its total, and that seat leaves its cards to
the stage (`stageOwner` in each game's `lib/focus.ts`). [`lib/hands.ts`](../client/src/games/blackjack/lib/hands.ts)
decides when Blackjack's split hands fold into chips, the hand in play staying full size, every
full hand at least as wide as the words over its corner (measured as the row lays out), and,
never narrower than a two-digit total, past what fits into one "+N" that opens the seat's sheet
with every hand. Poker's stage holds my two cards whenever I hold some (the hand in play when I am
not dealt in), with what they make in the pill and, left of it, the dealer button, my bet and where
I stand ("All in", "Folded"), or how the hand ended ("Win +300"). The shared pieces: `HandFan` / `OutcomeFlag` (a hand as a stepped fan, each card a
little right of and below the one before, the total in a pill over its top right corner; one
height however many cards; an outcome outlines every card and colours the pill, its word beside the
pill; `flag` carries whatever sits left of the pill: the outcome, the stake, the owner's name),
`StackCount` / `StakePill` in `Stakes.tsx` with `stakes.ts` (a stack always reads "1,000
chips", a stake always its own labelled pill, "Bet 10" or "Pot 120", so the two are never
confused), `Deck` (with `corner`: wholly on the felt in its top right corner, inside the felt's
padding, the count said rather than shown) and `DiscardCorner` (the anchor cards fly to, just past
the top left corner), `TurnLine`, `TableStage`, `PlayersGrid` / `PlayerTile` / `SeatSheet` (every other player as a tile in seat order
in a grid that fits its space: [`grid.ts`](../client/src/platform/table/grid.ts) picks the tier
(full, compact, small, dense) from the room the table leaves the seats, the richest whose fewest
rows keep the tile's least height (`tierFor`: a desktop keeps the cards in miniature in the seats
for seven others across, a phone steps down to compact for four), fits the columns to the room
left, never narrower than the tier's `minWidth` so names and totals stay whole (a narrow full tile
gives its name, stack, bet and cards a row each; a narrow small tile wears its total as a badge on
its corner), keeps a full tile to its top rows before the deal (`bare`), and a desktop sets them on
a gentle arc that flattens as the tiles get smaller and a size up on a big screen
(`--tbl-tile-font`); a tile shows the stack and the
stake with `StackCount` and `StakePill` wherever it has the room, and with `shortBadge` its total
stands in for the stack only where the tile is too short for the words (Poker's); the seat on turn gets the lime ring (and the Playing tag where it fits),
a settled seat its outcome's colour, and tapping a tile opens its hand in a sheet),
`PanelShell` / `PanelLabelRow` / `AmountField` / `PanelMoves` / `MoveButton` / `TableButton` (the control panel:
no status line and no shortcut hint, whose turn it is lives on the table; the amount with the
stack beside its label (`anchor` marks the stack as where Poker's chips fly from and back to) and
its quick amounts ("½", "2x", "Max"; "½ pot", "Pot", "Max") in a segmented row under the field on
a desktop, joined to its right on a phone, the figure never cut (seven digits fit at 320px); the
moves always in place (`PanelMoves` with their `count`: two to a row, three in one row, every
one in a single row on a phone; then one big primary button, Blackjack's Bet and Poker's Check or
Call), each with a small `icon` after its label, dimmed when not on offer and
`primary` on the one the game suggests; then `actions`, the table's own full-width secondary
buttons (`TableButton`: Blackjack's Sit out, Deal now and Skip) in a row that keeps its place, Sit
out dimmed when none is on offer; on the shortest phones that row shares the main button's row),
`TotalPill` / `PayoutFloat` / `outlineClass` (the outcome colours),
`TableCard` (a card that slides in from the deck, turns over and leaves for the discards),
`ChipFlights` (chips sliding between `data-table-anchor` places) and `useHotkeys` in
[`lib/hotkeys.ts`](../client/src/platform/lib/hotkeys.ts) (desktop shortcuts that never fire while
typing). The animations run off a timeline planned from two snapshots
([`table/timeline.ts`](../client/src/platform/table/timeline.ts): `beginPlan` / `finishPlan` in the
game's own planner, then `cardShown`, `faceDown`, `departure`, `valueAt`, `flightsAt`, `frameAt`...
to draw it); a welcome (`createEntryFlag`), reduced motion or a backlog over three seconds shows
the truth at once. Blackjack's [`lib/timeline.ts`](../client/src/games/blackjack/lib/timeline.ts) and
Poker's [`lib/timeline.ts`](../client/src/games/poker/lib/timeline.ts) are the two planners. A
planner keeps a whole deal under that backlog however big the table (Blackjack's pace lives in
[`shared/games/blackjack/deal.ts`](../shared/games/blackjack/deal.ts), whose `dealAllowanceMs` the
tests keep under it; Poker's `reveal.ts` adds its showdown's length to the next clock),
and a game's sound schedule is cleared when a plan snaps, so no stale card sound plays after it.

---

## 3. The contract

### 3.1 Registry: `GameMeta`

[`shared/platform/games.ts`](../shared/platform/games.ts)

```ts
export type GameId = 'scribble' | 'template';
export type GameStatus = 'live' | 'soon' | 'hidden';

export interface GameMeta {
  id: GameId;
  /** URL segment. Lowercase letters only and never 4 characters long, so it can never collide with a room code. */
  slug: string;
  name: string;
  howToPlay: string[];
  minPlayers: number;
  /** Seats the game can hold at once, or null when any number may play. Extra players sit a game out and stay in the party. */
  maxPlayers: number | null;
  /** Slugs the game used before a rename: old links on them redirect to `slug`. */
  formerSlugs?: readonly string[];
  /** Ids the game had before a rename: old clients, stored rooms and saved sessions read as `id` (`upgradeGameId`). */
  formerIds?: readonly string[];
  /** The game's 24px line glyph: SVG path data for a 24x24 viewBox, drawn with a 1.8px round stroke in currentColor. */
  glyph: string;
  /** Accent colour (#rrggbb), the same as `--game-<id>` in tokens.css: icon plates and decorations, always with ink on top. */
  accent: string;
  /** Whether the game reads `settings.contentMode`; the lobby only offers Family / Unhinged for these. */
  contentModes: boolean;
  /** What a score counts: 'points' (when absent) or 'chips' for a card table, whose score is the stack. The results and the player list say it. */
  scoreUnit?: 'points' | 'chips';
  /** 'hidden' games are never offered in the lobby picker but a party can start on one through '/?game=slug' (development, tests). */
  status: GameStatus;
}

export const GAME_LIST: readonly GameMeta[] = [ /* picker order; the first live game is the one a new party starts on */ ];
export function gameById(id: GameId): GameMeta;            // throws on an unknown id
export function gameBySlug(slug: string): GameMeta | undefined;
export function isGameSlug(s: string): boolean;
export function isGameId(s: string): s is GameId;
export const GAME_IDS: readonly GameId[];
```

`status` drives the lobby's game picker: `'live'` games are tiles the host can switch the party
to; `'soon'` and `'hidden'` games are not offered (a hidden game is only reachable by creating the
party through `/?game=<slug>`, which is how Click Race ships for its tests; the picker still shows
it as the current game then). [`shared/platform/games.test.ts`](../shared/platform/games.test.ts)
checks every entry: lowercase-letter slug, never 4 characters, unique id and slug, a non-empty
name/howToPlay, path-data `glyph`, a boolean `contentModes`, a `#rrggbb` accent, `1 <= minPlayers` (and `minPlayers <= maxPlayers` when a
limit is set; `seatLimit(meta)` in `settings.ts` turns `null` into the room's hard cap), and that
`gameIdSchema` in `protocol.ts` lists every id.

### 3.2 Shared protocol: what crosses the wire

Platform messages are flat and fixed ([`shared/platform/protocol.ts`](../shared/platform/protocol.ts)):

- client to server: `create { gameId, name, avatar }`, `join { code, name, avatar }`,
  `rejoin { code, token }`, `leave`, `ping`, `updateSettings { settings }` (one flat patch of
  platform and game fields), `updateProfile { name?, avatar? }`, `selectGame { gameId }` (host,
  lobby only), `ready { ready }` and `sitOut { sitOut }` (lobby only), `start`,
  `chat { text }`, `kick { playerId }`, `voteKick { playerId }`, `endGame` (host only, while
  playing; a second tap, or one after the end, changes nothing).
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
  settings: PlatformSettings & S;   // flat: { contentMode, ...your fields }
  players: PlayerPublic[];          // { id, name, avatar, score, isHost, connected, joinOrder, ready, sittingOut, participating }
  phase: 'lobby' | 'playing';
  results: GameResults | null;      // the last game's standings, in the lobby until the next start
  endRequested: boolean;            // the host's End game waits for the game's next boundary
  game: V | null;                   // your view; null in the lobby
  serverTime: number;
}
```

Anything game-specific about a player (Scribble: `guessedThisTurn`, `turnPoints`) lives inside
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
export interface PlatformPlayer {
  id: string; name: string; joinOrder: number;
  /** The socket is up, or dropped too recently (AWAY_NOTICE_MS) for the game to have heard of it. */
  connected: boolean;
  /** Connected, but silent for IDLE_AFTER_MS (asleep, frozen, in the background). Absent means false. */
  idle?: boolean;
  score: number;
}

/** A seated player who sits this game out (or has not readied up): in the room, never in the game. */
export interface PlatformSpectator { id: string; name: string; connected: boolean; }

/** Identity and randomness are injected so the reducer is deterministic. */
export interface GameCtx<S> {
  /** Epoch ms: the real clock, or the deadline being processed while a tick catches up. */
  now: number;
  /** Uniform in [0, 1). */
  rng: () => number;
  /** Fresh unique id. */
  newId: () => string;
  /** The game's settings, flat next to the platform's (contentMode picks the content packs). */
  settings: RoomSettings<S>;                 // PlatformSettings & S
  /** Every participating seated player (connected or in reconnect grace), in join order. */
  players: PlatformPlayer[];
  /** The other seated players: spectators who sat this game out. They get snapshots and chat but never play. */
  spectators: PlatformSpectator[];
  hostId: string;
}

export interface GameViewCtx<S> { settings: RoomSettings<S>; players: PlatformPlayer[]; spectators: PlatformSpectator[]; hostId: string; now: number; }

export type GameEvent<CMsg> =
  /** A validated game message from a participating, connected player (only while the room is 'playing'). */
  | { type: 'message'; playerId: string; msg: CMsg }
  /** A chat line; the game may consume it (a guess) by returning a 'chatHandled' effect. */
  | { type: 'chat'; playerId: string; text: string }
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
   * A drop is reported AWAY_NOTICE_MS after it happens, and not at all when the player is back
   * by then (nor is that return reported).
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
  /** The game is over: the platform ranks the players and takes the room back to the lobby with the results. */
  | { type: 'gameOver' }
  /** The game cannot go on (too few players): the results on the scores so far, `reason` a system line. */
  | { type: 'abort'; reason: string }
  /**
   * The game is holding at a boundary until the players in `missing` (seated, disconnected) come
   * back; the platform shows it as RoomState.waiting. Emit it again when the list changes and
   * `null` when the game goes on; abort, gameOver and the lobby clear it by themselves. `until`
   * (epoch ms): when the game stops waiting and goes on without them (shown as a countdown).
   */
  | { type: 'waiting'; missing: string[] | null; until?: number }
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
  /** Message types (`msg.t`) the host may send even while sitting the game out, such as "next round" or "end game". */
  hostMessages?: ReadonlySet<string>;
  /** The game seats `meta.maxPlayers` at a time itself and queues the rest in join order: every ready player starts as a participant. */
  queuesSeats?: boolean;
  /** Whether a participant goes in the results (a queued player who never got a seat does not). Everyone by default. */
  ranks?(data: D, playerId: string): boolean;
  /**
   * The host's End game: emit the last score effects and `gameOver` to end at once, or note it and
   * end at the game's own next boundary (Blackjack). Without it the platform ends the game at once
   * on the scores as they stand.
   */
  end?(ctx: GameCtx<S>, data: D): GameResult<D, SMsg>;
  /** Where the game stands (phase, round, turn): a change sends the phones a fresh room checkpoint at once. */
  milestone?(data: D): string;
  /** The room came back from a checkpoint after a restart (times already moved on, side store empty): restart what the store held. */
  restored?(ctx: GameCtx<S>, data: D): GameResult<D, SMsg>;
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
| `score` | `player.score += delta`. **No snapshot is sent for you**; add one (or end the game) so the player list updates. Negative deltas are allowed and totals are not clamped: the results print `-50 pts` as it is. |
| `gameOver` | Ignored unless the room is `'playing'`. Builds `results` from the participants (score desc, then join order; rank = 1 + number of players with a higher score; spectators are not ranked; `reason` `'host'` after the host's End game, `'finished'` otherwise), posts "Game over! Alice wins with 100 points." (or a tie line), then goes back to the lobby: phase `'lobby'`, `game` null, any `waiting` state cleared, votes cleared, every score reset to 0 and `participating` to false (ready and sit-out flags survive), the side store reset (when the module has one), a snapshot. After this `nextDeadline` is no longer consulted and `handle` is not called again; game messages are refused. **Any effects after it in the same list are skipped.** |
| `abort` | Posts `reason` as a system line, then ends the game like `gameOver` with `reason: 'players'` (the standings where it stopped, nobody crowned: the line is just "Game over!"). Use it when too few players are left to go on. **Any effects after `abort` in the same list are skipped.** |
| `waiting` | Stores `missing` as the room's hold. Every later snapshot carries `RoomState.waiting = { reason: 'players', missing, needed: meta.minPlayers, connected, until? }` with the live connected count, `missing` narrowed to players still seated and disconnected, and `until` when the effect gave one (the card then counts down to it: "If they are not back in 1:30, the game goes on without them."; the count of connected players shows only while it is below `needed`); `missing: null` clears it, as do `abort`, `gameOver` and the return to the lobby. The host's card has Remove <name> for each missing player. **No snapshot is sent for you**; add one so everyone sees the hold (a tick carries none). A holding game returns `null` from `nextDeadline` while too few are connected (only the seat expiries are pending then); once enough are back it waits a short settle (`RESUME_SETTLE_MS`, restarted by every further reconnect) before going on, so a group whose sockets were all cut at once is seated together rather than from the first one back. See `server/games/waiting.ts` for the shared helpers the three games use. |
| `side` | Forwarded to the driver, which resets the side store with the given stamp (section 7). |

Around your module the platform also does: the "sit this one out" lines and a system line "The
game has started!" before `start`; if your `start` effects contain no `snapshot`, the platform
broadcasts one; the first `nextDeadline` after `start` arms the timer. `ctx.players` at `start`
is exactly the set of participants: ready, not sitting out, connected, within the seat limit.

**When each event arrives** ([`seats.ts`](../server/platform/engine/seats.ts), [`chat.ts`](../server/platform/engine/chat.ts), [`reduce.ts`](../server/platform/engine/reduce.ts)):

- `message`: after `clientMessageSchema.safeParse` succeeded, only while `'playing'` and only
  from a participant (a spectator gets `NOT_ALLOWED` "You are watching this game."), or from
  the host for a type in `hostMessages` whether they play or not. Invalid messages get
  `INVALID_MESSAGE` with the first zod issue and path.
- `chat`: for every chat line while `'playing'`. If you do **not** return `chatHandled`, the
  platform inserts the player's line **before** your effects, so a reaction ("close!") follows
  the line it reacts to.
- There is no join event: a newcomer mid-game is a spectator, so the platform's own welcome and
  snapshots are all they need, and your game state never changes for them.
- `playerLeft`: after the removal (leave, kick, vote-kick or grace expiry) of a participant or a
  spectator (check `ctx.players` if you care which). Not delivered when the room became empty, or
  when the departure already dropped the participants below `minPlayers` (the platform ended
  the game first, with the results).
- `playerDisconnected` / `playerReconnected`: a socket dropped / a disconnected player rejoined
  (a socket merely replaced by a reload on the same seat does not fire `playerReconnected`). Phones
  blink off and on (a tunnel, a Wi-Fi hand-over), so the game hears of a drop only
  `AWAY_NOTICE_MS` (4 s) after it: until then `ctx.players` still shows the player connected
  (everyone else's screen already shows them away), and a player back within that time was never
  gone as far as the game knows (no event either way). A disconnected player **stays in
  `ctx.players`** with `connected: false` until the reconnect grace
  (10 min) runs out, so anything that picks a player (the next one to act, a random holder) must
  filter on `connected`; the template never picks and so never shows this. The platform never
  abandons a game over a disconnect: if yours needs `meta.minPlayers` connected to go on, hold at
  your next boundary with a `waiting` effect (`ctx.players.length` tells you whether enough seats
  remain at all; `abort` only when they do not) and resume on `playerReconnected` (or on
  `playerLeft`, when the seat you wait for empties). A newcomer never ends a hold: they watch.
- `tick`: `nextDeadline(data) <= now`. `ctx.now` is the deadline's own time while the platform
  catches up on several overdue deadlines, so chained deadlines stay anchored.
- There is no idle event: a connection that has sent nothing for `IDLE_AFTER_MS` (90 s; a live
  page pings every 20 s) shows `idle: true` on its `PlatformPlayer` and `PlayerPublic`, and the
  platform sends everyone a snapshot. A game without clocks may let the others act for an idle
  player it waits on (Blackjack shows the seat away and lets anyone Skip or Deal now for it);
  the platform never plays for anyone.

**Moves that a second tap must not repeat.** A phone on a weak link sends a move, sees nothing
change for a moment and taps again, so the same move can arrive twice. Give each move what it acts
on, as the player's screen had it (Blackjack's `{ round, handIndex, cards }`, Poker's
`{ hand, move }` with the number of the latest move on the table), and **ignore without a word**
(no `error` effect, no state change) a move whose target no longer matches: the player meant the
first one. Keep `error` effects for real rule breaks ("You cannot double this hand."). On the
client, hold every control from the tap until the snapshot that answers it (or a few seconds, an
`onError`, a welcome), and show the tapped control pressed (`MoveButton`'s `sent`). Separately,
every room message the socket sends carries a client sequence number (`cs`), and the room applies
each number once (it skips any number at or below the highest it has applied), so the platform
can resend what a dead socket swallowed after the rejoin; a game needs nothing for that. To keep
the numbers in order, a room message sent while the rejoin is in flight waits for the welcome, and
the resend goes out first, paced to the server's per-socket limits (`client/src/platform/net/pacer.ts`).

**Views.** `view(data, viewerId, ctx)` is called once per recipient for every snapshot, with the
viewer's id when they are seated and `null` for spectators (the HTTP preview, tests). Hide
secrets per viewer here (Scribble sends the word only to the drawer and solved guessers).

### 3.4 Client module: `GameClientModule`

[`client/src/platform/game.ts`](../client/src/platform/game.ts):

```ts
export interface GameScreenProps<V = unknown, S = Record<string, unknown>> {
  room: RoomState<V, S>;
  meId: string;
  isHost: boolean;
}

/** The host's settings rows: only the host's room shows settings, so every row is editable. */
export interface SettingsFieldsProps<S = Record<string, unknown>> {
  settings: PlatformSettings & S;
  /** Sends one flat settings patch (game fields only; the platform fields have their own controls). */
  patch(partial: Partial<S>): void;
}

export interface GameClientModule<V = unknown, S = Record<string, unknown>> {
  meta: GameMeta;
  /** Rendered while the room is 'playing'; a finished game's results show over the lobby. */
  Screen: ComponentType<GameScreenProps<V, S>>;
  /** The game's sound effects; the platform starts loading them when the game screen mounts. */
  sounds?: AnySoundBank;
  /** Extra rows inside the lobby settings panel, under the platform fields. */
  SettingsFields?: ComponentType<SettingsFieldsProps<S>>;
  /** A small badge in the corner of the player's avatar (Scribble: pencil / check). */
  playerBadge?(room: RoomState<V, S>, player: PlayerPublic): ReactNode;
  /** Extra text next to the score in the player list (Scribble: "+120" this turn). */
  playerMeta?(room: RoomState<V, S>, player: PlayerPublic): ReactNode;
  /**
   * The player's chip status in the top bar ({ label, icon, tone }: "Drawing", "Guessed", "Out",
   * "Folded"); null falls back to the platform's "Ready" (and "Away" / "Watching", which the
   * platform decides before asking you).
   */
  playerStatus?(room: RoomState<V, S>, player: PlayerPublic): PlayerStatus | null;
  /** Extra class for the player's row (Scribble: the green "guessed" tint). */
  playerClassName?(room: RoomState<V, S>, player: PlayerPublic): string | undefined;
  /** A server message that is not a platform message; return true when handled. */
  onServerMessage?(msg: WireMessage): boolean;
  /** `welcome.extra`, the game's bootstrap (Scribble: the canvas history). The room is already in the store. */
  onWelcome?(extra: unknown): void;
  /** Every snapshot, welcome included; `prev` is null when this one enters the room. */
  onRoom?(room: RoomState<V, S>, prev: RoomState<V, S> | null): void;
  /** A freshly appended chat line (history from a welcome does not count): Scribble's guesses and the game's lines. */
  onChat?(message: ChatMessage): void;
  /** The room refused something while we are in it (a move against the rules): a game holding its controls for an answer lets go. */
  onError?(code: ErrorCode, message: string): void;
  /** The room is being left (leave, kick, seat lost): drop local game state, flush what must still go out. */
  onLeave?(): void;
  /** What the host's End game does right now, under "End the game for everyone?" ("It ends after the hand in play."); null: the default. */
  endGameNote?(room: RoomState<V, S>): string | null;
}

export type AnyGameClientModule = GameClientModule<unknown, Record<string, unknown>>;
/** Erases a module's type parameters for the registry. */
export function defineGameClient<V, S extends Record<string, unknown>>(module: GameClientModule<V, S>): AnyGameClientModule;
```

Only `meta` and `Screen` are required. The platform's shell ([`client/src/App.tsx`](../client/src/App.tsx))
renders `Lobby` while `phase === 'lobby'` (with the `ResultsPopup` over it once a game ended) and
your `Screen` (keyed by room code) while `'playing'`, with the `WaitingOverlay` over it during a
hold. Your top bar and options sheet carry End game and Leave room by themselves. The player list applies your
`playerBadge` / `playerMeta` / `playerClassName` only in game mode and while `room.game !== null`;
the top bar's player chips ask `playerStatus` for every connected player taking part (one word
and an icon at `CHIP_ICON` size from `PlayerChips.tsx`; tone `active` for "their move now",
`done` / `ready` for finished, `out`, `muted`). There is no chat for a game to plug into: a game
whose mechanic is typing builds its own control (Scribble's `GuessBox` sends guesses with
`sendChat`, and its `GuessFeed` reads `usePlatformStore`'s `chat`).

**Hook order** ([`client/src/platform/net/socket.ts`](../client/src/platform/net/socket.ts)) per
inbound message:

- `welcome`: the session is remembered, the platform store takes the room, then
  `onWelcome(msg.extra)`, then `onRoom(room, prev)` where `prev` is the previous room when the
  same seat reconnected and `null` for a fresh entry.
- `room`: store first, then `onRoom(room, prev)`.
- `chat`: store first (a `'notice'` line also becomes a toast), then `onChat(message)`.
- any non-platform message: `onServerMessage(msg)`, only while a room is held.
- leaving (Leave button, kick, lost seat): `onLeave()` runs **before** the URL moves and the store
  clears, so the seat is still yours if something must be flushed.

Game-specific client state belongs in the game's own zustand store
(`client/src/games/<id>/store.ts`, see Scribble's [`store.ts`](../client/src/games/scribble/store.ts)),
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
   `randomUUID` or `randomBytes` (the only exemption is Scribble's `canvas.ts`). Use `ctx.now`,
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
   `patchSchema` must accept `{}`, and both must strip platform fields (`{ contentMode: 'unhinged' }`
   parses to `{}`), which a `z.object(...)` does by default. Content lives behind
   `settings.contentMode`, never behind a per-game switch. A timing is never a setting: each clock
   is one named, commented constant in the game's shared protocol (`SCRIBBLE_DRAW_SECONDS`,
   `POKER_ACT_SECONDS`, `QUIPGAME_WRITE_SECONDS`, `SPYGAME_ROUND_MINUTES`...), so it changes in one
   place. Click Race's time limit, in the hidden test game, is the one exception. Retiring a
   setting needs no migration: a stored room keeps the old key, unread, and the `z.object`
   schemas drop it from a patch; test both.
8. **Game modules don't import each other** and the platform never imports a game by name; the
   registries are the only coupling.

---

## 5. The recipe, step by step

Pick an id (`GameId`, a lowercase identifier), a slug (lowercase letters, **never exactly 4
characters**), a name, a 24px line glyph and an accent. Below the new game is called `wordle` as an example;
replace throughout.

### Step 1: registry entry

[`shared/platform/games.ts`](../shared/platform/games.ts): add the id and a `GameMeta` in picker order.

```ts
export type GameId = 'scribble' | 'template' | 'wordle';

// inside GAME_LIST
{
  id: 'wordle',
  slug: 'wordle',
  name: 'Wordle Royale',
  howToPlay: ['Type a five-letter word.', 'Green is right, yellow is misplaced.', 'Solve it in the fewest tries.'],
  minPlayers: 1,
  maxPlayers: null, // or a number when the game cannot seat everyone; the rest sit a game out
  glyph: 'M4 4h16v16H4z M4 10h16 M10 4v16', // 24px line icon, path data only
  accent: '#a0d8a0', // also add --game-wordle to tokens.css
  contentModes: false, // true when the game reads settings.contentMode
  status: 'hidden', // flip to 'live' when ready; 'soon' shows a muted card
},
```

[`shared/platform/protocol.ts`](../shared/platform/protocol.ts): add the id to the wire schema
(the enum inside `gameIdSchema`; the preprocess in front of it reads a former id as the current one).

```ts
export const gameIdSchema = z.preprocess(
  (v) => (typeof v === 'string' ? (upgradeGameId(v) ?? v) : v),
  z.enum(['scribble', 'template', 'wordle']),
);
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
  scribble: scribbleModule,
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
  // endsByHost: true,                         // only for a game that never ends on its own clock: the suites end it with End game
},
```

A game that runs until the players decide it (Blackjack has no rounds setting and plays until one
stack is left or the host taps End game) sets `endsByHost`; the cross-game suites send the host's
`endGame` once the clock has run, where they would otherwise wait for the game to end on its own.

Blackjack has no clocks at all but the settled table's: after every settle the `results` phase
keeps the table up for the dealer's reveal only, then the next round's bets open at once (the
settled hands stay on show until the next deal), and the final table stays up in `ending` for the
reveal and `BLACKJACK_RESULTS_MS` (5 seconds, no setting) before the results. The bets wait for the players: the cards go out once every connected seat with chips has
bet or tapped Sit out, a player who is away never holds up the deal (they sit the hand out), and
the host's Deal now deals to whoever has bet. With no bet down nothing is dealt, and the table
holds once nobody connected is left to bet. Everyone ready at the start is seated with the
starting chips; nobody is seated later (a newcomer watches until the next game). The turns wait too: the player in play acts when ready, a player who
drops (or is away when their turn comes) stands at once, and the host's Skip stands an idle
player's hand in play (a skip names the hand, so a second tap never stands the next one). An idle
host never stalls the table: while the bets wait on the host, anyone may Deal now, and on the
host's own turn anyone may Skip it. The starting chips are its only setting: the house rules are fixed in
[`cards.ts`](../shared/games/blackjack/cards.ts) (the dealer stands on every 17, a natural pays 3 to
2, any two cards may double and any pair may split). Stored rooms with the old `betSeconds`,
`actSeconds`, `resultsSeconds`, `decks`, `dealerHitsSoft17`, `blackjackPayout`, `allowDouble` and
`allowSplit` keys load fine and ignore them,
and a stored room's old shoe (`shoe`, `shoeSize`, `reshuffled`) is dropped at its next round.

Write the module as the template does: a `Data` interface, `start`, `handle` (a `switch` on
`event.type`, default `{ data, effects: [] }`), `nextDeadline`, `view`, and the exported module
object with `meta: gameById('wordle')`, `settings: defineSettings(schema, defaults, normalize?)`
and `clientMessageSchema`.

Tests use the deterministic harness in [`server/platform/engine/testHarness.ts`](../server/platform/engine/testHarness.ts):

```ts
const s = sim('wordle');                                   // a room at START (2026-01-01T12:00Z), ids 'id-1', 'id-2', ..., rng () => 0
const [alice, bob] = startGame(s, ['Alice', 'Bob'], { /* settings patch */ });  // create + join + updateSettings + ready + start
s.game(alice, { t: 'guess', word: 'crane' });              // a game message; returns that action's effects
s.platform(bob, { t: 'chat', text: 'hi' });                // a platform message
s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
s.now += 30_000; s.tick();                                 // advance the clock, fire due deadlines
s.data.phase; s.data.results; s.data.players[0].score;     // the engine state (standings(s): the results as { playerId, score, rank })
endGame(s, host);                                          // the host's End game
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
  scribble: scribbleClient,
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
- Only tokens for colours, spacing, radii and shadows; the game's accent is `--game-<id>` (the
  same value as `meta.accent`), always with ink (`--game-ink`) on top; set
  `--game-accent: var(--game-<id>)` on your root class so the platform's result kicker picks it up.
  Every game screen opens with the platform's `GameTopBar` (section 8.3), never a header of its own.
- Sends go through `socket.send({ t: 'guess', word })` from `client/src/platform/net/socket.ts`;
  wrap them in a small `actions.ts` once there are several (see Scribble's
  [`actions.ts`](../client/src/games/scribble/actions.ts)).

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
template string does). [`scribble.test.ts`](../client/src/games/scribble/scribble.test.ts) shows
the store, hooks and offline-queue side of a bigger module.

### Step 5: end-to-end test

Add a `test(...)` to a spec in `e2e/` (or a new `e2e/wordle.spec.ts` with the same shape as
[`e2e/home.spec.ts`](../e2e/home.spec.ts)): `createParty(page, name, 'wordle')` from
[`e2e/party.ts`](../e2e/party.ts) (the front door, the "Who's playing?" step when no name is saved,
the lobby, with the party started on your game through `/?game=wordle`), `joinByLink(page, name,
`/wordle/<CODE>`, code)` in a second context, adjust a setting through `settings-<id>`, click
`start-game`, drive your screen through its own `data-testid`s, then assert the `overlay-game-end`
results over the lobby (`results-entry` with `data-rank`, `room-code` under it) and close them
(`closeResults(page)`: Back to the room). The host's End game is `endGameAsHost(page)` and the
cross-game flow (End game in every game, leaving mid-game, leaving below the minimum) is
[`e2e/flow.spec.ts`](../e2e/flow.spec.ts). The Click Race test in `home.spec.ts` ("the hidden template game plays a whole Click
Race between two players") is exactly this and is the one to copy. Keep the "no page errors"
assertion pattern.

A layout a real game cannot reach on demand (a seat with twelve split hands) is checked against
the real components with rigged snapshots instead: [`e2e/harness/`](../e2e/harness) renders
Blackjack's screen from a scenario in the query string, and
[`e2e/blackjack-layout.spec.ts`](../e2e/blackjack-layout.spec.ts) serves it with Vite on its own
port. Nothing in the production build imports it, and the server has no test-only hook.

The platform test ids you will use: `home-create`, `home-join`, `code-input-0..3`, `join-panel`,
`create-panel`, `name-step`, `home-name`, `home-continue`, `home-back`, `room-preview`,
`join-error`, `code-hint`, `room-code`, `game-picker` (with `data-game`), `game-tile` (with
`data-game`), `player-item` (with `data-name`, `data-score`), `player-count`, `settings-row-<id>`,
`settings-value-<id>` (a slider's value, host only), `settings-<id>`, `settings-panel` (host
only), `start-game`, `start-hint`, `waiting-for-host`, `sitout-toggle`, `edit-profile`,
`leave-room`, `timer`
(with `data-seconds`), `overlay-game-end`, `results-entry` (with `data-rank`, `data-name`,
`data-score`), `results-headline`, `results-place`, `results-reason`, `results-done`,
`results-close`, `end-game`, `end-game-confirm`, `end-game-yes`, `end-game-requested`,
`game-leave-confirm`, `game-leave-yes`, `menu-sheet`,
`toast`, `connection-notice` (with `data-status`; only rendered once the link has been gone
about 2 s), `settings-menu`, `site-header`, `brand-link`, `wordmark`.

### Step 6: ship it

Set `status: 'live'` in `GameMeta`. The game tile (the glyph on its accent, the name, a check when
selected) appears in the lobby picker from `GAME_LIST`; `/wordle/CODE` already routes;
the PWA, Vercel function and Redis driver need no change.

---

## 6. The template game, in full

Click Race (`id: 'template'`, hidden, reachable at `/template`): settings `targetClicks`
(10–100, default 30) and `timeLimit` seconds (10–120, default 30); `start` sets everyone to 0
clicks and a deadline; `{ t: 'click' }` increments the sender; the first to reach the target ends
the game with +100 and everyone else gets +clicks; the deadline ends it with everyone +clicks;
a newcomer mid-race watches. `minPlayers` is 1 so a solo race is playable (handy for tests).

### 6.1 `shared/games/template/protocol.ts`

What crosses the wire. `TemplateServerMessage` is `never`: snapshots carry everything, so the
client module needs no `onServerMessage`.

```ts
/**
 * Click Race: the template game. Copy this file for a new game and replace the settings,
 * messages and view. Everything a game needs on the wire lives here; the platform handles rooms,
 * seats, chat, scores and the results.
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
  /** Clicks so far, by player id. */
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
`gameOver`; the platform builds the results from the resulting scores. Its `end` hook lets the
host's End game score the clicks so far, as the clock running out would. `view` copies `clicks` so a
snapshot never shares an object with the state.

```ts
/**
 * Click Race: the template game module. Copy this folder to start a new game. A module is a pure
 * reducer: `start` builds the initial state, `handle` folds one event into it and returns the
 * next state plus effects, `nextDeadline` tells the platform when to tick, `view` renders what
 * one player may see. The platform owns everything else (seats, chat, scores, results, lobby).
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

/** Ends the race: the winner (if any) takes the bonus, everyone else scores their clicks; the platform builds the results. */
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
  // The host's End game scores the clicks so far, as the clock running out would.
  end: (ctx, data) => (data.over ? { data, effects: [] } : finish(ctx, data, null)),
  milestone: (data) => (data.over ? 'over' : 'racing'),
};
```

### 6.3 `server/games/template/template.test.ts`

Through the pure engine with the deterministic harness: start, counting, both ways a race ends,
a newcomer who only watches, and a direct purity check on the module.

```ts
/** Click Race through the pure engine: the template every new game's tests can copy. */
import { describe, expect, it } from 'vitest';
import type { TemplateView } from '../../../shared/games/template/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import type { PlatformServerMessageOf } from '../../../shared/platform/protocol.js';
import { defaultPlatformSettings } from '../../../shared/platform/settings.js';
import type { Effect } from '../../platform/engine/effects.js';
import { nextDeadline } from '../../platform/engine/time.js';
import { viewFor } from '../../platform/engine/view.js';
import { AVATAR, START, chatTexts, endGame, errorsOf, sim, standings, startGame } from '../../platform/engine/testHarness.js';
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
    expect(s.data.phase).toBe('lobby');
    expect(s.data.game).toBeNull();
    expect(standings(s)).toEqual([
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
    expect(s.data.phase).toBe('lobby');
    expect(s.data.results?.reason).toBe('finished');
    expect(standings(s)).toEqual([
      { playerId: bob, score: 5, rank: 1 },
      { playerId: alice, score: 0, rank: 2 },
    ]);
  });

  it('lets the host end the race early: everyone scores their clicks so far, as at the time limit', () => {
    const s = sim('template');
    const [alice, bob] = startGame(s, ['Alice', 'Bob'], { targetClicks: 100 });
    for (let i = 0; i < 3; i++) s.game(bob, { t: 'click' });
    s.game(alice, { t: 'click' });
    expect(errorsOf(endGame(s, bob))).toEqual(['Only the host can do that.']);
    expect(s.data.phase).toBe('playing');
    const effects = endGame(s, alice);
    expect(chatTexts(effects)).toEqual(['Game over! Bob wins with 3 points.']);
    expect(s.data).toMatchObject({ phase: 'lobby', game: null, results: { reason: 'host', gameId: 'template' } });
    expect(standings(s)).toEqual([
      { playerId: bob, score: 3, rank: 1 },
      { playerId: alice, score: 1, rank: 2 },
    ]);
    // A second tap, after the game ended, changes nothing and says nothing.
    expect(endGame(s, alice)).toEqual([]);
  });

  it('lets a mid-game joiner watch without a tally or a click of their own', () => {
    const s = sim('template');
    const [alice] = startGame(s, ['Alice', 'Bob'], { targetClicks: 10 });
    s.game(alice, { t: 'click' });
    s.apply({ type: 'join', name: 'Carol', avatar: AVATAR, connectionId: 'c' });
    const carol = s.playerId('Carol');
    expect(view(s).clicks[carol]).toBeUndefined();
    expect(errorsOf(s.game(carol, { t: 'click' }))).toEqual(['You are watching this game.']);
    expect(view(s).clicks).toEqual({ [alice]: 1, [s.playerId('Bob')]: 0 });
    // A watcher leaving mid-race changes nothing for the racers.
    s.apply({ type: 'leave', playerId: carol });
    expect(s.data.phase).toBe('playing');
  });

  it('is a pure module: the same object comes back when nothing changed', () => {
    const data: TemplateData = { clicks: { a: 1 }, endsAt: 1000, winnerId: null, over: false };
    const ctx = { now: 500, rng: () => 0, newId: () => 'x', settings: { ...defaultPlatformSettings(gameById('template')), ...templateModule.settings.defaults }, players: [{ id: 'a', name: 'A', joinOrder: 0, connected: true, score: 0 }], spectators: [], hostId: 'a' };
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
 * the front door, the room, players and the results; a module only needs a Screen (and,
 * optionally, settings rows and the hooks listed in platform/game.ts).
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
sends `{ t: 'click' }` straight through the socket, and composes platform components: the
`GameTopBar` every game uses (back arrow, name and round and options, then the player
chips and the clock, End game for the host on a desktop; its `GameMenuSheet` holds the theme,
sound, End game and Leave room), `Timer`, `Avatar`, `PlayerList` in a `BottomSheet`.
The end of the game is not its concern. Every interactive element carries a `data-testid` for the e2e test.

```tsx
import { useState } from 'react';
import { gameById } from '@shared/platform/games';
import type { TemplateSettings, TemplateView } from '@shared/games/template/protocol';
import { Avatar } from '../../platform/components/Avatar';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { GameMenuSheet, GameTopBar } from '../../platform/components/GameTopBar';
import { PlayerList } from '../../platform/components/PlayerList';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { WATCHING_TEXT } from '../../platform/lib/watching';
import { socket } from '../../platform/net/socket';
import { useActiveGame } from '../../platform/store/selectors';

const meta = gameById('template');

/**
 * One big button, a live ranking and the clock. The platform shows the results when the race ends.
 * A player sitting this one out watches: their button is off and the standings list racers only.
 */
export function ClickRaceScreen({ room, meId, isHost }: GameScreenProps<TemplateView, TemplateSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [sheet, setSheet] = useState<'players' | 'menu' | null>(null);
  const view = room.game;
  if (!view) return null;
  const target = room.settings.targetClicks;
  const mine = view.clicks[meId] ?? 0;
  const spectating = !room.players.find((p) => p.id === meId)?.participating;
  const racing = room.phase === 'playing' && !spectating;
  const racers = room.players.filter((p) => p.participating);
  const ranking = racers.slice().sort((a, b) => (view.clicks[b.id] ?? 0) - (view.clicks[a.id] ?? 0) || a.joinOrder - b.joinOrder);
  const watching = room.players.filter((p) => !p.participating);

  return (
    <div className="race">
      {/* Every game's top bar: options, name and status, the clock, players. */}
      <GameTopBar
        meta={meta}
        room={room}
        isPhone={isPhone}
        testId="race-header"
        status={`First to ${target} taps`}
        clock={<Timer endsAt={view.endsAt} warnUnder={5} tickUnder={3} />}
        players={{ open: sheet === 'players', onOpen: () => setSheet('players') }}
        menu={{ open: sheet === 'menu', onOpen: () => setSheet('menu') }}
      />
      <main className="card race__main">
        <h1 className="race__title">First to {target} taps wins</h1>
        <button
          type="button"
          className="race__button"
          style={{ background: meta.accent }}
          onClick={() => socket.send({ t: 'click' })}
          disabled={!racing}
          aria-label={spectating ? "You're watching this race" : `Tap! ${mine} of ${target}`}
          data-testid="click-button"
          data-spectating={spectating}
        >
          {spectating ? (
            <span className="race__watching">Watching</span>
          ) : (
            <>
              <span className="race__count" data-testid="click-count">
                {mine}
              </span>
              <span className="race__target">/ {target}</span>
            </>
          )}
        </button>
        {spectating && (
          <p className="race__note" data-testid="race-spectating">
            {WATCHING_TEXT}
          </p>
        )}
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
        {watching.length > 0 && (
          <p className="race__note player__status--sitting-out" data-testid="race-watching">
            {`Watching: ${watching.map((p) => p.name).join(', ')}`}
          </p>
        )}
      </main>
      <BottomSheet open={sheet === 'players'} title={`Players (${room.players.length})`} onClose={() => setSheet(null)} testId="players-sheet">
        <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />
      </BottomSheet>
      <GameMenuSheet open={sheet === 'menu'} onClose={() => setSheet(null)} />
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
export function ClickRaceSettingsFields({ settings, patch }: SettingsFieldsProps<TemplateSettings>) {
  return (
    <>
      <RangeSetting
        id="targetClicks"
        label="Taps to win"
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
        value={settings.timeLimit}
        format={(v) => `${v}s`}
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

.race__main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-5);
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
  color: var(--game-ink);
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

.race__watching {
  font-size: 1.3rem;
  font-weight: 800;
}

.race__note {
  width: 100%;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  text-align: center;
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
  border-radius: var(--radius-item);
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
  accent-color: var(--color-primary-text);
}

.race__clicks {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  min-width: 2ch;
  text-align: right;
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
    settings: { contentMode: 'family', targetClicks: 10, timeLimit: 30 },
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

  it('sits a spectator out: no live button, no row in the standings, listed as watching', () => {
    const state = race({ players: [player('host'), player('bob', { joinOrder: 1 }), player('rae', { joinOrder: 2, participating: false, sittingOut: true })] });
    usePlatformStore.getState().handleServerMessage(welcome('rae', state));
    const html = renderToString(createElement(templateClient.Screen, { room: state, meId: 'rae', isHost: false }));
    const button = tagWith(html, 'click-button');
    expect(button).toContain('disabled');
    expect(button).toContain('data-spectating="true"');
    expect(button).toContain("watching this race");
    expect(html).toContain('data-testid="race-spectating"');
    const rows = html.match(/<li[^>]*data-testid="race-row"[^>]*>/g) ?? [];
    expect(rows.map((r) => r.match(/data-name="([^"]+)"/)?.[1])).toEqual(['host', 'bob']);
    expect(tagWith(html, 'race-watching')).toContain('player__status--sitting-out');
    expect(html).toContain('Watching: rae');
    // The racers keep their live button and see who is watching.
    const racer = renderToString(createElement(templateClient.Screen, { room: state, meId: 'bob', isHost: false }));
    expect(tagWith(racer, 'click-button')).not.toContain('disabled');
    expect(racer).not.toContain('data-testid="race-spectating"');
  });

  it('lets the host end the race from the top bar, which nobody else has', () => {
    const state = race();
    usePlatformStore.getState().handleServerMessage(welcome('host', state));
    const host = renderToString(createElement(templateClient.Screen, { room: state, meId: 'host', isHost: true }));
    expect(tagWith(host, 'end-game')).toContain('gbar-end');
    expect(host).toContain('End game</button>');
    usePlatformStore.getState().handleServerMessage(welcome('bob', state));
    const guest = renderToString(createElement(templateClient.Screen, { room: state, meId: 'bob', isHost: false }));
    expect(guest).not.toContain('data-testid="end-game"');
  });
});

describe('Click Race settings rows', () => {
  it('renders both sliders with the shared limits, each with its value beside it', () => {
    const { settings } = race();
    if (!templateClient.SettingsFields) throw new Error('no settings fields');
    const host = renderToString(createElement(templateClient.SettingsFields, { settings, patch: () => undefined }));
    expect(tagWith(host, 'settings-targetClicks')).toContain('min="10"');
    expect(tagWith(host, 'settings-timeLimit')).toContain('max="120"');
    expect(tagWith(host, 'settings-value-timeLimit')).toContain('range-field__value');
    expect(host).toContain('30s');
  });
});
```

---

## 7. Advanced: side stores (how Scribble streams drawing) and the shared canvas

Most games do not need this; the template deliberately does not use it. Reach for a side store
only when a game has a **high-rate stream whose every message would be wasteful to run through
the reducer** (Scribble's drawing: dozens of batches a second that must reach the other players
with minimal latency and be replayed for late joiners). Everything else belongs in the reducer.

### 7.1 The shared canvas, ready to use

A game that needs a drawing canvas does not write a side store: the platform ships one.

- Wire format: [`shared/platform/canvas.ts`](../shared/platform/canvas.ts) — `drawOpSchema` /
  `DrawOp` (the streaming ops), `CanvasAction` (the history late joiners replay), the caps
  (`MAX_ACTIONS_PER_TURN`, `MAX_POINTS_PER_STROKE`, `MAX_POINTS_PER_TURN`, `MAX_CANVAS_RESYNC_BYTES`),
  `CANVAS_WIDTH` / `CANVAS_HEIGHT`, the client messages (`canvasClientMessageOptions` to spread into
  your own discriminated union, `canvasClientMessageSchema`, `CanvasClientMessage`), the server
  stream `CanvasServerMessage` (`draw` / `undo` / `clear` / `canvas`), `CANVAS_SIDE_MESSAGE_TYPES`
  and `CanvasWelcomeExtra` / `isCanvasWelcomeExtra` for `welcome.extra`. Scribble's protocol and
  constants files re-export all of these under their old names.
- Server store: [`server/platform/sideStores/canvas.ts`](../server/platform/sideStores/canvas.ts)
  — `createCanvasStore(policy)` returns the `createSideStore` function for your module;
  `CanvasStore`, `CanvasHistory` (the in-memory reference every test compares against),
  `admitOp` / `admitAll` / `replayOps` are exported for tests. The store is keyed per room code
  over the driver's `GameStorage` (memory or Redis) and applies the caps identically on both.

Opting in is three lines on the module plus a policy that says who may draw on what:

```ts
import { CANVAS_SIDE_MESSAGE_TYPES, canvasClientMessageOptions } from '../../../shared/platform/canvas.js';
import { createCanvasStore, type CanvasPolicy } from '../../platform/sideStores/canvas.js';

export const policy: CanvasPolicy<MyData> = {
  /** Identifies the canvas the game's current data draws on ('' when none); a reset mints a new one. */
  stamp: (game) => game?.canvasId ?? '',
  /** 'ok' to accept, 'silent' to drop without a word (in-flight ops after a turn ended), 'forbidden' to answer with an error. */
  check: (game, playerId, now) => (game && game.drawerId === playerId && now < game.endsAt ? 'ok' : game?.drawerId === playerId ? 'silent' : 'forbidden'),
  forbiddenMessage: 'Only the drawer can draw right now.',
};

// clientMessageSchema = z.discriminatedUnion('t', [ ...yourMessages, ...canvasClientMessageOptions ]);
export const myModule = { /* ... */ sideMessages: CANVAS_SIDE_MESSAGE_TYPES, createSideStore: createCanvasStore<MyData, MyClientMessage>(policy) };
```

Then, in your reducer, mint a fresh `canvasId` with `ctx.newId()` whenever the canvas must be
emptied and emit `{ type: 'side', name: 'reset', payload: { stamp: canvasId } }` plus
`{ type: 'send', to: 'all', msg: { t: 'clear' } }` (see `resetCanvas` in
[`server/games/scribble/turns.ts`](../server/games/scribble/turns.ts)). Scribble's whole opt-in is
[`server/games/scribble/canvas.ts`](../server/games/scribble/canvas.ts): `scribbleCanvasPolicy`
and `createScribbleCanvasStore`. The store is tested over `MemoryStorage` in
[`server/platform/sideStores/canvas.test.ts`](../server/platform/sideStores/canvas.test.ts) and
across two Redis instances in `drivers/redis.test.ts`.

The client half is [`client/src/platform/canvas/index.ts`](../client/src/platform/canvas/index.ts)
(its header comment is the contract): a game keeps one `createCanvasSession({ link, myDrawingTurn })`
for the lifetime of the page, hands it the stream from its module (`onServerMessage:
canvas.handleServerMessage`, `onWelcome: canvas.onWelcome`, `onLeave: canvas.onLeave`, and
`canvas.store.getState().clear()` at turn boundaries), and renders `<GameCanvas session={canvas}
canDraw settings footer={<Toolbar ... onUndo={canvas.undo} onRedo={canvas.redo} onClear={canvas.clear} />} />`.
Redo is the client's: the drawer's own undos go on the store's `redoable` stack and `redo()`
draws the newest one again as a fresh stroke through the ordinary draw path (a new id from
`nextStrokeId()`, so the server and late joiners take it like any other stroke); a new stroke,
a clear or a resync forgets the stack (`store.getState().dropRedo()`). Leave `onRedo` out and
the toolbar has no redo button. The colours are one row that always fits (`Palette`): the
board's seven and a More colours swatch that opens the rest of the palette (white among them)
and the custom picker above the row.
The renderer, flood fill, the drawing hook, the batching `DrawQueue` with its offline parking and
the toolbar's 44px phone styles (`canvas.css`) all live there; Scribble's whole opt-in is
[`client/src/games/scribble/canvas.ts`](../client/src/games/scribble/canvas.ts).

### 7.2 Writing a side store of your own

The pieces, all in [`server/platform/game.ts`](../server/platform/game.ts) and
[`server/platform/storage.ts`](../server/platform/storage.ts):

```ts
// On the module:
sideMessages?: ReadonlySet<string>;                         // message types the driver routes to the store
createSideStore?(storage: GameStorage): GameSideStore<D, CMsg, SMsg>;

/** What the room looks like to a side store: the platform's record with the game's data inside (players = the participants). */
export interface SideRoom<D> { code: string; phase: 'lobby' | 'playing'; game: D | null; players: PlatformPlayer[]; }

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
   types in its `CMsg` union; Scribble's `handle` simply ignores `draw` / `undo` / `clear`. A
   party may switch games, so both drivers resolve the store from the room's *current* `gameId`
   (one store per game, built on first use over the same storage).
2. **Storage.** `MemoryStorage` ([`storage.ts`](../server/platform/storage.ts)) and
   `RedisStorage` ([`drivers/redisStorage.ts`](../server/platform/drivers/redisStorage.ts), keys
   `room:CODE:side`, `room:CODE:side:meta`, `room:CODE:side:seq`) implement the same interface; writes
   are conditional on the `seq` the caller read, so concurrent instances never interleave. Wrap
   attempts in `retryCas` from [`server/platform/cas.ts`](../server/platform/cas.ts) and chain
   sync-or-async results with `after` from [`drivers/types.ts`](../server/platform/drivers/types.ts).
3. **Fan-out.** The driver broadcasts `outcome.sends` (memory: straight to sockets; Redis: a
   `{ kind: 'side', seq, stamp, sends }` channel message every instance applies to its own
   sockets, skipping changes a joiner's welcome snapshot already included).
4. **Stamps.** The reducer mints a new id for each "round" of side data (Scribble: `canvasId` via
   `ctx.newId()`) and emits `{ type: 'side', name: 'reset', payload: { stamp } }`; the driver
   empties the store and stamps it. `handleMessage` compares `stamp(room)` with the stored stamp and
   refuses writes authorised against stale data. Platform-level lobby transitions (every end of a
   game, empty room, a game switch away from the game) reset the store with stamp `''`
   automatically when the module has `createSideStore`.
5. **Welcome.** The driver completes every `welcome` with `extra` from `store.welcomeExtra`
   (the canvas store: `{ canvas: CanvasAction[] }`). Games without a side store have `extra` undefined.
6. **Resync.** When the store had to cut a player's input (the canvas caps),
   `outcome.resync = playerId` schedules `store.resync` after `SIDE_RESYNC_DEBOUNCE_MS`.

Constraints: the store receives `now` as a parameter and must not read the clock itself; side
messages are rate limited like any game message (60/s per socket); a side store never touches
`PlatformRoomData`, it only reads the `SideRoom` it is given. A store of your own lives under
`server/platform/sideStores/` like the canvas (the purity test keeps `server/games/` free of
clocks and timers). Document the stream in the game's protocol file and test the store over
`MemoryStorage` the way [`canvas.test.ts`](../server/platform/sideStores/canvas.test.ts) does.

---

## 8. The design system

Everything a game screen needs to look like the rest of the site is in
`client/src/platform/styles/` and `client/src/platform/components/`. Use these; add game CSS only
for what is truly game-specific. The brand itself (palette, type, voice, the wordmark and the
mascots) is the Pocket Party pack in [`branding/pocket-party/`](../branding/pocket-party/START_HERE.md)
(specs in `specs/*.md`; the owner's later decisions win where they differ): a near-black page,
flat graphite panels on fine borders, off-white type, lime for action and brand, lilac for
selection; 8px controls, 10px items inside panels, 14px panels, 20px sheets and modals. No glow,
gradients, blur or glossy effects anywhere, in a game stylesheet included. Copy is short and
plain, with no em dashes in anything a player sees or hears.

### 8.1 Tokens ([`tokens.css`](../client/src/platform/styles/tokens.css))

Defined on `:root` (the dark theme, which is the default), redefined under
`:root[data-theme='light']` (the theme attribute is set before first paint by the inline script
in `index.html` and changed in the settings menu behind the header's gear, `SettingsMenu`; the
operating system preference is not consulted).

| Group | Tokens |
| --- | --- |
| Type | `--font-sans` (Inter, body), `--font-display` (Space Grotesk 700, headings), `--font-mono` (IBM Plex Mono, only where a monospace is truly needed: the room code, in the code boxes and the front door's code chip, so 2/Z and 5/S never blur); self-hosted latin subsets in `client/public/fonts/` (`fonts.css`). Labels are normal words in the main fonts (no tracked uppercase, no monospace as decoration); numbers keep tabular figures; copy uses the curly apostrophe (’) |
| Spacing | `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 24px, `--space-6` 32px, `--space-7` 48px, `--space-8` 64px, `--gutter` 16px |
| Radii | `--radius-sm` 8px (inputs, buttons), `--radius-item` 10px (choice cards, code boxes, toasts), `--radius-md` 14px (panels), `--radius-lg` 20px (sheets, modals), `--radius-pill` |
| Shadows | `--shadow-sm` and `--shadow-md` are `none` (flat surfaces sit on their border); `--shadow-lg` is a soft drop for floating layers only (sheets, toasts) |
| Surfaces | `--color-bg` #141514, `--color-surface` #20221F, `--color-surface-2` #2B2E29 (raised), `--color-surface-3` #191C19 (inset wells: inputs, lists), `--color-border` #454A43, `--color-border-strong` #747D6F (control borders) |
| Text | `--color-text` #F1F0E8, `--color-text-muted` #B9C0B3, `--color-text-faint` (small text, AA on the panels) |
| Games | `--game-<id>` per game (the same hex as `GameMeta.accent`) and `--game-ink` for the glyph on top |
| Brand | `--color-primary` (lime #C7E976, a FILL that always carries `--color-primary-contrast` ink text), `--color-primary-hover`, `--color-primary-soft`, `--color-primary-text` (lime as text/border/stroke on dark, a dark olive on white); `--color-secondary*` (lilac #A699D5) with the same five |
| Status | `--color-success`, `-soft`, `-text`; `--color-warning*`; `--color-danger*`; `--color-info-soft`; `--color-focus` (flat, restrained, AA on the panels) |
| Chat | `--chat-correct-bg/fg`, `--chat-close-bg/fg`, `--chat-guessed-bg/fg` |
| Misc | `--canvas-bg`, `--overlay-bg`, `--notice-*` (the connection notice, the page's colours inverted), `--color-primary-edge` (the edge of a lime fill: lime itself on dark, a deeper lime on light, where a lime button has no edge against the off-white page), `--color-primary-mark` (the lime as a mark on the page, the wordmark's "games": lime itself on dark, cut to 3:1 on light), `--btn-disabled-bg/border/fg` (a disabled button: a quiet fill, muted text and, on light, a border), `--avatar-wash` (laid over a player's colour under the face: nothing on dark, a little white on light), `--mobile-breakpoint` (760px, informational: media queries need the literal) |
| Light | The same tokens under `:root[data-theme='light']`: an off-white page (#F5F6EF), white panels, raised surfaces (`--color-surface-2`) in a pale lime (#EAF0D9, never a grey-green), wells a shade under white, every brand colour that carries text a darker cut (`--color-primary-text` #3D6B0F) at AA on white, on the pale lime and on the felt; the overlay behind a card is ink at three fifths. A card table's felt (`.tbl-felt` in `table.css`) reads the surface tokens the other way round on light: the felt is a pale green and seats, ribbon and wells go white, so cards never sit white on white |

The one rule that keeps both themes legible: `--color-primary` / `--color-secondary` are fills
(with their `-contrast` text); for coloured text, borders, rings and strokes use
`--color-primary-text` / `--color-secondary-text`. Lime on a white panel is invisible, so the
light theme swaps the `-text` variants for darker cuts while the fills stay lime and lilac. Both
themes are checked side by side at every size: anything you colour must read in each.

### 8.2 Classes ([`components.css`](../client/src/platform/styles/components.css))

| Purpose | Classes |
| --- | --- |
| Layout | `.card` (surface, 1px border, `--radius-md`, 16px padding on phones and 24px on desktop, no shadow), `.card__head`, `.card__title`, `.card__text` |
| Buttons | `.btn` (48px, 8px corners, Inter 600) with `.btn--primary` (lime, ink text: the one loud action on a screen), `.btn--secondary` (1.5px strong outline), `.btn--ghost` (no border), `.btn--danger` (danger-soft fill, danger border), sizes `.btn--lg` / `.btn--sm` / `.btn--xs`, `.btn--block`, `.btn--choice` (big option buttons); `.icon-btn`, `.icon-btn--sm`; `.segmented`; `.switch` |
| Text inputs | `.input`, `.input--lg`, `.input.is-invalid`, `.textarea`, `.field`, `.field__label`, `.field__hint`, `.field__error`, `.field__ok` |
| Badges | `.pill`, `.pill--accent`, `.banner`, `.banner--info`, `.banner--invite`, `.spinner`, `.ellipsis` (animated dots) |
| Overlays | `.overlay__card`, `.overlay__card--wide`, `.overlay__kicker`, `.overlay__title`, `.overlay__hint`, `.overlay__footer` (the results use these; a game's own in-screen overlay can too); a round result adds `.result-card`, `.result-kicker`, `.result-reveal*`, `.result-points*`, `.result-next` from `results.css` |
| Player list | `.player-list`, `.player`, `.player--me`, `.player--offline`, `.player--guessed`, `.player__avatar`, `.player__badge`, `.player__badge--drawer`, `.player__badge--guessed`, `.player__rank`, `.player__name`, `.player__meta`, `.player__score`, `.player__turn-points` |
| Timer | `.timer`, `.timer--lg`, `.timer--md`, `.timer--urgent` (the last 5 seconds), `.timer--long` (m:ss), `.timer__track`, `.timer__arc` |
| Sheets and toasts | `.sheet*`, `.menu-sheet*` (a phone options sheet: `.menu-sheet__row`, `.menu-sheet__label`, `.menu-sheet__leave`), `.toasts`, `.toast` with `.toast--success/warning/error` (an `info` toast uses the base style) |
| Header | `.site-header`, `.brand` (the wordmark link), `.wordmark` (24px tall on phones, 30px on desktop, via `--wordmark-height`), `.wordmark__accent`, `.settings-menu`, `.settings-menu__action` (full-width outlined buttons under the preferences; `--danger` for End game), `.pref-row` |
| Connection | `.conn-notice`, `.conn-notice__card` (the inverted `--notice-bg` / `--notice-fg` card), `.conn-notice__title`, `.conn-notice__detail` |
| Misc | `.avatar--sm/md/lg/xl`, `.face-img`, `.swatch`, `.emoji-choice`, `.code-input`, `.range`, `.toggle`, `.setting*`, `.podium*` (the results' top three), `.results*`, `.exit-action*`, `.exit-confirm*`, `.btn--danger-solid`, `.hide-mobile`, `.sr-only` |

The game top bar (`.gbar*`) is the platform's `gamebar.css` and the round results (`.result-*`)
its `results.css`. The type-into-the-blanks guess bar (`.guess-*`, `.gtile*`) is the platform's `guess.css`, rendered
by `GuessTiles`; playing cards, chip counts and the chip setting (`.playing-card*`, `.chip-count*`,
`.chips-setting*`) are `cards.css`; the card-table kit (`.tbl*`) is `table.css`; the canvas and its toolbar (`.canvas-*`, `.toolbar*`) are the platform canvas's
`canvas.css`. Game-specific classes live in the game's stylesheet; Scribble's `scribble.css` owns
`.word*`, `.tile*`, `.overlay` (its in-canvas overlay position), and the whole `.game`
layout, which is a good reference for a non-scrolling phone game.

### 8.3 Components and their props

| Component | Props | Notes |
| --- | --- | --- |
| [`SiteHeader`](../client/src/platform/components/SiteHeader.tsx) | `menuActions?: MenuAction[]`, `hero?` | The logo (in the room, part of one header bar, `.lobby__top` in `lobby.css`: one surface like the game top bar, with the logo at the left, "Room code" and the lime tiles together in the middle and Copy and Share as compact buttons at the right end, everything 44px tall on one line; a phone splits the bar into the centred logo and the code card under it; the two phones as its icon, then the wordmark, whose "o" in ".io" is the settings gear) links to `/` (inside a room that leaves the room: any navigation away from `/:slug/:CODE` does); nothing else sits beside it (the connection has its own notice); the gear "o" is the settings button, whose popover lists `menuActions` under the preferences (the lobby's Copy invite link and Leave room); `hero` is the front door's logo, filling the column's width (from 1024px it grows past the column to two fifths of the screen, at most 600px, centred over it) |
| [`Wordmark`](../client/src/platform/components/Wordmark.tsx) | `className?` | The outlined boredgames.io logo (Poppins Black + Regular paths) inline, accessible name "boredgames.io", "games" in `--color-primary-mark` |
| [`PhoneBored`](../client/src/platform/components/Mascots.tsx) / `PhoneHappy` | `className?` | The two phone characters from `branding/mascots/boredgames-mascots.svg`, each cropped to itself, decorative (`aria-hidden`); the logo draws `BoredArt` and `HappyArt` together; celebrations only |
| [`GameGlyph`](../client/src/platform/components/GameGlyph.tsx) | `game: GameMeta`, icon props | The game's 24px line glyph (the lobby tiles draw it at 32px) |
| [`GameTopBar`](../client/src/platform/components/GameTopBar.tsx) | `meta`, `room`, `isPhone`, `testId`, `className?`, `status?` (none for a card table, whose round is on its ribbon), `statusTestId?` ('round-indicator'), `statusData?`, `clock?`, `players: { label?, open, onOpen }`, `menu: { open, onOpen }`, `middle?`, `below?`, `compact?` | Every game's top bar as on the brand board (`gamebar.css`, `.gbar*`): a back arrow (`game-back`, it asks before leaving: `leave-sheet`, `game-leave-confirm`, `game-leave-yes`), the game's name large and the status ("Round 2/3": on the right on a desktop, in small type under the name on a phone, so the name, the round and the buttons each keep their own space), then the options button (a phone) or the host's End game (`end-game`, a tinted button with a danger border and the power icon that fills solid under the pointer; it asks first in `end-sheet`, with your `endGameNote`; "Ending soon" once asked for a later end) and the gear, whose menu also holds End game and Leave room as full-width buttons (a desktop). Below, the player chips (`PlayerChips`: avatar, name, a status badge from your `playerStatus`; the row is the `players-toggle` button and never scrolls, a "+K" chip takes what does not fit) and the timer ring at the end. Keep the status short (`RoundStatus` renders "Round 1/5"); it stays on one line. `TableShell` renders it for the card tables, `compact` at every size. `compact` packs it into one row (a card table, The Spy Game on a phone): the chips give way to a players button (`players-toggle`: the people icon and the count in a pill, a 44px target), and a `clock` sits small in the row; the name stays whole at every phone width |
| `GameMenuSheet` | `open`, `onClose()`, `children?` | The phone options sheet behind the bar's menu button (`menu-sheet`): theme and sound, your rows, then the ways out as tall rows (`ExitActions` in `GameExit.tsx`): End game for the host in the danger colour ("Ends it for everyone"), Leave room ("Only you leave"); each opens its confirm step in the sheet ("End the game for everyone?" with what it does; "Leave the room?" with whether the game goes on) |
| [`ResultPoints`](../client/src/platform/components/RoundResult.tsx) / `ResultNext` / `earnersOf` | `rows`, `label`, `rowTestId?`, `empty` / `noun`, `paused`, `settling`, `testId` / `players`, `points` | A round or turn result (`results.css`): put them in an `.overlay__card.result-card` after a `.result-kicker` (how it ended, on the game's accent) and a `.result-reveal` (the word, the spy); the points list shows avatar, name, role tag and `+points`; the footer says what comes next ("Next turn soon", paused, or "starting" when the time is up) with no timer of its own: **one countdown per screen**, the top bar's ring (The Spy Game's ring counts the vote and the time to the next round while its round clock waits) |
| [`SettingsMenu`](../client/src/platform/components/Preferences.tsx) / `PreferenceRows` | `actions?: MenuAction[]` / none | The gear and its popover (theme, sound effects, then the actions: `{ label, icon, onSelect, testId }`); the rows alone go in a phone options sheet |
| [`ReadyControls`](../client/src/platform/components/ReadyControls.tsx) | `me`, `extra?` | Not ready: a big "I'm ready" over a row of equal secondary buttons, "Sit this one out" first and `extra` after it (the room's "Change my look", which opens the profile editor in a sheet); ready: "You're ready" (tap to undo) over the same row; sitting out: "Count me in" (back in and ready in one tap) and the hint, `extra` still in the row; the host: only the row (Start says they are in) |
| [`Avatar`](../client/src/platform/components/Avatar.tsx) | `avatar`, `size?: 'sm' \| 'md' \| 'lg' \| 'xl'`, `dimmed?`, `className?`, `label?` | The player's colour with their face, a bundled Fluent Emoji picture (lazy-loaded; the emoji itself if it fails to load) sized by the circle's font size, so a rule like `.my-seat .avatar { width: 30px; height: 30px; font-size: 17px; }` resizes both. Silent (`aria-hidden`) by default, since the name sits beside it; pass `label` where nothing else names it. Dim disconnected players. `FaceImage` draws a face alone |
| [`AvatarPicker`](../client/src/platform/components/AvatarPicker.tsx) | `value`, `onChange(next)`, `compact?` | Used by the front door's "Who's playing?" step and the lobby: the 50 faces in 5 or 10 equal columns and the 12 colours 6 by 2 (4 by 3 under 284px), by the width it has (container queries); every choice fills its column, 44px tall, 4px apart, so the grids span the full width in even rows |
| [`CodeInput`](../client/src/platform/components/CodeInput.tsx) | `value`, `onChange(code)`, `onSubmit()`, `onInvalidChar()`, `disabled?`, `invalid?`, `autoFocus?`, `labelledBy?`, `describedBy?`, `ref?: Ref<CodeInputHandle>` | The 4-box code field (A/B/C/D placeholders, uppercase, auto-advance, Backspace, arrows, paste of a code or an invite link, Enter submits, never auto-submits); `ref.focus(i)` moves to a box |
| [`PlayerList`](../client/src/platform/components/PlayerList.tsx) | `room`, `meId: string \| null`, `isHost`, `mode: 'lobby' \| 'game'`, `game: AnyGameClientModule \| null` | Game mode ranks by score and shows kick / vote-kick; pass `useActiveGame()` as `game` to get your badges. The kick button is each row's last item, after the status (the lobby's Ready, Not ready, Reconnecting...), in a column that lines up down the list: your own row keeps it empty while anyone else is listed. In the lobby it always shows as a 44px target; in a game's narrow list it is 32px (44px on touch screens) and shows on hover. The score and this turn's points are never cut: the points take a second line when the column is narrow. One badge a player at most: in a game that is your `playerBadge` on the avatar (the host gets a small crown by the name, `host-crown`), in the lobby the Host tag; your own row says "you" as a plain word |
| [`SettingsPanel`](../client/src/platform/components/SettingsPanel.tsx) | `room`, `game` | Platform rows then your `SettingsFields`; the lobby renders it for the host only |
| [`SettingRow`](../client/src/platform/components/SettingControls.tsx) | `label`, `testId`, `hint?`, `control?` | A setting's title, its control, then the hint; no value beside the title (the chosen option is the readout). `.setting` puts 10px between a title and its control and the hint 4px under the control, so it reads as part of that setting; `.settings` spaces settings 32px apart. Test id `settings-row-<id>` |
| `RangeControl` | `id`, `value`, `min`, `max`, `step?`, `onCommit(v)`, `label`, `revision`, `format?(v)` | Debounced 150 ms; its value reads beside it and follows the thumb (`format`, the number by default). Keep `format` short: the value box is as wide as the longest value any slider in the panel can show (`ReadoutWidthScope` in the settings panel), so the tracks line up and never change length; test ids `settings-<id>`, `settings-value-<id>` |
| `RangeSetting` | `RangeControl` props + `hint?`, `rowLabel?` | A setting with the slider and its value |
| `ToggleSetting` | `id`, `checked`, `onChange(checked)`, `label`, `disabled?`, `hint?` | Test ids `settings-row-<id>`, `settings-<id>` |
| `WordListSetting` | `id`, `label`, `words`, `parse(text)`, `split(text)`, `onCommit(words)`, `placeholder?`, `maxLength?`, `noun?`, `autoCapitalize?` | A custom list (Scribble's words, Quip Game's prompts): a debounced textarea, the count and an "Upload a .txt file" button right under it. The file is read in the browser (plain text up to 100 KB, [`lib/wordFile.ts`](../client/src/platform/lib/wordFile.ts)), split by the same `parse` and added after what is typed without duplicates; a short line says how many were added and what was left out (repeats, too long, over the limit). `split` is how `parse` cuts text into entries before its rules (`splitWordList` in `shared/platform/words.ts`, or the game's own), so the line can count every entry. Test ids `settings-row-<id>`, `settings-<id>`, `settings-<id>-count`, `settings-<id>-upload`, `settings-<id>-file`, `settings-<id>-upload-status` |
| [`PlayingCard`](../client/src/platform/components/PlayingCard.tsx) | `card: Card \| null`, `size?: 'sm' \| 'md' \| 'lg' \| 'xl'`, `testId?` ('card'), `slot?`, `highlight?`, `className?` | A white CSS card in both themes; a face-down card's markup carries no rank or suit (`data-face`, `data-rank`, `data-suit` on face-up cards); `cardName(card)` is its accessible name. Blackjack and Poker |
| [`Chips`](../client/src/platform/components/Chips.tsx) | `value`, `size?`, `className?`, `testId?` | A chip count with the coin (`data-chips`); `ChipIcon` alone for inputs |
| [`ChipsSetting`](../client/src/platform/components/ChipsSetting.tsx) | `id`, `label`, `value`, `min`, `max`, `presets`, `onCommit(v)`, `hint?` | A chip amount setting: one row of preset buttons and a numeric field (which holds the value) committed on blur or Enter, clamped; test ids `settings-<id>`, `settings-<id>-<preset>` |
| [`GuessTiles`](../client/src/platform/components/GuessTiles.tsx) | `mask`, `draft`, `onDraftChange(draft)`, `onSubmit(text): boolean`, `canSend` | Type into the blanks of a masked word (layout in [`lib/wordMask.ts`](../client/src/platform/lib/wordMask.ts)); Scribble's guess bar; test ids `guess-input`, `guess-send` |
| [`Timer`](../client/src/platform/components/Timer.tsx) | `endsAt: number \| null \| undefined`, `warnUnder?` (10), `tickUnder?`, `size?: 'md' \| 'lg'`, `paused?`, `settling?`, `label?` (a small word under the ring: what it counts when that is not the usual clock), `data?` (extra data attributes) | Server-clock countdown in a ring whose lime arc empties toward the deadline (the length is the time left when this client first saw the deadline; reduced motion steps it once a second); plain seconds up to 99, m:ss beyond; the danger colour in the last 5 seconds (never with `warnUnder` 0); `tickUnder` plays a tick cue for the final seconds |
| [`BottomSheet`](../client/src/platform/components/BottomSheet.tsx) | `open`, `title`, `onClose()`, `children`, `testId`, `className?` | Phone sheet with focus trap and Escape; `${testId}-close`, `${testId}-backdrop`. `className="sheet--dialog"` makes it a centred box over the dimmed page from 1024px (the lobby's Change my look); Escape and a click on the page around it still close it |
| [`ResultsPopup`](../client/src/platform/components/ResultsPopup.tsx) | `results`, `meId`, `onClose()` | Rendered by the shell over the lobby once a game ended (the store's `results`); you never render it. The small happy phone (96px at most), "Scribble · Game over", "Alice wins!" and the score in the game's `scoreUnit` (points, or a card table's chips), where you came, why it ended early (`results-reason`), the top three on small lime / lilac / graphite blocks (`results-step`), every player in order (`results-entry` with `data-rank`) and a brief confetti; a game cut short by too few players crowns nobody. Back to the room, the X, Escape or (a desktop) a tap beside it closes it for good |
| [`Toasts`](../client/src/platform/components/Toasts.tsx), [`ConnectionNotice`](../client/src/platform/components/ConnectionNotice.tsx) | none | Both are rendered once by the shell; add toasts with `usePlatformStore.getState().addToast(kind, text)` (errors stay until dismissed), never for the connection: the notice says that (`noticeFor` in `lib/connectionNotice.ts` words it, with room for a second line) |
| [`Icons`](../client/src/platform/components/Icons.tsx) | `Icon({ paths, size?, ...svg })` (1.8px round stroke) plus `DiceIcon`, `CrownIcon`, `CheckIcon`, `CopyIcon`, `ShareIcon`, `ChatIcon`, `GearIcon`, `AlertIcon`, `LinkIcon`, `CloseIcon`, `UsersIcon`, `ChevronIcon`, `LogoutIcon`, `PlayIcon`, `KickIcon`, `SparkIcon`, `EditIcon`, `SendIcon`, `UploadIcon`, `MoreIcon`, `MoonIcon`, `BackIcon` | Build game icons from the `Icon` primitive (24×24 stroke paths), as The Spy Game's [`Icons.tsx`](../client/src/games/spygame/components/Icons.tsx) does |

### 8.4 Mobile layout rules

- **Breakpoint 760px.** `@media (max-width: 760px)` is the phone layout everywhere; the lobby
  also collapses columns at 1100px. Width-check at 390×844 (portrait), 320×568 (small portrait),
  375×375 / 360×304 / 320×310 (keyboard open) and 844×390 (landscape); `e2e/mobile.spec.ts` runs
  Scribble through all of them.
- **`PHONE_QUERY`** in [`lib/media.ts`](../client/src/platform/lib/media.ts)
  (`(max-width: 760px), (min-aspect-ratio: 3/2) and (max-height: 520px)`) with
  `useMediaQuery(PHONE_QUERY)` decides between desktop columns and phone stacking in JS when CSS
  alone is not enough (Scribble swaps its players column for a `BottomSheet`).
- **Non-scrolling screens.** `useAppMode(isPhone)` from [`lib/useViewport.ts`](../client/src/platform/lib/useViewport.ts)
  puts `html.is-app` on the document (page never scrolls, `height: 100%`), and the shell publishes
  the visible viewport height as `--app-height` so a fixed layout sits above the on-screen
  keyboard. Scrolling screens like Click Race need neither.
- **Safe areas.** Pad the root with `env(safe-area-inset-*)` as `template.css` does.
- **Targets.** 44px minimum for anything tappable (the e2e specs assert it); inputs at `16px` or
  more (`base.css` enforces `max(1em, 16px)`) so iOS does not zoom.
- **Order and specificity.** Platform CSS is imported first by `main.tsx`; a game stylesheet is
  imported by its module. Overriding a platform class inside a media query needs your root class
  in front (`.game .timer--lg` in Scribble), otherwise the result depends on bundle order.
- `prefers-reduced-motion` is honoured globally in `base.css`; `touch-action: manipulation` on
  buttons removes the double-tap delay.

### 8.5 Sound, haptics, formatting

- [`lib/sound.ts`](../client/src/platform/lib/sound.ts): `playCue('correct' | 'yourTurn' | 'tick' | 'turnEnd' | 'fanfare')`
  for the short note cues, and `defineSounds(group, { name: def })` for a game's own sound
  effects. Everything is silent when the user muted sound, before the first tap, and never throws.

**Sound effects.** A game declares its sounds once, in `client/src/games/<id>/sounds.ts` (no
React, no CSS: the unit tests and the e2e suite import it), sets the bank as the module's
`sounds` and adds it to `GAME_SOUND_BANKS` in
[`client/src/games/sounds.ts`](../client/src/games/sounds.ts); the platform starts fetching the
files when the game screen mounts (its own sounds load after the first tap). Each sound is a
recorded file under [`client/public/sounds/`](../client/public/sounds/) (named without
`/sounds/` or `.mp3`; an array picks one at random each time) or a sound made in code
(`render`: the shared `whoosh`, `drumroll` and `applause`, or your own pure function of
the sample rate). `volume` is its level before the 0.6 master (cards and clicks about 0.3 to
0.5, wins about 0.7); `cooldownMs` drops repeats that come too fast (60 ms by default); every
play wanders up to 4% off pitch unless `steady` is set (musical stings).

```ts
export const pokerSounds = defineSounds('poker', {
  deal: { file: TABLE_FILES.deal, volume: 0.4, cooldownMs: 40 },
  check: { file: TABLE_FILES.knock, volume: 0.5 },
  win: { file: 'stings/win', volume: 0.7, cooldownMs: 2000, steady: true },
});
pokerSounds.play('check', { volume: mine ? 1 : ONLOOKER_VOLUME });
```

Play a sound where the moment happens: in `onRoom` (comparing `prev` with the new snapshot), in
an action (a tap the player just made), or timed to an animation with `createSoundSchedule()`
(the card games use `scheduleTimelineSounds` in
[`platform/table/sounds.ts`](../client/src/platform/table/sounds.ts) so a card's sound lands with
the card; Blackjack's [`sfx.ts`](../client/src/games/blackjack/sfx.ts) and Poker's
[`sfx.ts`](../client/src/games/poker/sfx.ts) give every card movement its sound, the discard sweep
included, and their tests check each against the planned timeline; cards or chips that move at
the same moment, such as the flop turning over or a showdown, play one sound).
Someone else's moment plays at `ONLOOKER_VOLUME`; give a sound that a burst of events could
repeat a `cooldownMs` so it never stacks into noise. A new file gets a row in
[`CREDITS.md`](../client/public/sounds/CREDITS.md) (pack, original file, licence; only CC0 or
your own) and goes through `scripts/sounds/build.sh` (a row may layer files from several packs,
as the Blackjack sting does: a jingle with chips spilling under it); the unit tests fail on a file nothing
plays, a missing credit or a set over 800 KB, and `e2e/sounds.spec.ts` checks every file is
served and decodes.
- [`lib/haptics.ts`](../client/src/platform/lib/haptics.ts): `vibrate(ms)`.
- [`lib/format.ts`](../client/src/platform/lib/format.ts): `formatSeconds`, `formatPoints` (+N), `plural`, `ordinal`, `friendlyError`.
- [`lib/useCountdown.ts`](../client/src/platform/lib/useCountdown.ts): `useCountdown(endsAt)` (ms) and `useCountdownSeconds(endsAt)` on the server clock; `remainingMs(endsAt, clockOffset)` for non-hook code.
- [`lib/clipboard.ts`](../client/src/platform/lib/clipboard.ts): `copyText(text)`.

---

## 9. Platform APIs a game may call

From [`client/src/platform/net/socket.ts`](../client/src/platform/net/socket.ts) and
[`net/actions.ts`](../client/src/platform/net/actions.ts):

```ts
// false when the socket is closed (nothing is queued). A room message is numbered and kept until the
// next welcome says it arrived, then sent again if it did not; { keep: false } opts out (a stream
// with its own recovery, like the canvas ops).
socket.send(msg: PlatformClientMessage | WireMessage, opts?: { keep?: boolean }): boolean;
socket.isOpen(): boolean;
leaveRoom(); sendChat(text); updateSettings(patch); startGame(); kickPlayer(id); voteKick(id); endGame();
// Party actions (platform messages `selectGame`, `ready`, `sitOut`) are the lobby's; a game never sends them,
// and End game is the top bar's and the options sheet's.
```

From [`store/usePlatformStore.ts`](../client/src/platform/store/usePlatformStore.ts) and
[`store/selectors.ts`](../client/src/platform/store/selectors.ts):

```ts
usePlatformStore((s) => s.room)        // RoomState | null (cast to your RoomState<V,S> inside your module, as Scribble's hooks.ts does)
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
   slug rules (`shared/platform/games.test.ts`). These `describe.each(GAME_IDS)` suites
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
   targets, as `home.spec.ts` does for the front door and `mobile.spec.ts` for Scribble.
6. Manual pass: two browser tabs (or a phone on the same network via `npm run dev`), reload one
   mid-game (the seat survives, the view comes back from the snapshot and `welcome.extra`), let a
   player leave mid-game (the game goes on; below the minimum it ends with the results), join
   mid-game with the code (you watch, then play the next game), kick someone, end a game with
   the host's End game and let one finish on its own (both land in the lobby with the results),
   and one run with `REDIS_URL` pointing at a local Redis.
7. Hygiene: no `Date.now` / `Math.random` / timers in `server/games/<id>/`, `.js` extensions on
   relative imports in `shared/` and `server/`, comments only where the logic is not obvious,
   small modules.
8. Sound: a live game has a `sounds` bank (section 8.5), listed in `GAME_SOUND_BANKS`, every new
   file credited in `client/public/sounds/CREDITS.md`; `client/src/games/sounds.test.ts` and
   `e2e/sounds.spec.ts` check them. Play a round with sound on and once with it off.

---

## 11. Gotchas

- **Slugs and codes share the URL.** A slug of exactly 4 characters would be parsed as a room
  code; the registry test refuses it.
- **Codes are one namespace across games.** A code typed on Scribble's home can belong to a
  Click Race room; the preview says so and joining it enters that game. Don't assume the game from
  the URL before the room arrives; `room.gameId` is the truth.
- **`room.game` is `null` in the lobby** and your `Screen` is not mounted then. `PlayerList`
  and the settings hooks guard on it.
- **`score` does not snapshot.** Follow it with `{ type: 'snapshot', to: 'all' }` unless the same
  effect list ends the game.
- **Effects after `abort` or `gameOver` are dropped**, and `gameOver` is ignored unless the room is `'playing'`.
- **Scores reset to 0** on `start` and on every return to the lobby; `RoomState.results` is the
  only record of a finished game.
- **Nothing on screen may depend on a chat line.** There is no chat: a hold a player can end must
  show the platform's waiting card (`waiting` effect), and anything a game waits on needs a clock,
  a button or an `until` so nobody is stuck (The Spy Game's away spy: the waiting card with
  Remove, and the round ends without them after `SPYGAME_SPY_AWAY_SECONDS`). The waiting card
  covers the whole game screen, so never raise it over a control whose own clock keeps running:
  pause that clock too, or let it finish first (a vote running when the spy drops ends before the
  hold comes up).
- **Settings patches** are validated as a whole: one invalid field rejects the patch with
  `INVALID_MESSAGE` ("Invalid settings at <path>: <message>"); unknown keys are stripped (so a
  room stored with a retired key such as `maxPlayers` or Quip Game's old `cheeky` still loads);
  your `normalize` runs on the merged settings and may rewrite dependent fields. A field you add
  later is filled in from your defaults when an older stored room loads; retired keys stay,
  unread.
- **`ctx.players` is the participants, not the room.** Players who sat the game out or joined it mid-way are in
  `ctx.spectators` and in `room.players` with `participating: false`; they still receive every
  snapshot and line, so views must not assume every `room.players` entry has a game entry.
- **Content follows `ctx.settings.contentMode`.** Pick words, prompts and places through the
  shared pool helpers; never add a per-game "adult" switch.
- **`meta.maxPlayers` is a seat limit, not a room cap.** `null` seats everyone (up to
  `ROOM_HARD_CAP` = 50); a number benches the extra ready players for that game. Prefer `null`:
  the owner wants big parties to all play (Blackjack seats everyone and deals from an endless
  deck, see `drawCard` in `shared/games/blackjack/cards.ts`). Only a hard limit of the game
  itself justifies a number: Poker's 23 is what one deck can deal. Test a start with a full room
  (`server/games/bigParty.test.ts` does it for every live game) and keep long lists scrolling
  inside their own panel.
- **Chat history** (the lines behind Scribble's feed) is capped at 60 lines and replayed in
  `welcome.chat`; private lines (explicit recipient lists) are never stored, so a late joiner does
  not see them, and a replayed `'notice'` never pops up again.
- **Settings are the host's alone.** Write `SettingsFields` for the host: there is no read-only
  variant, and nothing echoes a chosen value beside a title (the chosen option is the readout; a
  `RangeSetting` shows its own value, formatted by `format`).
- **Joins are never game events.** A newcomer mid-game is in `ctx.spectators` from their first
  snapshot to the end of the game; give spectators a read-only view (no controls, one line saying
  they are watching and play the next game).
- **Rate limits**: 60 game messages per second per socket are accepted, the rest dropped
  silently; every other platform room message (ready, sit out, settings, profile, kicks, votes,
  start, the game picker) 20 per 2 s, the rest dropped silently; chat is 6 per 4 s with a
  `RATE_LIMITED` error; room create/join 5 per 10 s.
- **Snapshots are paced**: each socket gets at most one room snapshot every 50 ms (the newest;
  snapshots of one action collapse to its last), always after the messages sent before it, and a
  socket that stops reading is cut off once 2 MB are waiting for it. Never rely on seeing every
  intermediate snapshot: plan animations from whichever two you get.
- **Refusals are notes, not alarms**: a `NOT_ALLOWED` shows the server's own message as a short
  toast that closes itself; write those messages for players ("It is not your turn.").
- **Message size**: 64 KB per WebSocket frame (`MAX_WS_MESSAGE_BYTES`).
- **`welcome.extra` is `undefined`** without a side store; `onWelcome` still fires.
- **Document titles** are the platform's: "boredgames.io" (the front door), "boredgames.io · CODE"
  (in a room).
- **Storage keys** (`boredgames.name`, `boredgames.avatar`, `boredgames.prefs`, session
  `boredgames.session` and `boredgames.resultsSeen`) belong to the platform; a game that needs to remember something per device
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
