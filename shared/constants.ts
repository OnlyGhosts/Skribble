/**
 * Shared constants used by both the server and the client.
 * The logical canvas is a fixed size; clients scale it to fit their viewport
 * and always send/receive coordinates in this logical space.
 */
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;

export const MIN_PLAYERS_TO_START = 2;

export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 16;
export const CHAT_MAX_LENGTH = 120;
export const CHAT_HISTORY_LENGTH = 60;

/** Seconds the drawer has to pick a word before one is auto-picked. */
export const CHOOSE_TIME_SECONDS = 15;
/** Seconds the "turn over" summary is shown before the next turn starts. */
export const TURN_END_SECONDS = 6;

/** How long a disconnected player keeps their seat (and score) before being removed. */
export const RECONNECT_GRACE_MS = 60_000;
/** How long we wait for a disconnected drawer to come back before ending the turn. */
export const DRAWER_DISCONNECT_GRACE_MS = 10_000;
/** How long an empty room is kept alive before it is deleted. */
export const EMPTY_ROOM_TTL_MS = 60_000;

/** Caps that bound memory per room. */
export const MAX_ACTIONS_PER_TURN = 3000;
export const MAX_POINTS_PER_STROKE = 6000;
export const MAX_WS_MESSAGE_BYTES = 64 * 1024;

/** Chat rate limit: at most CHAT_RATE_LIMIT_COUNT messages per CHAT_RATE_LIMIT_WINDOW_MS. */
export const CHAT_RATE_LIMIT_COUNT = 6;
export const CHAT_RATE_LIMIT_WINDOW_MS = 4000;

export const BRUSH_SIZES = [3, 6, 12, 20, 32] as const;

/** Drawing palette (skribbl-style). Any #rrggbb colour is accepted by the server; these are the presets. */
export const PALETTE: readonly string[] = [
  '#000000', '#ffffff', '#7f7f7f', '#c3c3c3', '#ed1c24', '#ff7f27',
  '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#b97a57',
  '#880015', '#f58b8b', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d',
  '#99d9ea', '#7092be', '#c8bfe7', '#5a2e0c', '#ff6fd8', '#00e5b4',
];
