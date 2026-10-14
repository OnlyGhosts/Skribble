import { POKER_SETTINGS_LIMITS, type PokerSettings } from '@shared/games/poker/protocol';
import { ChipsSetting } from '../../platform/components/ChipsSetting';
import { RangeSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';
import { formatChips } from '../../platform/lib/format';

const L = POKER_SETTINGS_LIMITS;

export function blindsIncreaseLabel(every: number): string {
  if (every === 0) return 'Never';
  return every === 1 ? 'Every hand' : `Every ${every} hands`;
}

export function handsLabel(hands: number): string {
  return hands === 0 ? 'Until one is left' : String(hands);
}

/** Poker's rows in the lobby settings panel: the stacks, the blinds and how they climb, the length of the game and the clocks. */
export function PokerSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<PokerSettings>) {
  const range = { canEdit, revision: settings };
  const maxSmall = Math.min(L.smallBlind.max, Math.floor(settings.startingChips / 2));
  return (
    <>
      <ChipsSetting id="startingChips" label="Starting chips" value={settings.startingChips} min={L.startingChips.min} max={L.startingChips.max} presets={[500, 1000, 2500, 5000, 10000]} canEdit={canEdit} onCommit={(v) => patch({ startingChips: v })} hint="Every player starts with this stack; the chips are the score." />
      <ChipsSetting
        id="smallBlind"
        label="Blinds"
        value={settings.smallBlind}
        min={L.smallBlind.min}
        max={maxSmall}
        presets={[1, 5, 10, 25, 50, 100].filter((b) => b <= maxSmall)}
        canEdit={canEdit}
        onCommit={(v) => patch({ smallBlind: v })}
        display={`${formatChips(settings.smallBlind)}/${formatChips(settings.smallBlind * 2)}`}
        hint="The small blind; the big blind is twice it."
      />
      <RangeSetting id="blindsIncreaseEvery" label="Double the blinds every this many hands" rowLabel="Blinds double" value={settings.blindsIncreaseEvery} display={blindsIncreaseLabel(settings.blindsIncreaseEvery)} min={L.blindsIncreaseEvery.min} max={L.blindsIncreaseEvery.max} onCommit={(v) => patch({ blindsIncreaseEvery: v })} hint="0 keeps them fixed all game." {...range} />
      <RangeSetting id="hands" label="Hands to play" rowLabel="Hands" value={settings.hands} display={handsLabel(settings.hands)} min={L.hands.min} max={L.hands.max} onCommit={(v) => patch({ hands: v })} hint="0 plays until one player has every chip." {...range} />
      <RangeSetting id="actSeconds" label="Move time in seconds" rowLabel="Move time" value={settings.actSeconds} display={`${settings.actSeconds}s`} min={L.actSeconds.min} max={L.actSeconds.max} onCommit={(v) => patch({ actSeconds: v })} hint="Out of time: a check when it is free, otherwise a fold." {...range} />
      <RangeSetting id="resultsSeconds" label="Results time in seconds" rowLabel="Results time" value={settings.resultsSeconds} display={`${settings.resultsSeconds}s`} min={L.resultsSeconds.min} max={L.resultsSeconds.max} onCommit={(v) => patch({ resultsSeconds: v })} hint="The host can deal the next hand at any time." {...range} />
    </>
  );
}
