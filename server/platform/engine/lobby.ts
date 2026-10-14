/** Lobby actions (settings, profile, game choice, ready, sit-out, start, back to lobby) and the game-over transition. */
import type { Avatar } from '../../../shared/platform/avatar.js';
import { gameById, type GameId } from '../../../shared/platform/games.js';
import type { PodiumEntry } from '../../../shared/platform/protocol.js';
import { defaultPlatformSettings, platformSettingsPatchSchema, platformSettingsSchema, type PlatformSettings } from '../../../shared/platform/settings.js';
import { applyGameResult, gameCtx } from './delegate.js';
import { broadcastSnapshot, fail, requireHost, requirePhase, systemMessage, type Cx } from './messaging.js';
import { moduleFor } from './module.js';
import { findPlayer, gameSeatLimit, hasEnoughSeated, minPlayers, participants, readyPlayers, sortedPlayers } from './players.js';
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
  data.settings = { ...merged, ...normalized };
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

/**
 * The party moves to another game: its settings start from that game's defaults while the
 * platform settings (content mode, mid-game joins) and everyone's ready flags carry over.
 */
export function selectGame(cx: Cx, playerId: string, gameId: GameId): void {
  if (!requireHost(cx, playerId) || !requirePhase(cx, playerId, 'lobby', 'The game can only be changed in the lobby.')) return;
  const { data } = cx;
  if (data.gameId === gameId) return;
  const previous = moduleFor(data.gameId);
  data.gameId = gameId;
  data.settings = { ...platformSettingsOf(data.settings, gameId), ...structuredClone(moduleFor(gameId).settings.defaults as Record<string, unknown>) };
  // The old game's canvas (if any) must not greet the next game's joiners.
  if (previous.createSideStore) cx.effects.push({ type: 'side', name: 'reset', stamp: '' });
  systemMessage(cx, `Host switched the party to ${gameById(gameId).name}`);
  broadcastSnapshot(cx);
}

/** The platform's own fields of a flat settings record, or the defaults when a stored room predates one of them. */
function platformSettingsOf(settings: RoomSettingsData, gameId: GameId): PlatformSettings {
  const parsed = platformSettingsSchema.safeParse(settings);
  return parsed.success ? parsed.data : defaultPlatformSettings(gameById(gameId));
}

export function setReady(cx: Cx, playerId: string, ready: boolean): void {
  const player = findPlayer(cx.data, playerId);
  if (!player || !requireBetweenGames(cx, playerId, 'You can only ready up between games.')) return;
  player.ready = ready;
  broadcastSnapshot(cx);
}

/** Sitting out clears the ready flag; coming back in does not ready the player (they say so themselves). */
export function setSitOut(cx: Cx, playerId: string, sitOut: boolean): void {
  const player = findPlayer(cx.data, playerId);
  if (!player || !requireBetweenGames(cx, playerId, 'You can only sit out between games.')) return;
  player.sittingOut = sitOut;
  if (sitOut) player.ready = false;
  broadcastSnapshot(cx);
}

function requireBetweenGames(cx: Cx, playerId: string, message: string): boolean {
  if (cx.data.phase !== 'playing') return true;
  fail(cx, playerId, 'NOT_ALLOWED', message);
  return false;
}

/**
 * Starts the game with the players who readied up (the host counts as ready by pressing start,
 * unless they sit out). Everyone else stays in the party as a spectator; a game with a seat
 * limit takes the first ready players by join order. Ready flags reset, sit-out choices persist.
 * A readied player whose socket is down at that moment is seated all the same (the game holds
 * for them like for any participant), but only connected ones count towards the minimum, so a
 * game never starts straight into a hold.
 */
export function start(cx: Cx, playerId: string): void {
  const { data } = cx;
  if (!requireHost(cx, playerId) || !requirePhase(cx, playerId, 'lobby', 'The game has already started.')) return;
  const ready = readyPlayers(data);
  const needed = minPlayers(data);
  if (ready.filter((p) => p.connected).length < needed) {
    return fail(cx, playerId, 'NOT_ALLOWED', `You need at least ${needed} player${needed === 1 ? '' : 's'} ready to start.`);
  }
  const limit = gameSeatLimit(data);
  const seated = ready.slice(0, limit);
  const benched = ready.slice(limit);
  for (const p of data.players) {
    p.participating = seated.includes(p);
    p.ready = false;
    p.score = 0;
  }
  data.votes = [];
  data.podium = null;
  data.phase = 'playing';
  const sitting = sortedPlayers(data).filter((p) => !p.participating && !benched.includes(p));
  if (sitting.length > 0) systemMessage(cx, `${listNames(sitting.map((p) => p.name))} ${sitting.length === 1 ? 'sits' : 'sit'} this one out`);
  if (benched.length > 0) {
    systemMessage(cx, `${gameById(data.gameId).name} seats ${limit} players: ${listNames(benched.map((p) => p.name))} ${benched.length === 1 ? 'sits' : 'sit'} this one out`);
  }
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

/** The game declared itself over: rank the players, announce the result and keep the room on the podium until the host returns to the lobby. */
export function finishGame(cx: Cx): void {
  const { data } = cx;
  data.waiting = null;
  data.podium = podiumOf(participants(data));
  data.phase = 'ended';
  const top = data.podium[0]?.score;
  const winners = data.podium.filter((e) => e.score === top).map((e) => findPlayer(data, e.playerId)?.name ?? '');
  if (winners.length === 0) systemMessage(cx, 'Game over!');
  else if (winners.length === 1) systemMessage(cx, `Game over! ${winners[0]} wins with ${top} points.`);
  else systemMessage(cx, `Game over! ${listNames(winners)} tie with ${top} points.`);
  broadcastSnapshot(cx);
}

/** Drops the game (and its side store) and resets scores; votes do not survive either. Ready flags and sit-out choices do. */
export function resetToLobby(cx: Cx): void {
  const { data } = cx;
  data.phase = 'lobby';
  data.podium = null;
  data.game = null;
  data.waiting = null;
  data.votes = [];
  for (const p of data.players) {
    p.score = 0;
    p.participating = false;
  }
  if (moduleFor(data.gameId).createSideStore) cx.effects.push({ type: 'side', name: 'reset', stamp: '' });
  broadcastSnapshot(cx);
}

/**
 * Abandons a running game when fewer participating seats than the game needs remain (after a
 * leave, a kick or a seat expiry). A disconnected player still holds a seat, so a dropped socket
 * never ends a game here: the game holds for them instead. Returns true when it abandoned the game.
 */
export function ensureEnoughSeated(cx: Cx): boolean {
  if (cx.data.phase !== 'playing' || hasEnoughSeated(cx.data)) return false;
  systemMessage(cx, 'Not enough players. Back to the lobby.');
  resetToLobby(cx);
  return true;
}
