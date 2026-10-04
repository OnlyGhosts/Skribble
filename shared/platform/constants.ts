/** Game-agnostic constants shared by the server and the client. */
export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 16;
export const CHAT_MAX_LENGTH = 120;
export const CHAT_HISTORY_LENGTH = 60;

/** How long a disconnected player keeps their seat (and score) before being removed. */
export const RECONNECT_GRACE_MS = 60_000;
/**
 * A dropped socket is usually a reload or a flaky network: a running game with too few connected
 * players waits this long for someone to come back before it is abandoned.
 */
export const LOW_PLAYERS_GRACE_MS = 10_000;
/** How long an empty room is kept alive before it is deleted. */
export const EMPTY_ROOM_TTL_MS = 60_000;

export const MAX_WS_MESSAGE_BYTES = 64 * 1024;

/** Chat rate limit: at most CHAT_RATE_LIMIT_COUNT messages per CHAT_RATE_LIMIT_WINDOW_MS. */
export const CHAT_RATE_LIMIT_COUNT = 6;
export const CHAT_RATE_LIMIT_WINDOW_MS = 4000;
