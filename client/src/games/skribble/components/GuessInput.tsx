import type { RefObject } from 'react';
import { GuessTiles } from '../../../platform/components/GuessTiles';
import { sendChat } from '../../../platform/net/actions';
import { usePlatformStore } from '../../../platform/store/usePlatformStore';
import { useSkribbleStore } from '../store';

interface Props {
  mask: string;
  /**
   * Shared with the plain chat input: set when this input unmounts while focused so the input
   * that replaces it (after a correct guess) takes the focus and the phone keyboard stays open.
   */
  focusMemory: RefObject<boolean>;
}

/** The guesser's input during a drawing turn: the platform's word tiles, sending the guess as a chat line. */
export function GuessInput({ mask, focusMemory }: Props) {
  const draft = useSkribbleStore((s) => s.guessDraft);
  const setDraft = useSkribbleStore((s) => s.setGuessDraft);
  const connected = usePlatformStore((s) => s.connection === 'connected');
  return <GuessTiles mask={mask} draft={draft} onDraftChange={setDraft} onSubmit={sendChat} canSend={connected} focusMemory={focusMemory} />;
}
