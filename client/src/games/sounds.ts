/**
 * Every sound bank the app can load: the platform's, the note cues and each game's. Kept free of
 * React and CSS so the unit tests and the e2e suite can read it to check every file is served and
 * the whole set stays within budget.
 */
import { PLATFORM_SOUNDS } from '../platform/lib/platformSounds';
import { soundBanks, type AnySoundBank } from '../platform/lib/sound';
import { battleshipsSounds } from './battleships/sounds';
import { blackjackSounds } from './blackjack/sounds';
import { hangmanSounds } from './hangman/sounds';
import { pokerSounds } from './poker/sounds';
import { quipgameSounds } from './quipgame/sounds';
import { skribbleSounds } from './skribble/sounds';
import { spygameSounds } from './spygame/sounds';

/** All the sound files together stay under this many bytes. */
export const SOUND_BUDGET_BYTES = 800 * 1024;

export const GAME_SOUND_BANKS: readonly AnySoundBank[] = [skribbleSounds, quipgameSounds, spygameSounds, hangmanSounds, battleshipsSounds, blackjackSounds, pokerSounds];

/** Every bank, the platform's and the cues' included. */
export function allSoundBanks(): AnySoundBank[] {
  return [...new Set([PLATFORM_SOUNDS, ...GAME_SOUND_BANKS, ...soundBanks()])];
}

/** Every file any bank may play, as URL paths, once each. */
export function allSoundUrls(): string[] {
  return [...new Set(allSoundBanks().flatMap((b) => b.urls))].sort();
}
