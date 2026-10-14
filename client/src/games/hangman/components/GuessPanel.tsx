import { useRef, type RefObject } from 'react';
import type { HangmanRoomState, HangmanView } from '@shared/games/hangman/protocol';
import { GuessTiles } from '../../../platform/components/GuessTiles';
import { usePlatformStore } from '../../../platform/store/usePlatformStore';
import { guessLetter, guessWord } from '../actions';
import { isGuesser, isHangman, isOut, isWatching, nameOf } from '../hooks';
import { sectionLabel } from '../lib/text';
import { useHangman, useHangmanStore, type HangmanStore } from '../store';
import { KeyboardIcon } from './Icons';
import { LetterGrid } from './LetterGrid';

interface Props {
  room: HangmanRoomState;
  view: HangmanView;
  meId: string;
}

type GuessMode = HangmanStore['guessMode'];

/**
 * Switches between the keys and the word tiles. Opening the tiles marks them to take the focus
 * the moment they mount (still inside the tap), so the phone keyboard opens at once; GuessTiles
 * consumes the mark.
 */
export function toggleGuessMode(mode: GuessMode, focusMemory: RefObject<boolean>): void {
  const next: GuessMode = mode === 'word' ? 'letters' : 'word';
  focusMemory.current = next === 'word';
  useHangmanStore.getState().setGuessMode(next);
}

/** What the panel says above the keys to a player who is not guessing right now. */
function statusLine(room: HangmanRoomState, view: HangmanView, meId: string): { text: string; state: string } {
  const hangman = nameOf(room, view.hangmanId);
  if (isWatching(room, meId)) return { text: "You're watching this one.", state: 'watching' };
  if (isHangman(view, meId)) {
    if (view.phase === 'drawing' && view.section !== null) return { text: `Draw ${sectionLabel(view.section, view.maxWrong).toLowerCase()}.`, state: 'drawing' };
    return { text: view.guesserId ? `${nameOf(room, view.guesserId)} is guessing your word.` : 'Waiting for a guesser.', state: 'hangman' };
  }
  if (isOut(view, meId)) return { text: "Wrong word. You're out until the next word.", state: 'out' };
  if (view.phase === 'drawing' && view.section !== null) return { text: `${hangman} is drawing ${sectionLabel(view.section, view.maxWrong).toLowerCase()}.`, state: 'drawing' };
  if (view.phase === 'guessing') return { text: view.guesserId ? `${nameOf(room, view.guesserId)} is guessing.` : 'Waiting for a guesser to reconnect.', state: 'waiting' };
  return { text: '', state: view.phase };
}

/**
 * The keys (and, on request, the word tiles) for the current guesser; a read-only board for
 * everyone else. The "risk the word" button sits in the keys' last row so the whole keyboard
 * stays on one phone screen; in word mode it moves up beside the title.
 */
export function GuessPanel({ room, view, meId }: Props) {
  const mode = useHangman((s) => s.guessMode);
  const draft = useHangman((s) => s.wordDraft);
  const connected = usePlatformStore((s) => s.connection === 'connected');
  const { setWordDraft } = useHangmanStore.getState();
  const focusMemory = useRef(false);
  const mine = isGuesser(view, meId);
  const status = mine ? null : statusLine(room, view, meId);
  const modeButton = mine ? (
    <button type="button" className="btn btn--secondary btn--sm hm-panel__mode" onClick={() => toggleGuessMode(mode, focusMemory)} data-testid="guess-mode">
      <KeyboardIcon size={16} /> {mode === 'word' ? 'Back to letters' : 'Risk the word'}
    </button>
  ) : null;

  return (
    <div className="hm-panel" data-testid="guess-panel" data-state={mine ? 'mine' : status?.state} data-mode={mine ? mode : undefined}>
      {mine ? (
        <div className="hm-panel__head">
          <strong className="hm-panel__title" data-testid="guess-prompt">
            {mode === 'word' ? 'Type the whole word' : 'Your turn: pick a letter'}
          </strong>
          {mode === 'word' && modeButton}
        </div>
      ) : (
        <p className="hm-panel__status" data-testid="guess-status">
          {status?.text}
        </p>
      )}
      {mine && mode === 'word' ? (
        <GuessTiles
          mask={view.mask}
          draft={draft}
          onDraftChange={setWordDraft}
          onSubmit={guessWord}
          canSend={connected}
          placeholder="Type the word..."
          focusMemory={focusMemory}
          inputTestId="word-input"
          sendTestId="word-send"
        />
      ) : (
        <LetterGrid used={view.usedLetters} wrong={view.wrongLetters} enabled={mine && connected} onPick={guessLetter}>
          {modeButton}
        </LetterGrid>
      )}
    </div>
  );
}
