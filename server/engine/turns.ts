/** Turn lifecycle: start -> choosing -> drawing (hints) -> turnEnd -> next turn / gameEnd / lobby. */
import { CHOOSE_TIME_SECONDS, MIN_PLAYERS_TO_START, TURN_END_SECONDS } from '../../shared/constants';
import { hintCountFor, hintRevealOrder, hintSchedule } from '../../shared/hints';
import type { TurnEndReason } from '../../shared/protocol';
import { drawerPoints } from '../../shared/scoring';
import { buildWordPool, pickWords } from '../../shared/words/index';
import { broadcastSnapshot, fail, pushChat, systemMessage, type Cx } from './messaging';
import { connectedCount, findPlayer, hasEnoughPlayers, isGamePhase, sortedPlayers } from './players';
import type { PlayerData, Podium } from './state';

/** "Alice", "Alice and Bob", "Alice, Bob and Carol". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function resetForTurn(p: PlayerData): void {
  p.guessedThisTurn = false;
  p.turnPoints = 0;
  p.rating = null;
}

export function resetForGame(p: PlayerData): void {
  p.score = 0;
  resetForTurn(p);
}

/** Drops the grace periods that belong to the current turn (the phase's own deadlines die with the phase). */
export function clearTurnGrace(cx: Cx): void {
  cx.data.grace.drawerGoneAt = null;
  cx.data.grace.allGuessedAt = null;
}

/** Empties the canvas for everyone; the next drawing must not inherit the last one. */
export function resetCanvas(cx: Cx): void {
  cx.data.turnId += 1;
  cx.effects.push({ type: 'canvas', op: 'clear' });
}

export function beginNextTurn(cx: Cx): void {
  const { data } = cx;
  clearTurnGrace(cx);
  if (connectedCount(data) < MIN_PLAYERS_TO_START) {
    if (data.phase.kind === 'turnEnd' && data.grace.lowPlayersAt !== null) {
      // Someone is in their reconnect grace: hold at the summary. A join or rejoin resumes the
      // game, the pending low-player check sends everyone back to the lobby otherwise.
      data.phase.held = true;
      const away = sortedPlayers(data).filter((p) => !p.connected).map((p) => p.name);
      systemMessage(cx, `Waiting for ${away.join(', ')} to reconnect…`);
      return;
    }
    systemMessage(cx, 'Not enough players — back to the lobby.');
    resetToLobby(cx);
    return;
  }
  for (;;) {
    data.turnIndex += 1;
    if (data.turnIndex >= data.turnQueue.length) {
      if (data.round >= data.settings.rounds) return finishGame(cx);
      data.round += 1;
      data.turnQueue = sortedPlayers(data).map((p) => p.id);
      data.turnIndex = -1;
      continue;
    }
    const drawer = findPlayer(data, data.turnQueue[data.turnIndex]);
    if (!drawer || !drawer.connected) {
      // Skipped drawers leave the schedule so turn/turnsInRound stay accurate.
      data.turnQueue.splice(data.turnIndex, 1);
      data.turnIndex -= 1;
      continue;
    }
    return startChoosing(cx, drawer);
  }
}

function startChoosing(cx: Cx, drawer: PlayerData): void {
  const { data } = cx;
  for (const p of data.players) resetForTurn(p);
  drawer.guessedThisTurn = true;
  resetCanvas(cx);

  const pool = buildWordPool(data.settings.language, data.settings.customWords, data.settings.customWordsOnly);
  const choices = pickWords(pool, data.settings.wordChoices, data.usedWords, cx.ctx.rng);
  data.turn = { drawerId: drawer.id, choices, word: '', startedAt: 0, endsAt: 0, revealOrder: [], revealAt: [], revealed: [], correct: 0, guesserIds: [] };
  if (choices.length === 0) {
    data.phase = { kind: 'choosing', endsAt: cx.now };
    return endTurn(cx, 'noWordChosen');
  }
  data.phase = { kind: 'choosing', endsAt: cx.now + CHOOSE_TIME_SECONDS * 1000 };
  broadcastSnapshot(cx);
}

export function chooseWord(cx: Cx, playerId: string, index: number): void {
  const { data } = cx;
  if (data.phase.kind !== 'choosing' || data.turn?.drawerId !== playerId) {
    return fail(cx, playerId, 'NOT_ALLOWED', 'You are not choosing a word right now.');
  }
  const word = data.turn.choices[index];
  if (word === undefined) return fail(cx, playerId, 'NOT_ALLOWED', 'That is not one of your choices.');
  startDrawing(cx, word);
}

/** The choose deadline passed: auto-pick the first choice, or skip a drawer who is away. */
export function chooseTimedOut(cx: Cx): void {
  const turn = cx.data.turn;
  if (!turn) return;
  const drawer = findPlayer(cx.data, turn.drawerId);
  if (!drawer || !drawer.connected) return endTurn(cx, 'drawerLeft');
  startDrawing(cx, turn.choices[0]);
}

function startDrawing(cx: Cx, word: string): void {
  const { data } = cx;
  const turn = data.turn;
  if (!turn) return;
  const drawTimeMs = data.settings.drawTime * 1000;
  const lower = word.toLowerCase();
  if (!data.usedWords.includes(lower)) data.usedWords.push(lower);
  const hintCount = hintCountFor(word, data.settings.hints);
  turn.word = word;
  turn.startedAt = cx.now;
  turn.endsAt = cx.now + drawTimeMs;
  turn.revealOrder = hintRevealOrder(word, hintCount, cx.ctx.rng);
  turn.revealAt = hintSchedule(drawTimeMs, hintCount).map((offset) => cx.now + offset);
  turn.revealed = [];
  turn.correct = 0;
  turn.guesserIds = data.players.filter((p) => p.connected && p.id !== turn.drawerId).map((p) => p.id);
  data.phase = { kind: 'drawing' };
  broadcastSnapshot(cx);
}

export function revealHint(cx: Cx): void {
  const turn = cx.data.turn;
  if (cx.data.phase.kind !== 'drawing' || !turn) return;
  const idx = turn.revealOrder[turn.revealed.length];
  if (idx === undefined) return;
  turn.revealed.push(idx);
  broadcastSnapshot(cx);
}

export function endTurn(cx: Cx, reason: TurnEndReason): void {
  const { data } = cx;
  const turn = data.turn;
  if (!turn || (data.phase.kind !== 'choosing' && data.phase.kind !== 'drawing')) return;
  clearTurnGrace(cx);

  const drawer = findPlayer(data, turn.drawerId);
  if (drawer && reason !== 'drawerLeft' && reason !== 'noWordChosen') {
    // Per-turn tallies, not the current player list: a guesser who dropped or left after
    // solving still counts, and one who dropped without solving still dilutes the share.
    const pts = drawerPoints(turn.correct, turn.guesserIds.length);
    drawer.score += pts;
    drawer.turnPoints += pts;
  }

  const points: Record<string, number> = {};
  for (const p of data.players) if (p.turnPoints > 0) points[p.id] = p.turnPoints;

  data.phase = { kind: 'turnEnd', reason, endsAt: cx.now + TURN_END_SECONDS * 1000, points, held: false };
  if (turn.word) pushChat(cx, 'hint', `The word was: ${turn.word}`);
  broadcastSnapshot(cx);
}

function finishGame(cx: Cx): void {
  const { data } = cx;
  clearTurnGrace(cx);
  data.grace.lowPlayersAt = null;
  data.turn = null;
  const ranked = [...data.players].sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
  const podium: Podium = ranked.map((p) => ({
    playerId: p.id,
    score: p.score,
    rank: 1 + ranked.filter((o) => o.score > p.score).length,
  }));
  data.phase = { kind: 'gameEnd', podium };
  const winners = ranked.filter((p) => p.score === ranked[0]?.score);
  if (winners.length === 0) systemMessage(cx, 'Game over!');
  else if (winners.length === 1) systemMessage(cx, `Game over! ${winners[0].name} wins with ${winners[0].score} points.`);
  else systemMessage(cx, `Game over! ${listNames(winners.map((p) => p.name))} tie with ${winners[0].score} points.`);
  broadcastSnapshot(cx);
}

export function resetToLobby(cx: Cx): void {
  const { data } = cx;
  clearTurnGrace(cx);
  data.grace.lowPlayersAt = null;
  data.turn = null;
  data.phase = { kind: 'lobby' };
  data.round = 0;
  data.turnIndex = -1;
  data.turnQueue = [];
  data.usedWords = [];
  data.votes = [];
  for (const p of data.players) resetForGame(p);
  resetCanvas(cx);
  broadcastSnapshot(cx);
}

/** Announces that the drawer's reconnect grace ran out (the caller ends the turn). */
export function systemMessageForDrawerGone(cx: Cx): void {
  const drawer = cx.data.turn ? findPlayer(cx.data, cx.data.turn.drawerId) : undefined;
  if (drawer) systemMessage(cx, `${drawer.name} lost connection — skipping their turn.`);
}

/** Continues a turn boundary that beginNextTurn held while a player was in reconnect grace. */
export function resumeHeldTurn(cx: Cx): void {
  if (cx.data.phase.kind === 'turnEnd' && cx.data.phase.held) beginNextTurn(cx);
}

/** Returns true when the game had to be abandoned for lack of players. */
export function ensureEnoughPlayers(cx: Cx): boolean {
  if (!isGamePhase(cx.data.phase.kind)) return false;
  if (hasEnoughPlayers(cx.data)) return false;
  systemMessage(cx, 'Not enough players — back to the lobby.');
  resetToLobby(cx);
  return true;
}
