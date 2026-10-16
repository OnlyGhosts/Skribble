/**
 * The Spy Game's server module: one spy per round, a shared clock, the spy's two guesses and the
 * agents' accusation votes as a pure reducer over SpygameData. Questions are asked out loud in the
 * room; the server only knows roles, the clock, guesses and votes.
 */
import {
  DEFAULT_SPYGAME_SETTINGS,
  spygameClientMessageSchema,
  spygameSettingsSchema,
  type SpygameClientMessage,
  type SpygameServerMessage,
  type SpygameSettings,
  type SpygameView,
} from '../../../shared/games/spygame/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defineSettings, withDraft, type GameEvent, type GameResult, type GameServerModule } from '../../platform/game.js';
import { advance, beginRound, endRound, guess, nextRound, resumeIfHeld, settleDue, spyAwayDeadline, spyCameBack, spyWentAway } from './round.js';
import { snapshot, type Ctx, type Gx, type SpygameData } from './state.js';
import { accuse, resolveVote, vote, voterLeft } from './vote.js';
import { viewFor } from './view.js';

type Result = GameResult<SpygameData, SpygameServerMessage>;

function start(ctx: Ctx): Result {
  const seed: SpygameData = {
    phase: 'reveal',
    resumeAt: null,
    round: 0,
    current: { spyId: '', spyName: '', locationId: '', candidates: [], playerIds: [], guessesLeft: 0, guessed: [], accusers: [], clock: { kind: 'paused', remainingMs: 0 }, spyAway: false },
    vote: null,
    reveal: null,
    spyHistory: [],
    usedLocationIds: [],
  };
  // The seed only exists so buildRound has a draft to write the rotation into; beginRound replaces `current`.
  return withDraft(seed, (data, effects) => beginRound({ ctx, data, effects }));
}

function handle(ctx: Ctx, data: SpygameData, event: GameEvent<SpygameClientMessage>): Result {
  if (data.phase === 'over') return { data, effects: [] };
  return withDraft(data, (draft, effects) => {
    const gx: Gx = { ctx, data: draft, effects };
    switch (event.type) {
      case 'message':
        return onMessage(gx, event.playerId, event.msg);
      case 'playerLeft':
        return onPlayerLeft(gx, event.playerId);
      case 'playerDisconnected':
        return onPlayerDisconnected(gx, event.playerId);
      case 'playerReconnected':
        return onPlayerReconnected(gx, event.playerId);
      case 'tick':
        return onTick(gx);
      case 'chat':
        // Chat is just chat here.
        return;
    }
  });
}

function onMessage(gx: Gx, playerId: string, msg: SpygameClientMessage): void {
  switch (msg.t) {
    case 'guess':
      return guess(gx, playerId, msg.locationId);
    case 'accuse':
      return accuse(gx, playerId, msg.playerId);
    case 'vote':
      return vote(gx, playerId, msg.yes);
    case 'nextRound':
      return nextRound(gx, playerId);
  }
}

function onPlayerLeft(gx: Gx, playerId: string): void {
  const { data } = gx;
  const { current } = data;
  if (!current.playerIds.includes(playerId)) return;
  current.playerIds = current.playerIds.filter((id) => id !== playerId);
  if (data.phase === 'waiting') return resumeIfHeld(gx);
  if (data.phase !== 'playing' && data.phase !== 'voting') return;
  if (playerId === current.spyId) return endRound(gx, 'spyLeft');
  if (data.phase === 'voting') return voterLeft(gx, playerId);
  snapshot(gx);
}

function onPlayerDisconnected(gx: Gx, playerId: string): void {
  const { data } = gx;
  if (data.phase === 'waiting') return resumeIfHeld(gx);
  if (playerId !== data.current.spyId || data.current.spyAway || (data.phase !== 'playing' && data.phase !== 'voting')) return;
  spyWentAway(gx);
  snapshot(gx);
}

function onPlayerReconnected(gx: Gx, playerId: string): void {
  const { data } = gx;
  if (data.phase === 'waiting') return resumeIfHeld(gx);
  if (playerId !== data.current.spyId || !data.current.spyAway) return;
  spyCameBack(gx);
  snapshot(gx);
}

/** The away spy's time ran out (a room stored before the limit existed never runs out). */
function spyAwayDue(gx: Gx): boolean {
  const due = spyAwayDeadline(gx.data);
  if (due === null || gx.ctx.now < due) return false;
  endRound(gx, 'spyLeft');
  return true;
}

function onTick(gx: Gx): void {
  const { data, ctx } = gx;
  switch (data.phase) {
    case 'playing':
      if (spyAwayDue(gx)) return;
      if (data.current.clock.kind === 'running' && ctx.now >= data.current.clock.endsAt) endRound(gx, 'timeUp');
      return;
    case 'voting':
      if (data.vote && ctx.now >= data.vote.endsAt) resolveVote(gx);
      return;
    case 'reveal':
      if (data.reveal && ctx.now >= data.reveal.endsAt) advance(gx);
      return;
    case 'waiting':
      return settleDue(gx);
    case 'over':
      return;
  }
}

function nextDeadline(data: SpygameData): number | null {
  switch (data.phase) {
    case 'playing':
      return earliest(data.current.clock.kind === 'running' ? data.current.clock.endsAt : null, spyAwayDeadline(data));
    case 'voting':
      return data.vote?.endsAt ?? null;
    case 'reveal':
      return data.reveal?.endsAt ?? null;
    case 'waiting':
      return data.resumeAt;
    case 'over':
      return null;
  }
}

function earliest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  return b === null ? a : Math.min(a, b);
}

export const spygameModule: GameServerModule<SpygameSettings, SpygameData, SpygameView, SpygameClientMessage, SpygameServerMessage> = {
  meta: gameById('spygame'),
  settings: defineSettings(spygameSettingsSchema, DEFAULT_SPYGAME_SETTINGS),
  clientMessageSchema: spygameClientMessageSchema,
  start,
  handle,
  nextDeadline,
  view: viewFor,
  hostMessages: new Set(['nextRound']),
};

export type { SpygameData };
