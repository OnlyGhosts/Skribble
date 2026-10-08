/**
 * Skribble's server module: the turn/guess/hint rules as a pure reducer over SkribbleData, plus the
 * canvas side store (drawing never goes through the reducer; see canvas.ts).
 */
import {
  DEFAULT_SKRIBBLE_SETTINGS,
  SKRIBBLE_SIDE_MESSAGE_TYPES,
  normalizeSkribbleSettings,
  skribbleClientMessageSchema,
  skribbleSettingsSchema,
  type SkribbleClientMessage,
  type SkribbleServerMessage,
  type SkribbleSettings,
  type SkribbleView,
} from '../../../shared/games/skribble/protocol.js';
import { DRAWER_DISCONNECT_GRACE_MS } from '../../../shared/games/skribble/constants.js';
import { gameById } from '../../../shared/platform/games.js';
import { defineSettings, withDraft, type GameEvent, type GameResult, type GameServerModule } from '../../platform/game.js';
import { createCanvasStore } from './canvas.js';
import { chat } from './chat.js';
import { everyoneGuessed, findPlayer, isDrawer, type Ctx, type SkribbleData } from './state.js';
import { beginNextTurn, chooseTimedOut, chooseWord, endTurn, rate, resumeHeldTurn, revealHint, snapshot, systemMessageForDrawerGone, type Gx } from './turns.js';
import { viewFor } from './view.js';

type Result = GameResult<SkribbleData, SkribbleServerMessage>;

function start(ctx: Ctx): Result {
  // The seed phase is an empty summary: the first turn boundary is then held like any other
  // should too few players be connected (the platform starts a game only with enough, so in
  // practice the first turn begins at once).
  const initial: SkribbleData = {
    phase: { kind: 'turnEnd', reason: 'noWordChosen', endsAt: ctx.now, points: {}, held: false },
    turn: null,
    canvasId: '',
    round: 1,
    turnQueue: ctx.players.filter((p) => p.connected).map((p) => p.id),
    turnIndex: -1,
    usedWords: [],
    grace: { drawerGoneAt: null, allGuessedAt: null },
  };
  return withDraft(initial, (data, effects) => beginNextTurn({ ctx, data, effects }));
}

function handle(ctx: Ctx, data: SkribbleData, event: GameEvent<SkribbleClientMessage>): Result {
  return withDraft(data, (draft, effects) => {
    const gx: Gx = { ctx, data: draft, effects };
    switch (event.type) {
      case 'message':
        return onMessage(gx, event.playerId, event.msg);
      case 'chat':
        if (chat(gx, event.playerId, event.text)) effects.push({ type: 'chatHandled' });
        return;
      case 'playerJoined':
        draft.turnQueue.push(event.playerId);
        if (draft.phase.kind === 'drawing' && draft.turn) draft.turn.guesserIds.push(event.playerId);
        return resumeHeldTurn(gx);
      case 'playerLeft':
        return onPlayerLeft(gx, event.playerId);
      case 'playerDisconnected':
        return onPlayerDisconnected(gx, event.playerId);
      case 'playerReconnected':
        return onPlayerReconnected(gx, event.playerId);
      case 'tick':
        return onTick(gx);
    }
  });
}

function onMessage(gx: Gx, playerId: string, msg: SkribbleClientMessage): void {
  switch (msg.t) {
    case 'chooseWord':
      return chooseWord(gx, playerId, msg.index);
    case 'rate':
      return rate(gx, playerId, msg.value);
    case 'draw':
    case 'undo':
    case 'clear':
      // Side messages reach the canvas store, never the reducer.
      return;
  }
}

function onPlayerLeft(gx: Gx, playerId: string): void {
  const { data } = gx;
  const queued = data.turnQueue.indexOf(playerId);
  if (queued > data.turnIndex) data.turnQueue.splice(queued, 1);
  // Their guess still counts for the drawer (turn.correct / guesserIds); the summary and the rating tally forget them.
  if (data.turn) {
    delete data.turn.points[playerId];
    delete data.turn.ratings[playerId];
  }
  if (isDrawer(data, playerId) && (data.phase.kind === 'choosing' || data.phase.kind === 'drawing')) return endTurn(gx, 'drawerLeft');
  if (data.phase.kind === 'drawing' && everyoneGuessed(gx.ctx, data)) return endTurn(gx, 'allGuessed');
  // A held boundary no longer waits for a seat that emptied (the platform aborts when too few remain).
  resumeHeldTurn(gx);
}

function onPlayerDisconnected(gx: Gx, playerId: string): void {
  const { data, ctx } = gx;
  const grace = ctx.now + DRAWER_DISCONNECT_GRACE_MS;
  if (isDrawer(data, playerId) && (data.phase.kind === 'choosing' || data.phase.kind === 'drawing')) data.grace.drawerGoneAt = grace;
  // The last unsolved guesser gets the same grace before "everyone guessed" ends the turn.
  if (data.phase.kind === 'drawing' && everyoneGuessed(ctx, data) && data.grace.allGuessedAt === null) data.grace.allGuessedAt = grace;
  // One more player to wait for: the hold's missing list grows.
  resumeHeldTurn(gx);
}

function onPlayerReconnected(gx: Gx, playerId: string): void {
  const { data } = gx;
  if (isDrawer(data, playerId)) data.grace.drawerGoneAt = null;
  if (data.phase.kind === 'drawing' && data.turn && data.turn.drawerId !== playerId && !data.turn.guesserIds.includes(playerId)) {
    data.turn.guesserIds.push(playerId);
  }
  // Only a skipped drawer is missing from the round's queue: they draw at its end rather than losing the round.
  if (data.phase.kind !== 'gameOver' && !data.turnQueue.includes(playerId)) {
    data.turnQueue.push(playerId);
    snapshot(gx);
  }
  resumeHeldTurn(gx);
}

type Deadline = { kind: 'choose' | 'hint' | 'drawEnd' | 'turnEnd' | 'drawerGone' | 'allGuessed'; at: number };

/** Pending deadlines in tie-break order: the phase's own first, then the grace periods. */
function deadlines(data: SkribbleData): Deadline[] {
  const out: Deadline[] = [];
  const { phase, turn, grace } = data;
  if (phase.kind === 'choosing') out.push({ kind: 'choose', at: phase.endsAt });
  if (phase.kind === 'drawing' && turn) {
    const nextHint = turn.revealAt[turn.revealed.length];
    if (nextHint !== undefined) out.push({ kind: 'hint', at: nextHint });
    out.push({ kind: 'drawEnd', at: turn.endsAt });
  }
  if (phase.kind === 'turnEnd' && !phase.held) out.push({ kind: 'turnEnd', at: phase.endsAt });
  if (grace.drawerGoneAt !== null) out.push({ kind: 'drawerGone', at: grace.drawerGoneAt });
  if (grace.allGuessedAt !== null) out.push({ kind: 'allGuessed', at: grace.allGuessedAt });
  return out;
}

function nextDeadline(data: SkribbleData): number | null {
  let best: number | null = null;
  for (const d of deadlines(data)) if (best === null || d.at < best) best = d.at;
  return best;
}

/** The earliest deadline that is due (first in tie-break order among equals), or null. */
function earliestDue(gx: Gx): Deadline | null {
  let due: Deadline | null = null;
  for (const d of deadlines(gx.data)) if (d.at <= gx.ctx.now && (!due || d.at < due.at)) due = d;
  return due;
}

/**
 * Resolves every deadline that is due. Several can share an instant (a hint and the drawer's
 * grace, say), and the platform expects each one it reported to be gone after the tick.
 */
function onTick(gx: Gx): void {
  let due = earliestDue(gx);
  while (due) {
    fireDeadline(gx, due);
    const next = earliestDue(gx);
    // A handler that left its own deadline in place would spin here; hand it back to the platform, which reports it.
    if (next && next.kind === due.kind && next.at === due.at) return;
    due = next;
  }
}

function fireDeadline(gx: Gx, due: Deadline): void {
  const { data, ctx } = gx;
  switch (due.kind) {
    case 'choose':
      return chooseTimedOut(gx);
    case 'hint':
      return revealHint(gx);
    case 'drawEnd':
      return endTurn(gx, 'timeUp');
    case 'turnEnd':
      return beginNextTurn(gx);
    case 'drawerGone':
      data.grace.drawerGoneAt = null;
      systemMessageForDrawerGone(gx);
      return endTurn(gx, 'drawerLeft');
    case 'allGuessed':
      data.grace.allGuessedAt = null;
      if (data.phase.kind === 'drawing' && everyoneGuessed(ctx, data)) endTurn(gx, 'allGuessed');
      return;
  }
}

export const skribbleModule: GameServerModule<SkribbleSettings, SkribbleData, SkribbleView, SkribbleClientMessage, SkribbleServerMessage> = {
  meta: gameById('skribble'),
  settings: defineSettings(skribbleSettingsSchema, DEFAULT_SKRIBBLE_SETTINGS, normalizeSkribbleSettings),
  clientMessageSchema: skribbleClientMessageSchema,
  start,
  handle,
  nextDeadline,
  view: viewFor,
  sideMessages: SKRIBBLE_SIDE_MESSAGE_TYPES,
  createSideStore: createCanvasStore,
};

export { findPlayer };
