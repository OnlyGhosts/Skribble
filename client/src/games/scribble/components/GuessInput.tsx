import { GuessTiles } from '../../../platform/components/GuessTiles';
import { sendChat } from '../../../platform/net/actions';
import { usePlatformStore } from '../../../platform/store/usePlatformStore';
import { useScribbleStore } from '../store';

/** The guesser's input during a drawing turn: the platform's word tiles, sending the guess as a chat line. */
export function GuessInput({ mask }: { mask: string }) {
  const draft = useScribbleStore((s) => s.guessDraft);
  const setDraft = useScribbleStore((s) => s.setGuessDraft);
  const connected = usePlatformStore((s) => s.connection === 'connected');
  return <GuessTiles mask={mask} draft={draft} onDraftChange={setDraft} onSubmit={sendChat} canSend={connected} />;
}
