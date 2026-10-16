import { useLive } from '../../../platform/lib/useLive';
import { selectMe } from '../../../platform/store/selectors';
import { usePlatformStore } from '../../../platform/store/usePlatformStore';
import { selectHasGuessed, selectIsDrawer, selectPhase } from '../hooks';
import { guessBoxLine } from '../lib/format';
import { GuessInput } from './GuessInput';

/**
 * Under the guess feed: an unsolved guesser types into the word tiles; everyone else (the drawer,
 * solved guessers, players sitting out, and everyone between drawings) reads one short line in
 * the same place, so the canvas never jumps.
 */
export function GuessBox() {
  const phase = useLive(usePlatformStore, selectPhase);
  const isDrawer = useLive(usePlatformStore, selectIsDrawer);
  const hasGuessed = useLive(usePlatformStore, selectHasGuessed);
  const participating = useLive(usePlatformStore, (s) => selectMe(s)?.participating ?? false);
  if (phase?.kind === 'drawing' && participating && !isDrawer && !hasGuessed) return <GuessInput mask={phase.mask} />;
  return (
    <p className="guess-idle" data-testid="guess-idle">
      {guessBoxLine(phase?.kind, isDrawer, hasGuessed, participating)}
    </p>
  );
}
