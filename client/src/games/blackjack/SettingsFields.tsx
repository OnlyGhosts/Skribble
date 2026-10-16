import { BLACKJACK_SETTINGS_LIMITS, type BlackjackSettings } from '@shared/games/blackjack/protocol';
import type { SettingsFieldsProps } from '../../platform/game';
import { ChipsSetting } from '../../platform/components/ChipsSetting';

const L = BLACKJACK_SETTINGS_LIMITS;

/**
 * Blackjack's one row in the lobby settings panel: the starting chips. The house rules are fixed
 * (the dealer stands on 17, a natural pays 3 to 2, doubling and splitting always allowed), and there
 * are no rounds, table limits, clocks or decks to set: any bet up to the stack, until one stack is
 * left, the table waits for its players, and the deck never runs out.
 */
export function BlackjackSettingsFields({ settings, patch }: SettingsFieldsProps<BlackjackSettings>) {
  return <ChipsSetting id="startingChips" label="Starting chips" value={settings.startingChips} min={L.startingChips.min} max={L.startingChips.max} presets={[500, 1000, 2500, 5000, 10000]} onCommit={(v) => patch({ startingChips: v })} hint="Every player starts with this stack. Bet any amount of it. The chips are the score." />;
}
