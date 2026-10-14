/** Per-recipient projection of HangmanData: the choices and the secret word reach the hangman only, until the turn ends. */
import { HANGMAN_MAX_WRONG, type HangmanPlayerView, type HangmanSettings, type HangmanView } from '../../../shared/games/hangman/protocol.js';
import { hangmanMask } from '../../../shared/games/hangman/words.js';
import type { GameViewCtx } from '../../platform/game.js';
import type { Clock, HangmanData } from './state.js';

export function viewFor(data: HangmanData, viewerId: string | null, ctx: GameViewCtx<HangmanSettings>): HangmanView {
  const { turn, phase } = data;
  const players: Record<string, HangmanPlayerView> = {};
  for (const p of ctx.players) players[p.id] = { out: turn?.out.includes(p.id) ?? false, playing: data.roundPlayerIds.includes(p.id) };
  const clock = clockOf(data);
  const word = turn?.word ?? '';
  const view: HangmanView = {
    phase: phase.kind,
    round: data.round,
    totalRounds: ctx.settings.rounds,
    turn: Math.min(data.turnIndex + 1, data.turnQueue.length),
    turnsInRound: data.turnQueue.length,
    hangmanId: turn?.hangmanId ?? '',
    guesserId: phase.kind === 'guessing' ? (turn?.guesserId ?? null) : null,
    mask: hangmanMask(word, turn?.usedLetters ?? []),
    usedLetters: [...(turn?.usedLetters ?? [])],
    wrongLetters: [...(turn?.wrongLetters ?? [])],
    wrong: turn?.wrong ?? 0,
    maxWrong: HANGMAN_MAX_WRONG,
    lives: HANGMAN_MAX_WRONG - (turn?.wrong ?? 0),
    section: phase.kind === 'drawing' ? phase.section : null,
    endsAt: clock?.kind === 'running' ? clock.endsAt : null,
    paused: clock?.kind === 'paused',
    outcome: phase.kind === 'turnEnd' ? (turn?.outcome ?? null) : null,
    points: { ...(turn?.points ?? {}) },
    players,
  };
  const mine = viewerId !== null && viewerId === turn?.hangmanId;
  if (mine && phase.kind === 'choosing') view.choices = [...(turn?.choices ?? [])];
  if (word && (mine || phase.kind === 'turnEnd' || phase.kind === 'gameOver')) view.word = word;
  return view;
}

/** The clock of the current phase: a held summary has none, a running one counts to its deadline. */
function clockOf(data: HangmanData): Clock | null {
  switch (data.phase.kind) {
    case 'choosing':
    case 'guessing':
    case 'drawing':
      return data.phase.clock;
    case 'turnEnd':
      return data.phase.held ? null : { kind: 'running', endsAt: data.phase.endsAt };
    case 'gameOver':
      return null;
  }
}
