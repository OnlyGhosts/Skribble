/** Round lifecycle: start -> playing (guesses, pauses) -> reveal -> next round / game over. */
import { SPY_LOCATIONS, drawCandidates, locationById, pickLocation } from '../../../shared/games/spygame/locations.js';
import { SPYGAME_CANDIDATES, SPYGAME_GUESSES, SPYGAME_POINTS, SPYGAME_REVEAL_SECONDS, type SpygameOutcome } from '../../../shared/games/spygame/protocol.js';
import { RESUME_SETTLE_MS, holdEffects, resumeEffect } from '../waiting.js';
import { MIN_PLAYERS, agentIds, connectedCount, fail, findPlayer, nameOf, snapshot, systemMessage, type Gx, type RoundData } from './state.js';

/** Uniform pick from a non-empty list. */
function pickOne<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/** The next spy: someone who has not been the spy this rotation; a new rotation starts once everyone had a turn. */
function pickSpy(gx: Gx, playerIds: string[]): string {
  const { data, ctx } = gx;
  let eligible = playerIds.filter((id) => !data.spyHistory.includes(id));
  if (eligible.length === 0) {
    data.spyHistory = [];
    eligible = playerIds;
  }
  const spyId = pickOne(eligible, ctx.rng);
  data.spyHistory.push(spyId);
  return spyId;
}

export function buildRound(gx: Gx): RoundData {
  const { data, ctx } = gx;
  const playerIds = ctx.players.filter((p) => p.connected).map((p) => p.id);
  const spyId = pickSpy(gx, playerIds);
  if (SPY_LOCATIONS.every((l) => data.usedLocationIds.includes(l.id))) data.usedLocationIds = [];
  const location = pickLocation(data.usedLocationIds, ctx.rng);
  data.usedLocationIds.push(location.id);
  return {
    spyId,
    spyName: nameOf(ctx, spyId),
    locationId: location.id,
    candidates: drawCandidates(location.id, SPYGAME_CANDIDATES, ctx.rng),
    playerIds,
    guessesLeft: SPYGAME_GUESSES,
    guessed: [],
    accusers: [],
    clock: { kind: 'running', endsAt: ctx.now + ctx.settings.roundMinutes * 60_000 },
    spyAway: false,
  };
}

/**
 * Starts the next round once at least three players are connected. Otherwise the game holds
 * (RoomState.waiting) until enough of them are back, and is abandoned only when fewer than three
 * hold a seat at all. While holding, resumeIfHeld decides when it is called again.
 */
export function beginRound(gx: Gx): void {
  const { data, ctx } = gx;
  if (ctx.players.length < MIN_PLAYERS) {
    gx.effects.push({ type: 'abort', reason: 'Not enough players — back to the lobby.' });
    return;
  }
  if (connectedCount(ctx) < MIN_PLAYERS) return hold(gx);
  if (data.phase === 'waiting') gx.effects.push(resumeEffect());
  data.resumeAt = null;
  data.round += 1;
  data.current = buildRound(gx);
  data.phase = 'playing';
  data.vote = null;
  data.reveal = null;
  systemMessage(gx, `Round ${data.round} of ${ctx.settings.rounds} — look at your phone`);
  snapshot(gx);
}

/** Holds between rounds; the previous reveal stays on screen under the platform's waiting state. */
function hold(gx: Gx): void {
  const { data, ctx } = gx;
  const fresh = data.phase !== 'waiting';
  data.phase = 'waiting';
  data.vote = null;
  data.resumeAt = null;
  gx.effects.push(...holdEffects(ctx.players, fresh));
}

/**
 * Re-evaluates a hold after the player list changed: the lobby or a refreshed hold while too few
 * are connected; otherwise a settle before the next round, restarted by every further reconnect,
 * so a group whose sockets were all cut at once is seated together rather than from the first
 * one back (see RESUME_SETTLE_MS).
 */
export function resumeIfHeld(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase !== 'waiting') return;
  if (ctx.players.length < MIN_PLAYERS || connectedCount(ctx) < MIN_PLAYERS) return beginRound(gx);
  data.resumeAt = ctx.now + RESUME_SETTLE_MS;
  gx.effects.push(...holdEffects(ctx.players, false));
}

/** The settle ran out: the next round with everyone connected by now, or a fresh hold if someone dropped again. */
export function settleDue(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase !== 'waiting' || data.resumeAt === null || ctx.now < data.resumeAt) return;
  data.resumeAt = null;
  beginRound(gx);
}

/** Freezes the round clock, keeping what is left of it. */
export function pauseClock(gx: Gx): void {
  const { current } = gx.data;
  if (current.clock.kind === 'running') current.clock = { kind: 'paused', remainingMs: Math.max(0, current.clock.endsAt - gx.ctx.now) };
}

/** Restarts the clock from the kept remaining time, unless a vote or the spy's absence still holds it. */
export function resumeClock(gx: Gx): void {
  const { data, ctx } = gx;
  const { current } = data;
  if (data.phase !== 'playing' || current.spyAway || current.clock.kind !== 'paused') return;
  if (current.clock.remainingMs <= 0) return endRound(gx, 'timeUp');
  current.clock = { kind: 'running', endsAt: ctx.now + current.clock.remainingMs };
}

export function guess(gx: Gx, playerId: string, locationId: string): void {
  const { data } = gx;
  const { current } = data;
  if (data.phase !== 'playing') return fail(gx, playerId, 'You can only guess while the round clock runs.');
  if (playerId !== current.spyId) return fail(gx, playerId, 'Only the spy guesses the location.');
  if (!current.candidates.includes(locationId)) return fail(gx, playerId, 'That is not one of the candidates.');
  if (current.guessed.includes(locationId)) return fail(gx, playerId, 'You already ruled that one out.');
  if (locationId === current.locationId) return endRound(gx, 'spyGuessed');
  current.guessesLeft -= 1;
  current.guessed.push(locationId);
  if (current.guessesLeft <= 0) return endRound(gx, 'spyWrong');
  systemMessage(gx, `The spy guessed wrong! ${current.guessesLeft} guess${current.guessesLeft === 1 ? '' : 'es'} left`);
  snapshot(gx);
}

/** Points earned this round by player id; zero entries are left out. */
function pointsFor(gx: Gx, outcome: SpygameOutcome, accuserId: string | null): Record<string, number> {
  const { data } = gx;
  const { current } = data;
  const points: Record<string, number> = {};
  const award = (id: string, delta: number): void => {
    if (findPlayer(gx.ctx, id)) points[id] = (points[id] ?? 0) + delta;
  };
  switch (outcome) {
    case 'spyGuessed':
      award(current.spyId, current.guessesLeft === SPYGAME_GUESSES ? SPYGAME_POINTS.spyFirstGuess : SPYGAME_POINTS.spySecondGuess);
      break;
    case 'wrongAccusation':
      award(current.spyId, SPYGAME_POINTS.wrongAccusation);
      break;
    case 'spyCaught':
      for (const id of agentIds(data)) award(id, SPYGAME_POINTS.agentWin);
      if (accuserId !== null) award(accuserId, SPYGAME_POINTS.accuserBonus);
      break;
    case 'spyWrong':
    case 'timeUp':
    case 'spyLeft':
      for (const id of agentIds(data)) award(id, SPYGAME_POINTS.agentWin);
      break;
  }
  return points;
}

function outcomeLine(gx: Gx, outcome: SpygameOutcome, accusedId: string | null): string {
  const { current } = gx.data;
  const spy = current.spyName;
  const place = locationById(current.locationId)?.name ?? current.locationId;
  switch (outcome) {
    case 'spyGuessed':
      return `${spy} was the spy and guessed the location: ${place}!`;
    case 'spyWrong':
      return `The spy guessed wrong again! ${spy} was the spy — the agents win. It was the ${place}.`;
    case 'spyCaught':
      return `${spy} was the spy — caught! The agents win. It was the ${place}.`;
    case 'wrongAccusation':
      return `${accusedId !== null ? nameOf(gx.ctx, accusedId) : 'That'} was not the spy. ${spy} wins the round — it was the ${place}.`;
    case 'timeUp':
      return `Time's up! ${spy} was the spy — the agents win. It was the ${place}.`;
    case 'spyLeft':
      return `${spy} (the spy) left — the agents win the round. It was the ${place}.`;
  }
}

/** Ends the round: scores, the reveal with its auto-advance deadline, a system line and a snapshot. */
export function endRound(gx: Gx, outcome: SpygameOutcome, vote: { accuserId: string; accusedId: string } | null = null): void {
  const { data, ctx } = gx;
  if (data.phase !== 'playing' && data.phase !== 'voting') return;
  const points = pointsFor(gx, outcome, vote?.accuserId ?? null);
  for (const [playerId, delta] of Object.entries(points)) gx.effects.push({ type: 'score', playerId, delta });
  pauseClock(gx);
  data.vote = null;
  data.phase = 'reveal';
  data.reveal = { outcome, spyId: data.current.spyId, spyName: data.current.spyName, locationId: data.current.locationId, points, endsAt: ctx.now + SPYGAME_REVEAL_SECONDS * 1000 };
  systemMessage(gx, outcomeLine(gx, outcome, vote?.accusedId ?? null));
  snapshot(gx);
}

/** Leaves the reveal: the podium after the last round, otherwise the next round (or a hold for missing players). */
export function advance(gx: Gx): void {
  const { data, ctx } = gx;
  if (data.phase !== 'reveal') return;
  if (data.round >= ctx.settings.rounds) {
    data.phase = 'over';
    gx.effects.push({ type: 'gameOver' });
    return;
  }
  beginRound(gx);
}

export function nextRound(gx: Gx, playerId: string): void {
  if (playerId !== gx.ctx.hostId) return fail(gx, playerId, 'Only the host can skip the reveal.');
  if (gx.data.phase !== 'reveal') return fail(gx, playerId, 'There is no reveal to skip.');
  advance(gx);
}

/** The host calls the game off from the reveal (or the hold that keeps it on screen): the platform resets everyone to the lobby. */
export function endGame(gx: Gx, playerId: string): void {
  if (playerId !== gx.ctx.hostId) return fail(gx, playerId, 'Only the host can end the game.');
  if (gx.data.phase !== 'reveal' && gx.data.phase !== 'waiting') return fail(gx, playerId, 'The game can only be ended from the reveal.');
  gx.effects.push({ type: 'abort', reason: 'The host ended the game — back to the lobby.' });
}
