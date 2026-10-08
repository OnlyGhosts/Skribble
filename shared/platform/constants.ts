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
/** How long an empty room is kept alive before it is deleted. */
export const EMPTY_ROOM_TTL_MS = 60_000;

export const MAX_WS_MESSAGE_BYTES = 64 * 1024;

/** Chat rate limit: at most CHAT_RATE_LIMIT_COUNT messages per CHAT_RATE_LIMIT_WINDOW_MS. */
export const CHAT_RATE_LIMIT_COUNT = 6;
export const CHAT_RATE_LIMIT_WINDOW_MS = 4000;
