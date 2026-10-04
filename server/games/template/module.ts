/**
 * Click Race: the template game module. Copy this folder to start a new game. A module is a pure
 * reducer: `start` builds the initial state, `handle` folds one event into it and returns the
 * next state plus effects, `nextDeadline` tells the platform when to tick, `view` renders what
 * one player may see. The platform owns everything else (seats, chat, scores, podium, lobby).
 */
import {
  DEFAULT_TEMPLATE_SETTINGS,
  templateClientMessageSchema,
  templateSettingsSchema,
  type TemplateClientMessage,
  type TemplateServerMessage,
  type TemplateSettings,
  type TemplateView,
} from '../../../shared/games/template/protocol.js';
import { gameById } from '../../../shared/platform/games.js';
import { defineSettings, type GameCtx, type GameEffect, type GameEvent, type GameResult, type GameServerModule } from '../../platform/game.js';

/** JSON-safe game state: everything the race needs, nothing about seats or scores. */
export interface TemplateData {
  clicks: Record<string, number>;
  endsAt: number;
  winnerId: string | null;
  over: boolean;
}

type Result = GameResult<TemplateData, TemplateServerMessage>;
type Effect = GameEffect<TemplateServerMessage>;

const WIN_BONUS = 100;

function start(ctx: GameCtx<TemplateSettings>): Result {
  const clicks: Record<string, number> = {};
  for (const p of ctx.players) clicks[p.id] = 0;
  return { data: { clicks, endsAt: ctx.now + ctx.settings.timeLimit * 1000, winnerId: null, over: false }, effects: [{ type: 'snapshot', to: 'all' }] };
}

function handle(ctx: GameCtx<TemplateSettings>, data: TemplateData, event: GameEvent<TemplateClientMessage>): Result {
  if (data.over) return { data, effects: [] };
  switch (event.type) {
    case 'message':
      return click(ctx, data, event.playerId);
    case 'playerJoined':
      return { data: { ...data, clicks: { ...data.clicks, [event.playerId]: 0 } }, effects: [{ type: 'snapshot', to: 'all' }] };
    case 'tick':
      return ctx.now >= data.endsAt ? finish(ctx, data, null) : { data, effects: [] };
    default:
      // Chat, leaves and reconnects need no reaction: the platform already handles them.
      return { data, effects: [] };
  }
}

function click(ctx: GameCtx<TemplateSettings>, data: TemplateData, playerId: string): Result {
  const count = (data.clicks[playerId] ?? 0) + 1;
  const next: TemplateData = { ...data, clicks: { ...data.clicks, [playerId]: count } };
  if (count >= ctx.settings.targetClicks) return finish(ctx, next, playerId);
  return { data: next, effects: [{ type: 'snapshot', to: 'all' }] };
}

/** Ends the race: the winner (if any) takes the bonus, everyone else scores their clicks; the platform builds the podium. */
function finish(ctx: GameCtx<TemplateSettings>, data: TemplateData, winnerId: string | null): Result {
  const effects: Effect[] = [];
  for (const p of ctx.players) {
    const delta = p.id === winnerId ? WIN_BONUS : (data.clicks[p.id] ?? 0);
    if (delta > 0) effects.push({ type: 'score', playerId: p.id, delta });
  }
  effects.push({ type: 'gameOver' });
  return { data: { ...data, winnerId, over: true }, effects };
}

function nextDeadline(data: TemplateData): number | null {
  return data.over ? null : data.endsAt;
}

function view(data: TemplateData): TemplateView {
  return { clicks: { ...data.clicks }, endsAt: data.endsAt, winnerId: data.winnerId };
}

export const templateModule: GameServerModule<TemplateSettings, TemplateData, TemplateView, TemplateClientMessage, TemplateServerMessage> = {
  meta: gameById('template'),
  settings: defineSettings(templateSettingsSchema, DEFAULT_TEMPLATE_SETTINGS),
  clientMessageSchema: templateClientMessageSchema,
  start,
  handle,
  nextDeadline,
  view,
};
