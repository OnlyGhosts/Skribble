/** Lobby actions (settings, profile, start, back to lobby) and drawing ratings. */
import type { Avatar } from '../../shared/avatar.js';
import { MIN_PLAYERS_TO_START } from '../../shared/constants.js';
import { applySettingsPatch, type RoomSettingsPatch } from '../../shared/settings.js';
import { broadcastSnapshot, fail, requireHost, requirePhase, systemMessage, type Cx } from './messaging.js';
import { connectedCount, findPlayer, sortedPlayers } from './players.js';
import type { Rating } from './state.js';
import { beginNextTurn, resetForGame, resetToLobby } from './turns.js';

export function updateSettings(cx: Cx, playerId: string, patch: RoomSettingsPatch): void {
  if (!requireHost(cx, playerId) || !requirePhase(cx, playerId, 'lobby', 'Settings can only be changed in the lobby.')) return;
  const next = applySettingsPatch(cx.data.settings, patch);
  // Never let the room shrink below the people already in it.
  next.maxPlayers = Math.max(next.maxPlayers, cx.data.players.length);
  cx.data.settings = next;
  broadcastSnapshot(cx);
}

export function updateProfile(cx: Cx, playerId: string, name: string | undefined, avatar: Avatar | undefined): void {
  if (!requirePhase(cx, playerId, 'lobby', 'You can only change your profile in the lobby.')) return;
  const player = findPlayer(cx.data, playerId);
  if (!player) return;
  if (name !== undefined) player.name = name;
  if (avatar !== undefined) player.avatar = { ...avatar };
  broadcastSnapshot(cx);
}

export function start(cx: Cx, playerId: string): void {
  const { data } = cx;
  if (!requireHost(cx, playerId) || !requirePhase(cx, playerId, 'lobby', 'The game has already started.')) return;
  if (connectedCount(data) < MIN_PLAYERS_TO_START) {
    return fail(cx, playerId, 'NOT_ALLOWED', `You need at least ${MIN_PLAYERS_TO_START} connected players to start.`);
  }
  for (const p of data.players) resetForGame(p);
  data.usedWords = [];
  data.votes = [];
  data.round = 1;
  data.turnQueue = sortedPlayers(data)
    .filter((p) => p.connected)
    .map((p) => p.id);
  data.turnIndex = -1;
  systemMessage(cx, 'The game has started!');
  beginNextTurn(cx);
}

export function returnToLobby(cx: Cx, playerId: string): void {
  if (!requireHost(cx, playerId) || !requirePhase(cx, playerId, 'gameEnd', 'You can only return to the lobby after the game ends.')) return;
  resetToLobby(cx);
}

export function rate(cx: Cx, playerId: string, value: Rating): void {
  const { data } = cx;
  if (data.phase.kind !== 'drawing' || !data.turn) return fail(cx, playerId, 'NOT_ALLOWED', 'There is nothing to rate right now.');
  if (data.turn.drawerId === playerId) return fail(cx, playerId, 'NOT_ALLOWED', "You can't rate your own drawing.");
  const player = findPlayer(data, playerId);
  if (!player) return;
  player.rating = player.rating === value ? null : value;
  broadcastSnapshot(cx);
}
