/**
 * When Hangman's sounds play: a chime or a buzz for every guess (quieter for everyone but the
 * guesser), a pencil scratch as a section of the figure goes up, and a sting for how the word ended.
 */
import type { HangmanView } from '@shared/games/hangman/protocol';
import { ONLOOKER_VOLUME, playCue } from '../../platform/lib/sound';
import { hangmanSounds as sfx } from './sounds';

export function playHangmanSounds(view: HangmanView, before: HangmanView, me: string | null): void {
  const sameTurn = before.round === view.round && before.turn === view.turn;
  if (!sameTurn) return;
  const level = before.guesserId !== null && before.guesserId === me ? 1 : ONLOOKER_VOLUME;
  if (view.wrong > before.wrong) sfx.play('wrong', { volume: level });
  else if (view.usedLetters.length > before.usedLetters.length) sfx.play('right', { volume: level });
  if (before.phase === 'drawing' && view.phase !== 'drawing') sfx.play('section');
  if (view.phase === 'turnEnd' && before.phase !== 'turnEnd') {
    const outcome = view.outcome?.kind;
    if (outcome === 'solved') sfx.play('solved');
    else if (outcome === 'hangmanWins') sfx.play('hanged');
    else playCue('turnEnd');
  }
}
