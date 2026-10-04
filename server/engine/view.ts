/** Per-recipient projections of RoomData onto the wire protocol. */
import { maskWord } from '../../shared/hints.js';
import type { Phase, PlayerPublic, RoomPreview, RoomState, ServerMessageOf } from '../../shared/protocol.js';
import { findPlayer, inProgress, isJoinable, sortedPlayers } from './players.js';
import type { PlayerData, RoomData } from './state.js';

export function publicPlayer(p: PlayerData, hostId: string): PlayerPublic {
  return {
    id: p.id,
    name: p.name,
    avatar: { ...p.avatar },
    score: p.score,
    isHost: p.id === hostId,
    connected: p.connected,
    guessedThisTurn: p.guessedThisTurn,
    turnPoints: p.turnPoints,
    joinOrder: p.joinOrder,
  };
}

/**
 * Snapshot for one recipient (`null` for a role-less view used by HTTP previews and tests): the
 * word and the choices are only included for the drawer and for players who already guessed.
 */
export function viewFor(data: RoomData, playerId: string | null, now: number): RoomState {
  const inLobby = data.phase.kind === 'lobby';
  return {
    code: data.code,
    hostId: data.hostId,
    settings: { ...data.settings, customWords: [...data.settings.customWords] },
    players: sortedPlayers(data).map((p) => publicPlayer(p, data.hostId)),
    phase: phaseFor(data, playerId === null ? undefined : findPlayer(data, playerId)),
    round: data.round,
    totalRounds: data.settings.rounds,
    turn: inLobby ? 0 : Math.min(data.turnIndex + 1, data.turnQueue.length),
    turnsInRound: inLobby ? 0 : data.turnQueue.length,
    serverTime: now,
  };
}

function phaseFor(data: RoomData, recipient: PlayerData | undefined): Phase {
  const { turn, phase } = data;
  switch (phase.kind) {
    case 'lobby':
      return { kind: 'lobby' };
    case 'choosing': {
      const base = { kind: 'choosing' as const, drawerId: turn?.drawerId ?? '', endsAt: phase.endsAt };
      return recipient && recipient.id === turn?.drawerId ? { ...base, choices: [...(turn?.choices ?? [])] } : base;
    }
    case 'drawing': {
      let likes = 0;
      let dislikes = 0;
      for (const p of data.players) {
        if (p.rating === 'like') likes++;
        else if (p.rating === 'dislike') dislikes++;
      }
      const word = turn?.word ?? '';
      const out: Phase = {
        kind: 'drawing',
        drawerId: turn?.drawerId ?? '',
        startedAt: turn?.startedAt ?? 0,
        endsAt: turn?.endsAt ?? 0,
        mask: maskWord(word, turn?.revealed ?? []),
        likes,
        dislikes,
      };
      if (recipient && (recipient.id === turn?.drawerId || recipient.guessedThisTurn)) out.word = word;
      if (recipient?.rating) out.myRating = recipient.rating;
      return out;
    }
    case 'turnEnd':
      return {
        kind: 'turnEnd',
        drawerId: turn?.drawerId ?? '',
        word: turn?.word ?? '',
        reason: phase.reason,
        endsAt: phase.endsAt,
        points: { ...phase.points },
      };
    case 'gameEnd':
      return { kind: 'gameEnd', podium: phase.podium.map((e) => ({ ...e })) };
  }
}

/** What the home screen shows about a room before joining it. */
export function previewOf(data: RoomData): RoomPreview {
  return {
    exists: true,
    code: data.code,
    players: data.players.length,
    maxPlayers: data.settings.maxPlayers,
    inProgress: inProgress(data),
    joinable: isJoinable(data),
  };
}

/** Everything in `welcome` except the canvas, which the driver's canvas store supplies. */
export function welcomeFor(data: RoomData, playerId: string, now: number): Omit<ServerMessageOf<'welcome'>, 'canvas'> | null {
  const player = findPlayer(data, playerId);
  if (!player) return null;
  return { t: 'welcome', playerId, token: player.token, room: viewFor(data, playerId, now), chat: structuredClone(data.chat) };
}
