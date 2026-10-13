import type { ChatInputProps } from '../../../platform/game';
import { selectMe } from '../../../platform/store/selectors';
import { usePlatformStore } from '../../../platform/store/usePlatformStore';
import { selectHasGuessed, selectIsDrawer, selectPhase } from '../hooks';
import { GuessInput } from './GuessInput';

/** An unsolved guesser types into the word tiles; everyone else (the drawer, solved guessers, players sitting out) gets the ordinary chat input. */
export function SkribbleChatInput({ focusMemory, defaultInput }: ChatInputProps) {
  const mask = usePlatformStore((s) => {
    const phase = selectPhase(s);
    return phase?.kind === 'drawing' ? phase.mask : null;
  });
  const isDrawer = usePlatformStore(selectIsDrawer);
  const hasGuessed = usePlatformStore(selectHasGuessed);
  const participating = usePlatformStore((s) => selectMe(s)?.participating ?? false);
  const guessMode = mask !== null && participating && !isDrawer && !hasGuessed;
  return guessMode ? <GuessInput mask={mask} focusMemory={focusMemory} /> : <>{defaultInput}</>;
}
