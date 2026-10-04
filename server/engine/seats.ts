/** Seats: join / rejoin / disconnect / leave, host transfer, kicks and vote-kicks. */
import type { Avatar } from '../../shared/avatar.js';
import { DRAWER_DISCONNECT_GRACE_MS, EMPTY_ROOM_TTL_MS } from '../../shared/constants.js';
import { CLOSE_REMOVED } from '../../shared/protocol.js';
import type { ActionResult } from './actions.js';
import { broadcastSnapshot, fail, requireHost, sendTo, sendWelcome, systemMessage, type Cx } from './messaging.js';
import {
  connectedCount,
  everyoneGuessed,
  findByToken,
  findPlayer,
  hasEnoughPlayers,
  inProgress,
  isFull,
  isGamePhase,
  othersConnected,
  votesNeeded,
} from './players.js';
import type { PlayerData } from './state.js';
import { clearTurnGrace, endTurn, ensureEnoughPlayers, resetCanvas, resumeHeldTurn } from './turns.js';

type Seat = { ok: true; playerId: string } | { ok: false; code: 'ROOM_FULL' | 'GAME_IN_PROGRESS' | 'REJOIN_FAILED' | 'INTERNAL'; message: string };

export function create(cx: Cx, name: string, avatar: Avatar, connectionId: string): ActionResult {
  if (cx.data.players.length > 0 || cx.data.hostId) {
    return { ok: false, code: 'INTERNAL', message: 'This room already exists.' };
  }
  return join(cx, name, avatar, connectionId);
}

export function join(cx: Cx, name: string, avatar: Avatar, connectionId: string): Seat {
  const { data } = cx;
  if (isFull(data)) return { ok: false, code: 'ROOM_FULL', message: 'This room is full.' };
  if (inProgress(data) && !data.settings.allowMidGameJoin) {
    return { ok: false, code: 'GAME_IN_PROGRESS', message: 'A game is in progress and the host disabled mid-game joins.' };
  }
  const wasEmpty = data.players.length === 0;
  const player: PlayerData = {
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
    guessedThisTurn: false,
    turnPoints: 0,
    rating: null,
  };
  data.players.push(player);
  if (!data.hostId) data.hostId = player.id;
  if (isGamePhase(data.phase.kind)) data.turnQueue.push(player.id);
  if (data.phase.kind === 'drawing' && data.turn) data.turn.guesserIds.push(player.id);
  if (wasEmpty) data.grace.emptyRoomAt = null;
  standInForAbsentHost(cx);

  systemMessage(cx, `${player.name} joined`, player.id);
  sendWelcome(cx, player.id);
  broadcastSnapshot(cx, player.id);
  resumeHeldTurn(cx);
  return { ok: true, playerId: player.id };
}

export function rejoin(cx: Cx, token: string, connectionId: string): Seat {
  const { data } = cx;
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
  if (data.turn?.drawerId === player.id) data.grace.drawerGoneAt = null;
  if (data.phase.kind === 'drawing' && data.turn && data.turn.drawerId !== player.id && !data.turn.guesserIds.includes(player.id)) {
    data.turn.guesserIds.push(player.id);
  }
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
  }
  resumeHeldTurn(cx);
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

  const grace = cx.now + DRAWER_DISCONNECT_GRACE_MS;
  if (data.turn?.drawerId === player.id && (data.phase.kind === 'choosing' || data.phase.kind === 'drawing')) {
    data.grace.drawerGoneAt = grace;
  }
  // A dropped socket is usually a reload or a flaky network: give the player a moment to come
  // back before abandoning the game (an explicit leave or kick abandons it immediately).
  if (isGamePhase(data.phase.kind) && !hasEnoughPlayers(data) && data.grace.lowPlayersAt === null) {
    data.grace.lowPlayersAt = grace;
  }
  // Likewise the last unsolved guesser gets the same grace before "everyone guessed" ends the turn.
  if (data.phase.kind === 'drawing' && everyoneGuessed(data) && data.grace.allGuessedAt === null) {
    data.grace.allGuessedAt = grace;
  }
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
  }
  data.players = data.players.filter((p) => p !== player);

  const queued = data.turnQueue.indexOf(player.id);
  if (queued > data.turnIndex) data.turnQueue.splice(queued, 1);
  data.votes = data.votes.filter((v) => v.targetId !== player.id);
  withdrawVotes(cx, player.id);
  if (data.returningHostId === player.id) data.returningHostId = null;

  systemMessage(cx, how === 'kicked' ? `${player.name} was kicked` : `${player.name} left`);
  if (player.id === data.hostId) transferHost(cx);

  if (data.players.length === 0) {
    clearTurnGrace(cx);
    data.grace.lowPlayersAt = null;
    data.turn = null;
    data.phase = { kind: 'lobby' };
    data.round = 0;
    data.turnIndex = -1;
    data.turnQueue = [];
    data.usedWords = [];
    // The next group to pick up this code must not inherit the last drawing.
    resetCanvas(cx);
    data.grace.emptyRoomAt = cx.now + EMPTY_ROOM_TTL_MS;
    return;
  }
  // One player fewer can lower a pending vote's threshold to what is already tallied.
  resolveVotes(cx);
  if (ensureEnoughPlayers(cx)) return;
  if (data.turn?.drawerId === player.id && (data.phase.kind === 'choosing' || data.phase.kind === 'drawing')) {
    return endTurn(cx, 'drawerLeft');
  }
  if (data.phase.kind === 'drawing' && everyoneGuessed(data)) return endTurn(cx, 'allGuessed');
  broadcastSnapshot(cx);
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

/** Removes a player whose reconnect grace ran out. */
export function expireSeat(cx: Cx, playerId: string): void {
  removePlayer(cx, playerId, 'left');
}
