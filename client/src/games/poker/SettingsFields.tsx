import { POKER_SETTINGS_LIMITS, type PokerSettings } from '@shared/games/poker/protocol';
import { ChipsSetting } from '../../platform/components/ChipsSetting';
import { RangeSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';
import { formatChips } from '../../platform/lib/format';

const L = POKER_SETTINGS_LIMITS;

/* The readouts stay short (the panel gives every slider the widest one's width); the hints say what 0 means. */
export function blindsIncreaseLabel(every: number): string {
  if (every === 0) return 'Never';
  return every === 1 ? 'Every hand' : `Every ${every}`;
}

export function handsLabel(hands: number): string {
  return hands === 0 ? 'No limit' : String(hands);
}

/** Poker's rows in the lobby settings panel: the stacks, the blinds and how they climb, and the length of the game. The clocks are fixed. */
export function PokerSettingsFields({ settings, patch }: SettingsFieldsProps<PokerSettings>) {
  const range = { revision: settings };
  const maxSmall = Math.min(L.smallBlind.max, Math.floor(settings.startingChips / 2));
  return (
    <>
      <ChipsSetting id="startingChips" label="Starting chips" value={settings.startingChips} min={L.startingChips.min} max={L.startingChips.max} presets={[500, 1000, 2500, 5000, 10000]} onCommit={(v) => patch({ startingChips: v })} hint="Every player starts with this stack; the chips are the score." />
      <ChipsSetting
        id="smallBlind"
        label="Blinds"
        value={settings.smallBlind}
        min={L.smallBlind.min}
        max={maxSmall}
        presets={[1, 5, 10, 25, 50, 100].filter((b) => b <= maxSmall)}
        onCommit={(v) => patch({ smallBlind: v })}
        hint={`The small blind. The big blind is twice it, so the blinds are ${formatChips(settings.smallBlind)}/${formatChips(settings.smallBlind * 2)}.`}
      />
      <RangeSetting id="blindsIncreaseEvery" label="Double the blinds every this many hands" rowLabel="Blinds double" value={settings.blindsIncreaseEvery} format={blindsIncreaseLabel} min={L.blindsIncreaseEvery.min} max={L.blindsIncreaseEvery.max} onCommit={(v) => patch({ blindsIncreaseEvery: v })} hint="Counted in hands. 0 keeps them fixed all game." {...range} />
      <RangeSetting id="hands" label="Hands to play" rowLabel="Hands" value={settings.hands} format={handsLabel} min={L.hands.min} max={L.hands.max} onCommit={(v) => patch({ hands: v })} hint="0 plays until one player has every chip." {...range} />
    </>
  );
}
