/**
 * Skribble constants shared by the server and the client. The canvas size and caps are the
 * platform's (shared/platform/canvas.ts) and re-exported here for Skribble's own imports.
 */
export { CANVAS_HEIGHT, CANVAS_WIDTH, MAX_ACTIONS_PER_TURN, MAX_CANVAS_RESYNC_BYTES, MAX_POINTS_PER_STROKE, MAX_POINTS_PER_TURN } from '../../platform/canvas.js';

/** Seconds the drawer has to pick a word before one is auto-picked. */
export const CHOOSE_TIME_SECONDS = 15;
/** Seconds the "turn over" summary is shown before the next turn starts. */
export const TURN_END_SECONDS = 6;

/**
 * How long we wait for a disconnected drawer (or the last unsolved guesser) to come back before
 * the turn moves on: long enough for a reconnect after hosting cut the socket, short enough that
 * the guessers are not left staring at a frozen canvas.
 */
export const DRAWER_DISCONNECT_GRACE_MS = 20_000;

export const BRUSH_SIZES = [3, 6, 12, 20, 32] as const;

/** Drawing palette (skribbl-style). Any #rrggbb colour is accepted by the server; these are the presets. */
export const PALETTE: readonly string[] = [
  '#000000', '#ffffff', '#7f7f7f', '#c3c3c3', '#ed1c24', '#ff7f27',
  '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#b97a57',
  '#880015', '#f58b8b', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d',
  '#99d9ea', '#7092be', '#c8bfe7', '#5a2e0c', '#ff6fd8', '#00e5b4',
];
