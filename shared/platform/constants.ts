/** Game-agnostic constants shared by the server and the client. */
export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 16;
export const CHAT_MAX_LENGTH = 120;
export const CHAT_HISTORY_LENGTH = 60;

/**
 * How long a disconnected player keeps their seat (and score) before being removed. Phones lock,
 * people switch apps and hosting cuts long connections, so this is generous: a game never loses
 * a player over a short absence. Games pause at round boundaries while seated players are away
 * (see RoomState.waiting) rather than abandoning the game.
 */
export const RECONNECT_GRACE_MS = 10 * 60_000;
/**
 * A dropped socket shows as away at once, but the running game only hears of it after this long:
 * a phone that blinks off and straight back (a Wi-Fi hand-over, a tunnel) keeps its hand and its
 * place in the next deal. A rejoin within it is a non-event for the game.
 */
export const AWAY_NOTICE_MS = 4000;
/**
 * A connected socket that has sent nothing at all for this long (not even the 20 s keep-alive
 * ping) belongs to a phone that is asleep, frozen or in the background: the room marks the player
 * idle. Longer than a minute, which is how often a hidden desktop tab may still run its timers.
 */
export const IDLE_AFTER_MS = 90_000;
/** How long an empty room is kept alive before it is deleted. */
export const EMPTY_ROOM_TTL_MS = 60_000;

export const MAX_WS_MESSAGE_BYTES = 64 * 1024;

/** Chat rate limit: at most CHAT_RATE_LIMIT_COUNT messages per CHAT_RATE_LIMIT_WINDOW_MS. */
export const CHAT_RATE_LIMIT_COUNT = 6;
export const CHAT_RATE_LIMIT_WINDOW_MS = 4000;
/** Game messages (draw batches, clicks, ...) above this rate per socket are dropped silently. */
export const GAME_MESSAGE_RATE_LIMIT_PER_SECOND = 60;
/**
 * Every other platform room message (ready, sit out, settings, profile, kicks, votes, start, the
 * game picker, end game): about ten a second with a burst of twenty, the rest dropped silently.
 * Each one re-renders the room for every player, so a flood from one phone (a script or a stuck
 * button) must not reach the room. The client paces what it sends again after a reconnect to
 * these limits (client/src/platform/net/pacer.ts).
 */
export const PLATFORM_RATE_LIMIT_COUNT = 20;
export const PLATFORM_RATE_LIMIT_WINDOW_MS = 2000;
