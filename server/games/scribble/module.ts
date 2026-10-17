/**
 * Scribble's server module: the turn/guess/hint rules as a pure reducer over ScribbleData, plus the
 * canvas side store (drawing never goes through the reducer; see canvas.ts).
 */
import {
  DEFAULT_SCRIBBLE_SETTINGS,
  SCRIBBLE_SIDE_MESSAGE_TYPES,
  normalizeScribbleSettings,
  scribbleClientMessageSchema,
  scribbleSettingsSchema,
  type ScribbleClientMessage,
  type ScribbleServerMessage,
  type ScribbleSettings,
  type ScribbleView,
} from '../../../shared/games/scribble/protocol.js';
import { DRAWER_DISCONNECT_GRACE_MS } from '../../../shared/games/scribble/constants.js';
import { gameById } from '../../../shared/platform/games.js';
import { defineSettings, withDraft, type GameEvent, type GameResult, type GameServerModule } from '../../platform/game.js';
import { createScribbleCanvasStore } from './canvas.js';
import { chat } from './chat.js';
import { everyoneGuessed, findPlayer, isDrawer, type Ctx, type ScribbleData } from './state.js';
import { beginNextTurn, chooseTimedOut, chooseWord, endTurn, rate, restartTurn, resumeHeldTurn, revealHint, snapshot, systemMessageForDrawerGone, type Gx } from './turns.js';
import { viewFor } from './view.js';

type Result = GameResult<ScribbleData, ScribbleServerMessage>;

function start(ctx: Ctx): Result {
  // The seed phase is an empty summary: the first turn boundary is then held like any other
  // should too few players be connected (the platform starts a game only with enough, so in
  // practice the first turn begins at once).
  const initial: ScribbleData = {
    startedAt: ctx.now,
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

function handle(ctx: Ctx, data: ScribbleData, event: GameEvent<ScribbleClientMessage>): Result {
  return withDraft(data, (draft, effects) => {
    const gx: Gx = { ctx, data: draft, effects };
    switch (event.type) {
      case 'message':
        return onMessage(gx, event.playerId, event.msg);
      case 'chat':
        if (chat(gx, event.playerId, event.text)) effects.push({ type: 'chatHandled' });
        return;
      case 'playerLeft':
        return onPlayerLeft(gx, event.playerId);
      case 'playerDisconnected':
        // A spectator's socket is none of the turn's business: they neither draw nor guess.
        if (findPlayer(ctx, event.playerId)) onPlayerDisconnected(gx, event.playerId);
        return;
      case 'playerReconnected':
        if (findPlayer(ctx, event.playerId)) onPlayerReconnected(gx, event.playerId);
        return;
      case 'tick':
        return onTick(gx);
    }
  });
}

function onMessage(gx: Gx, playerId: string, msg: ScribbleClientMessage): void {
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
  // A spectator leaving changes nothing about the turn (a held boundary still re-checks its list).
  if (!wasParticipant(data, playerId)) return resumeHeldTurn(gx);
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

/** The platform has already dropped a leaver from ctx.players: the turn's own records say whether they played. */
function wasParticipant(data: ScribbleData, playerId: string): boolean {
  return data.turnQueue.includes(playerId) || data.turn?.drawerId === playerId || data.turn?.guesserIds.includes(playerId) === true;
}

type Deadline = { kind: 'choose' | 'hint' | 'drawEnd' | 'turnEnd' | 'drawerGone' | 'allGuessed'; at: number };

/** Pending deadlines in tie-break order: the phase's own first, then the grace periods. */
function deadlines(data: ScribbleData): Deadline[] {
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

function nextDeadline(data: ScribbleData): number | null {
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

export const scribbleModule: GameServerModule<ScribbleSettings, ScribbleData, ScribbleView, ScribbleClientMessage, ScribbleServerMessage> = {
  meta: gameById('scribble'),
  settings: defineSettings(scribbleSettingsSchema, DEFAULT_SCRIBBLE_SETTINGS, normalizeScribbleSettings),
  clientMessageSchema: scribbleClientMessageSchema,
  start,
  handle,
  nextDeadline,
  view: viewFor,
  sideMessages: SCRIBBLE_SIDE_MESSAGE_TYPES,
  createSideStore: createScribbleCanvasStore,
  milestone: (data) => `${data.round}:${data.turnIndex}:${data.phase.kind}`,
  // The canvas is not in the checkpoint: a turn caught mid-way starts over.
  restored: (ctx, data) => withDraft(data, (draft, effects) => restartTurn({ ctx, data: draft, effects })),
};

export { findPlayer };
