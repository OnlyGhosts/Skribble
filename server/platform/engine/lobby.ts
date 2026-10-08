/** Lobby actions (settings, profile, start, back to lobby) and the game-over transition. */
import type { Avatar } from '../../../shared/platform/avatar.js';
import { gameById } from '../../../shared/platform/games.js';
import type { PodiumEntry } from '../../../shared/platform/protocol.js';
import { clampMaxPlayers, platformSettingsPatchSchema } from '../../../shared/platform/settings.js';
import { applyGameResult, gameCtx } from './delegate.js';
import { broadcastSnapshot, fail, requireHost, requirePhase, systemMessage, type Cx } from './messaging.js';
import { moduleFor } from './module.js';
import { connectedCount, findPlayer, hasEnoughSeated, minPlayers } from './players.js';
import type { RoomSettingsData } from './state.js';

export function updateSettings(cx: Cx, playerId: string, patch: Record<string, unknown>): void {
  if (!requireHost(cx, playerId) || !requirePhase(cx, playerId, 'lobby', 'Settings can only be changed in the lobby.')) return;
  const { data } = cx;
  const game = moduleFor(data.gameId);
  const platform = platformSettingsPatchSchema.safeParse(patch);
  const own = game.settings.patchSchema.safeParse(patch);
  const issue = !platform.success ? platform.error.issues[0] : !own.success ? own.error.issues[0] : undefined;
  if (!platform.success || !own.success) {
    return fail(cx, playerId, 'INVALID_MESSAGE', `Invalid settings${issue ? ` at ${issue.path.join('.')}: ${issue.message}` : ''}`);
  }
  const merged: RoomSettingsData = { ...data.settings, ...platform.data, ...(own.data as Record<string, unknown>) };
  const normalized = game.settings.normalize ? (game.settings.normalize(merged) as Record<string, unknown>) : {};
  const next: RoomSettingsData = { ...merged, ...normalized };
  next.maxPlayers = clampMaxPlayers(next.maxPlayers, gameById(data.gameId), data.players.length);
  data.settings = next;
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
  const needed = minPlayers(data);
  if (connectedCount(data) < needed) {
    return fail(cx, playerId, 'NOT_ALLOWED', `You need at least ${needed} connected player${needed === 1 ? '' : 's'} to start.`);
  }
  for (const p of data.players) p.score = 0;
  data.votes = [];
  data.podium = null;
  data.phase = 'playing';
  systemMessage(cx, 'The game has started!');
  const game = moduleFor(data.gameId);
  const applied = applyGameResult(cx, game.start(gameCtx(cx)));
  // A game that announced nothing still needs everyone to see the new phase.
  if (!applied.snapshotted && data.phase === 'playing') broadcastSnapshot(cx);
}

export function returnToLobby(cx: Cx, playerId: string): void {
  if (!requireHost(cx, playerId) || !requirePhase(cx, playerId, 'ended', 'You can only return to the lobby after the game ends.')) return;
  resetToLobby(cx);
}

/** "Alice", "Alice and Bob", "Alice, Bob and Carol". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function podiumOf(players: Array<{ id: string; score: number; joinOrder: number }>): PodiumEntry[] {
  const ranked = [...players].sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
  return ranked.map((p) => ({ playerId: p.id, score: p.score, rank: 1 + ranked.filter((o) => o.score > p.score).length }));
}

/** The game declared itself over: rank everyone, announce the result and keep the room on the podium until the host returns to the lobby. */
export function finishGame(cx: Cx): void {
  const { data } = cx;
  data.waiting = null;
  data.podium = podiumOf(data.players);
  data.phase = 'ended';
  const top = data.podium[0]?.score;
  const winners = data.podium.filter((e) => e.score === top).map((e) => findPlayer(data, e.playerId)?.name ?? '');
  if (winners.length === 0) systemMessage(cx, 'Game over!');
  else if (winners.length === 1) systemMessage(cx, `Game over! ${winners[0]} wins with ${top} points.`);
  else systemMessage(cx, `Game over! ${listNames(winners)} tie with ${top} points.`);
  broadcastSnapshot(cx);
}

/** Drops the game (and its side store) and resets scores; votes do not survive either. */
export function resetToLobby(cx: Cx): void {
  const { data } = cx;
  data.phase = 'lobby';
  data.podium = null;
  data.game = null;
  data.waiting = null;
  data.votes = [];
  for (const p of data.players) p.score = 0;
  if (moduleFor(data.gameId).createSideStore) cx.effects.push({ type: 'side', name: 'reset', stamp: '' });
  broadcastSnapshot(cx);
}

/**
 * Abandons a running game when fewer seats than the game needs remain (after a leave, a kick or a
 * seat expiry). A disconnected player still holds a seat, so a dropped socket never ends a game
 * here: the game holds for them instead. Returns true when it abandoned the game.
 */
export function ensureEnoughSeated(cx: Cx): boolean {
  if (cx.data.phase !== 'playing' || hasEnoughSeated(cx.data)) return false;
  systemMessage(cx, 'Not enough players — back to the lobby.');
  resetToLobby(cx);
  return true;
}
