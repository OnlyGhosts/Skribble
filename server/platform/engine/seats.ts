/** Seats: join / rejoin / disconnect / leave, host transfer, kicks and vote-kicks. */
import type { Avatar } from '../../../shared/platform/avatar.js';
import { EMPTY_ROOM_TTL_MS, LOW_PLAYERS_GRACE_MS } from '../../../shared/platform/constants.js';
import type { GameId } from '../../../shared/platform/games.js';
import { CLOSE_REMOVED } from '../../../shared/platform/protocol.js';
import type { ActionResult } from './actions.js';
import { runGame } from './delegate.js';
import { ensureEnoughPlayers } from './lobby.js';
import { broadcastSnapshot, fail, requireHost, sendTo, sendWelcome, systemMessage, type Cx } from './messaging.js';
import { moduleFor } from './module.js';
import { connectedCount, findByToken, findPlayer, hasEnoughPlayers, inProgress, isFull, othersConnected, votesNeeded } from './players.js';
import { MAX_KICKED_TOKENS, type PlatformPlayerData } from './state.js';

type Seat = { ok: true; playerId: string } | { ok: false; code: 'ROOM_FULL' | 'GAME_IN_PROGRESS' | 'REJOIN_FAILED' | 'INTERNAL'; message: string };

export function create(cx: Cx, gameId: GameId, name: string, avatar: Avatar, connectionId: string): ActionResult {
  if (cx.data.players.length > 0 || cx.data.hostId) {
    return { ok: false, code: 'INTERNAL', message: 'This room already exists.' };
  }
  if (cx.data.gameId !== gameId) return { ok: false, code: 'INTERNAL', message: 'This room belongs to another game.' };
  return join(cx, name, avatar, connectionId);
}

export function join(cx: Cx, name: string, avatar: Avatar, connectionId: string): Seat {
  const { data } = cx;
  if (isFull(data)) return { ok: false, code: 'ROOM_FULL', message: 'This room is full.' };
  if (inProgress(data) && !data.settings.allowMidGameJoin) {
    return { ok: false, code: 'GAME_IN_PROGRESS', message: 'A game is in progress and the host disabled mid-game joins.' };
  }
  const wasEmpty = data.players.length === 0;
  const player: PlatformPlayerData = {
    id: cx.ctx.newId(),
    token: cx.ctx.newToken(),
    name,
    avatar: { ...avatar },
    score: 0,
    joinOrder: data.nextJoinOrder++,
    connected: true,
    connectionId,
    connectedAt: cx.now,
    disconnectedAt: null,
  };
  data.players.push(player);
  if (!data.hostId) data.hostId = player.id;
  if (wasEmpty) data.grace.emptyRoomAt = null;
  if (hasEnoughPlayers(data)) data.grace.lowPlayersAt = null;
  standInForAbsentHost(cx);

  // The game learns about the seat first (so the welcome reflects it), but its reactions follow the welcome.
  const gameEffects = deferred(cx, () => runGame(cx, { type: 'playerJoined', playerId: player.id }));
  systemMessage(cx, `${player.name} joined`, player.id);
  sendWelcome(cx, player.id);
  broadcastSnapshot(cx, player.id);
  cx.effects.push(...gameEffects);
  return { ok: true, playerId: player.id };
}

export function rejoin(cx: Cx, token: string, connectionId: string): Seat {
  const { data } = cx;
  if (data.kickedTokens.includes(token)) return { ok: false, code: 'REJOIN_FAILED', message: 'You were removed from this room.' };
  const player = findByToken(data, token);
  if (!player) {
    return { ok: false, code: 'REJOIN_FAILED', message: 'Your seat in this room has expired.' };
  }
  const wasConnected = player.connected;
  player.connected = true;
  player.connectionId = connectionId;
  player.disconnectedAt = null;
  // Replacing a live socket keeps the original connection time (host seniority).
  if (!wasConnected) player.connectedAt = cx.now;
  if (hasEnoughPlayers(data)) data.grace.lowPlayersAt = null;
  if (data.returningHostId === player.id) {
    data.returningHostId = null;
    if (data.hostId !== player.id) {
      data.hostId = player.id;
      systemMessage(cx, `${player.name} is the host again`, player.id);
    }
  }

  sendWelcome(cx, player.id);
  if (!wasConnected) {
    systemMessage(cx, `${player.name} reconnected`, player.id);
    broadcastSnapshot(cx, player.id);
    runGame(cx, { type: 'playerReconnected', playerId: player.id });
  }
  return { ok: true, playerId: player.id };
}

/** The player's socket went away. The seat is kept for RECONNECT_GRACE_MS. */
export function connectionClosed(cx: Cx, playerId: string, connectionId: string | undefined): void {
  const { data } = cx;
  const player = findPlayer(data, playerId);
  if (!player) return;
  if (connectionId !== undefined && player.connectionId !== connectionId) return;
  if (!player.connected) return;

  player.connected = false;
  player.connectionId = null;
  player.disconnectedAt = cx.now;
  // Votes the leaver cast no longer count (only connected players make up the majority); votes
  // against them stay so a reconnect cannot wipe the tally.
  withdrawVotes(cx, player.id);

  // The room must stay operable while the host is away: a connected player stands in and the
  // role is handed back when the host rejoins.
  if (player.id === data.hostId) standInForAbsentHost(cx);

  // A dropped socket is usually a reload or a flaky network: give the player a moment to come
  // back before abandoning the game (an explicit leave or kick abandons it immediately).
  if (data.phase === 'playing' && !hasEnoughPlayers(data) && data.grace.lowPlayersAt === null) {
    data.grace.lowPlayersAt = cx.now + LOW_PLAYERS_GRACE_MS;
  }
  runGame(cx, { type: 'playerDisconnected', playerId: player.id });
  if (resolveVotes(cx)) return;
  broadcastSnapshot(cx);
}

export function leave(cx: Cx, playerId: string): void {
  if (findPlayer(cx.data, playerId)) removePlayer(cx, playerId, 'left');
}

export function kick(cx: Cx, playerId: string, targetId: string): void {
  if (!requireHost(cx, playerId)) return;
  const target = findPlayer(cx.data, targetId);
  if (!target) return fail(cx, playerId, 'NOT_ALLOWED', 'That player is not in the room.');
  if (target.id === playerId) return fail(cx, playerId, 'NOT_ALLOWED', "You can't kick yourself.");
  removePlayer(cx, target.id, 'kicked', 'You were kicked by the host.');
}

export function voteKick(cx: Cx, playerId: string, targetId: string): void {
  const { data } = cx;
  const voter = findPlayer(data, playerId);
  const target = findPlayer(data, targetId);
  if (!voter) return;
  if (!target) return fail(cx, playerId, 'NOT_ALLOWED', 'That player is not in the room.');
  if (target.id === playerId) return fail(cx, playerId, 'NOT_ALLOWED', "You can't vote to kick yourself.");
  // With one other player a "vote" would be a unilateral kick (of the host, even).
  if (othersConnected(data, target.id) < 2) {
    return fail(cx, playerId, 'NOT_ALLOWED', 'A vote needs at least two other connected players.');
  }
  let vote = data.votes.find((v) => v.targetId === target.id);
  if (!vote) {
    vote = { targetId: target.id, voterIds: [] };
    data.votes.push(vote);
  }
  if (vote.voterIds.includes(playerId)) return;
  vote.voterIds.push(playerId);
  if (resolveVotes(cx)) return;
  systemMessage(cx, `${voter.name} voted to kick ${target.name} (${vote.voterIds.length}/${votesNeeded(data, target.id)})`);
}

/** Removes a player whose reconnect grace ran out. */
export function expireSeat(cx: Cx, playerId: string): void {
  removePlayer(cx, playerId, 'left');
}

/** Runs `fn` and returns the effects it produced, removing them from the list so the caller can place them later. */
function deferred(cx: Cx, fn: () => void): Cx['effects'] {
  const mark = cx.effects.length;
  fn();
  return cx.effects.splice(mark);
}

function withdrawVotes(cx: Cx, voterId: string): void {
  for (const vote of cx.data.votes) vote.voterIds = vote.voterIds.filter((id) => id !== voterId);
  cx.data.votes = cx.data.votes.filter((v) => v.voterIds.length > 0);
}

/**
 * Kicks the first target whose tally meets the threshold, which can also happen when the
 * threshold drops because a voter's peer left. Returns true when someone was removed.
 */
function resolveVotes(cx: Cx): boolean {
  const { data } = cx;
  for (const vote of [...data.votes]) {
    const target = findPlayer(data, vote.targetId);
    if (!target) {
      data.votes = data.votes.filter((v) => v !== vote);
      continue;
    }
    if (vote.voterIds.length >= votesNeeded(data, target.id)) {
      data.votes = data.votes.filter((v) => v !== vote);
      removePlayer(cx, target.id, 'kicked', 'You were kicked by a vote.');
      return true;
    }
  }
  return false;
}

function removePlayer(cx: Cx, playerId: string, how: 'left' | 'kicked', kickReason?: string): void {
  const { data } = cx;
  const player = findPlayer(data, playerId);
  if (!player) return;
  if (how === 'kicked') {
    sendTo(cx, player.id, { t: 'kicked', reason: kickReason ?? 'You were removed from the room.' });
    cx.effects.push({ type: 'close', playerId: player.id, code: CLOSE_REMOVED, reason: 'Removed from room' });
    data.kickedTokens = [...data.kickedTokens, player.token].slice(-MAX_KICKED_TOKENS);
  }
  data.players = data.players.filter((p) => p !== player);
  data.votes = data.votes.filter((v) => v.targetId !== player.id);
  withdrawVotes(cx, player.id);
  if (data.returningHostId === player.id) data.returningHostId = null;

  systemMessage(cx, how === 'kicked' ? `${player.name} was kicked` : `${player.name} left`);
  if (player.id === data.hostId) transferHost(cx);

  if (data.players.length === 0) {
    resetEmptyRoom(cx);
    return;
  }
  // One player fewer can lower a pending vote's threshold to what is already tallied.
  resolveVotes(cx);
  if (ensureEnoughPlayers(cx)) return;
  runGame(cx, { type: 'playerLeft', playerId: player.id });
  broadcastSnapshot(cx);
}

/** The next group to pick up this code must not inherit anything: a clean lobby with a TTL. */
function resetEmptyRoom(cx: Cx): void {
  const { data } = cx;
  data.grace.lowPlayersAt = null;
  data.phase = 'lobby';
  data.podium = null;
  data.game = null;
  data.votes = [];
  data.kickedTokens = [];
  data.returningHostId = null;
  if (moduleFor(data.gameId).createSideStore) cx.effects.push({ type: 'side', name: 'reset', stamp: '' });
  data.grace.emptyRoomAt = cx.now + EMPTY_ROOM_TTL_MS;
}

/**
 * While the host's socket is down, a connected player holds the role (rejoin hands it back).
 * Called after a disconnect and after a join: a lone host who dropped must not lock the room for
 * whoever arrives during their grace.
 */
function standInForAbsentHost(cx: Cx): void {
  const { data } = cx;
  const host = findPlayer(data, data.hostId);
  if (!host || host.connected || connectedCount(data) === 0) return;
  if (data.returningHostId === null) data.returningHostId = host.id;
  transferHost(cx);
}

function transferHost(cx: Cx): void {
  const { data } = cx;
  const candidates = [...data.players].sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return a.connectedAt - b.connectedAt || a.joinOrder - b.joinOrder;
  });
  const next = candidates[0];
  data.hostId = next ? next.id : '';
  if (next) systemMessage(cx, `${next.name} is now the host`);
}

