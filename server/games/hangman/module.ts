/**
 * Hangman's server module: choosing, guessing and drawing as a pure reducer over HangmanData,
 * plus the canvas side store (the figure itself never goes through the reducer; see canvas.ts).
 */
import {
  DEFAULT_HANGMAN_SETTINGS,
  HANGMAN_SIDE_MESSAGE_TYPES,
  hangmanClientMessageSchema,
  hangmanSettingsSchema,
  normalizeHangmanSettings,
  type HangmanClientMessage,
  type HangmanServerMessage,
  type HangmanSettings,
  type HangmanView,
} from '../../../shared/games/hangman/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defineSettings, withDraft, type GameEvent, type GameResult, type GameServerModule } from '../../platform/game.js';
import { createHangmanCanvasStore } from './canvas.js';
import { guessLetter, guessWord } from './guess.js';
import { findPlayer, inTurn, isHangman, snapshot, type Ctx, type Gx, type HangmanData } from './state.js';
import {
  beginNextTurn,
  chooseTimedOut,
  chooseWord,
  customWord,
  drawDone,
  endDrawing,
  endTurn,
  guessTimedOut,
  guesserLeftWhileChoosing,
  nextGuesser,
  pauseForHangman,
  resumeForHangman,
  resumeIfHeld,
  settleDue,
} from './turns.js';
import { viewFor } from './view.js';

type Result = GameResult<HangmanData, HangmanServerMessage>;

function start(ctx: Ctx): Result {
  // The seed is an empty summary, so the first turn boundary is held like any other should too few be connected.
  const seed: HangmanData = {
    phase: { kind: 'turnEnd', endsAt: ctx.now, held: false, resumeAt: null },
    turn: null,
    canvasId: '',
    round: 1,
    roundPlayerIds: ctx.players.map((p) => p.id),
    turnQueue: ctx.players.filter((p) => p.connected).map((p) => p.id),
    turnIndex: -1,
    usedWords: [],
  };
  return withDraft(seed, (data, effects) => beginNextTurn({ ctx, data, effects }));
}

function handle(ctx: Ctx, data: HangmanData, event: GameEvent<HangmanClientMessage>): Result {
  if (data.phase.kind === 'gameOver') return { data, effects: [] };
  return withDraft(data, (draft, effects) => {
    const gx: Gx = { ctx, data: draft, effects };
    switch (event.type) {
      case 'message':
        return onMessage(gx, event.playerId, event.msg);
      case 'chat':
        // Chat is just chat: guesses travel as letter / word messages.
        return;
      case 'playerJoined':
        // A late joiner watches until the next round; between turns they may end a hold.
        snapshot(gx);
        return resumeIfHeld(gx);
      case 'playerLeft':
        return onPlayerLeft(gx, event.playerId);
      case 'playerDisconnected':
        // A spectator's socket is none of the turn's business.
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

function onMessage(gx: Gx, playerId: string, msg: HangmanClientMessage): void {
  switch (msg.t) {
    case 'chooseWord':
      return chooseWord(gx, playerId, msg.index);
    case 'customWord':
      return customWord(gx, playerId, msg.text);
    case 'letter':
      return guessLetter(gx, playerId, msg.letter);
    case 'word':
      return guessWord(gx, playerId, msg.text);
    case 'drawDone':
      return drawDone(gx, playerId);
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
  if (isHangman(data, playerId) && inTurn(data)) return endTurn(gx, { kind: 'hangmanLeft' });
  if (data.phase.kind === 'choosing') return guesserLeftWhileChoosing(gx);
  // The current guesser (or the last one a paused guess waits for) is gone: the rotation moves on.
  if (data.phase.kind === 'guessing' && (data.turn?.guesserId === playerId || data.phase.clock.kind === 'paused')) return nextGuesser(gx);
  resumeIfHeld(gx);
}

function onPlayerDisconnected(gx: Gx, playerId: string): void {
  const { data, ctx } = gx;
  const player = findPlayer(ctx, playerId);
  if (player && isHangman(data, playerId) && (data.phase.kind === 'choosing' || data.phase.kind === 'drawing')) return pauseForHangman(gx, player);
  // The current guesser is skipped; a paused guess refreshes its missing list.
  if (data.phase.kind === 'guessing' && (data.turn?.guesserId === playerId || data.phase.clock.kind === 'paused')) return nextGuesser(gx);
  resumeIfHeld(gx);
}

function onPlayerReconnected(gx: Gx, playerId: string): void {
  const { data } = gx;
  // Only a skipped hangman is missing from the round's queue: they get their turn at its end rather than losing the round.
  if (data.roundPlayerIds.includes(playerId) && !data.turnQueue.includes(playerId)) {
    data.turnQueue.push(playerId);
    snapshot(gx);
  }
  // The hangman of the turn that just ended is still data.turn.hangmanId at the summary: their
  // return must reach the held boundary too, so neither branch returns early.
  if (isHangman(data, playerId)) resumeForHangman(gx);
  else if (data.phase.kind === 'guessing' && data.phase.clock.kind === 'paused') nextGuesser(gx);
  resumeIfHeld(gx);
}

function onTick(gx: Gx): void {
  const { data, ctx } = gx;
  const due = nextDeadline(data);
  if (due === null || ctx.now < due) return;
  switch (data.phase.kind) {
    case 'choosing':
      return chooseTimedOut(gx);
    case 'guessing':
      return guessTimedOut(gx);
    case 'drawing':
      return endDrawing(gx);
    case 'turnEnd':
      return data.phase.held ? settleDue(gx) : beginNextTurn(gx);
    case 'gameOver':
      return;
  }
}

function nextDeadline(data: HangmanData): number | null {
  switch (data.phase.kind) {
    case 'choosing':
    case 'guessing':
    case 'drawing':
      return data.phase.clock.kind === 'running' ? data.phase.clock.endsAt : null;
    case 'turnEnd':
      return data.phase.held ? data.phase.resumeAt : data.phase.endsAt;
    case 'gameOver':
      return null;
  }
}

export const hangmanModule: GameServerModule<HangmanSettings, HangmanData, HangmanView, HangmanClientMessage, HangmanServerMessage> = {
  meta: gameById('hangman'),
  settings: defineSettings(hangmanSettingsSchema, DEFAULT_HANGMAN_SETTINGS, normalizeHangmanSettings),
  clientMessageSchema: hangmanClientMessageSchema,
  start,
  handle,
  nextDeadline,
  view: viewFor,
  sideMessages: HANGMAN_SIDE_MESSAGE_TYPES,
  createSideStore: createHangmanCanvasStore,
};

export type { HangmanData };
