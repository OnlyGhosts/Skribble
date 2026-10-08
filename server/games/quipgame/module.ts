/**
 * Quip Game's server module: two writing-and-voting rounds and an optional ranked final as a pure
 * reducer over QuipgameData. Players answer prompts on their phones, the room votes between two
 * anonymous answers at a time, and the points follow the votes.
 */
import {
  DEFAULT_QUIPGAME_SETTINGS,
  QUIPGAME_REGULAR_ROUNDS,
  normalizeQuipgameSettings,
  quipgameClientMessageSchema,
  quipgameSettingsSchema,
  type QuipgameClientMessage,
  type QuipgameServerMessage,
  type QuipgameSettings,
  type QuipgameView,
} from '../../../shared/games/quipgame/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defineSettings, withDraft, type GameEvent, type GameResult, type GameServerModule } from '../../platform/game.js';
import { forgetRanker, rank, replaceFinalAnnouncer, resolveFinal, resolveIfRanked } from './final.js';
import { advance, allWritten, answer, beginRound, finishWriting, next, resumeIfHeld, settleDue } from './round.js';
import { snapshot, type Ctx, type Gx, type QuipgameData } from './state.js';
import { forgetVoter, replaceAnnouncer, resolveIfComplete, resolveMatchup, vote } from './vote.js';
import { viewFor } from './view.js';

type Result = GameResult<QuipgameData, QuipgameServerMessage>;

function start(ctx: Ctx): Result {
  // The seed sits "between rounds" so beginRound starts round one like any other.
  const seed: QuipgameData = {
    phase: 'result',
    resumeAt: null,
    round: 0,
    totalRounds: QUIPGAME_REGULAR_ROUNDS + (ctx.settings.finalRound ? 1 : 0),
    roundPlayers: [],
    prompts: [],
    answers: [],
    matchups: [],
    matchupIndex: 0,
    endsAt: 0,
    usedPrompts: [],
    announcerCursor: 0,
    final: null,
  };
  return withDraft(seed, (data, effects) => beginRound({ ctx, data, effects }));
}

function handle(ctx: Ctx, data: QuipgameData, event: GameEvent<QuipgameClientMessage>): Result {
  if (data.phase === 'over') return { data, effects: [] };
  return withDraft(data, (draft, effects) => {
    const gx: Gx = { ctx, data: draft, effects };
    switch (event.type) {
      case 'message':
        return onMessage(gx, event.playerId, event.msg);
      case 'playerLeft':
      case 'playerDisconnected':
        return onPlayerAway(gx, event.playerId, event.type === 'playerLeft');
      case 'tick':
        return onTick(gx);
      case 'playerJoined':
      case 'playerReconnected':
        // A mid-round joiner spectates (they are not among the round's players) and a returning player
        // simply resumes with the next snapshot; between rounds, either may end a hold.
        return resumeIfHeld(gx);
      case 'chat':
        // Chat is just chat.
        return;
    }
  });
}

function onMessage(gx: Gx, playerId: string, msg: QuipgameClientMessage): void {
  switch (msg.t) {
    case 'answer':
      return answer(gx, playerId, msg.promptId, msg.text);
    case 'vote':
      return vote(gx, playerId, msg.choice);
    case 'rank':
      return rank(gx, playerId, msg.answerIds);
    case 'next':
      return next(gx, playerId);
  }
}

/**
 * A socket dropped or a seat emptied: whoever everyone was waiting for may be gone, so re-check the
 * phase. A vote or ranking from a seat that emptied (left, kicked, grace expired) is withdrawn first:
 * only people still in the room decide the points. A dropped socket alone changes nothing about
 * who is waited for: the player keeps their seat, and their vote stays open until the deadline.
 */
function onPlayerAway(gx: Gx, playerId: string, left: boolean): void {
  const { data } = gx;
  if (left) {
    forgetVoter(gx, playerId);
    forgetRanker(gx, playerId);
  }
  switch (data.phase) {
    case 'writing':
    case 'finalWriting':
      // Disconnected writers get until the deadline to come back; a seat that emptied cannot hold the round up.
      if (left && allWritten(gx)) finishWriting(gx, 'everyoneIn');
      return;
    case 'voting':
      if (left && resolveIfComplete(gx)) return;
      if (replaceAnnouncer(gx, playerId)) snapshot(gx);
      return;
    case 'finalVoting':
      if (left && resolveIfRanked(gx)) return;
      if (replaceFinalAnnouncer(gx, playerId)) snapshot(gx);
      return;
    case 'waiting':
      // The missing list changed (one more away, or a seat emptied); the platform aborts when too few remain.
      return resumeIfHeld(gx);
    case 'result':
    case 'finalResult':
    case 'over':
      return;
  }
}

function onTick(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase === 'waiting') return settleDue(gx);
  if (ctx.now < data.endsAt) return;
  switch (data.phase) {
    case 'writing':
    case 'finalWriting':
      return finishWriting(gx, 'timeUp');
    case 'voting':
      return resolveMatchup(gx);
    case 'finalVoting':
      return resolveFinal(gx);
    case 'result':
    case 'finalResult':
      return advance(gx);
    case 'over':
      return;
  }
}

function nextDeadline(data: QuipgameData): number | null {
  if (data.phase === 'over') return null;
  return data.phase === 'waiting' ? data.resumeAt : data.endsAt;
}

export const quipgameModule: GameServerModule<QuipgameSettings, QuipgameData, QuipgameView, QuipgameClientMessage, QuipgameServerMessage> = {
  meta: gameById('quipgame'),
  settings: defineSettings(quipgameSettingsSchema, DEFAULT_QUIPGAME_SETTINGS, normalizeQuipgameSettings),
  clientMessageSchema: quipgameClientMessageSchema,
  start,
  handle,
  nextDeadline,
  view: viewFor,
};

export type { QuipgameData };
