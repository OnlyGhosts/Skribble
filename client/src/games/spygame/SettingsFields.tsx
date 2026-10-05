import { SPYGAME_SETTINGS_LIMITS, type SpygameSettings } from '@shared/games/spygame/protocol';
import { RangeSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';

const L = SPYGAME_SETTINGS_LIMITS;

/** The Spy Game's rows in the lobby settings panel: rounds, the round clock and the vote window. */
export function SpygameSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<SpygameSettings>) {
  const range = { canEdit, revision: settings };
  return (
    <>
      <RangeSetting id="rounds" label="Rounds" value={settings.rounds} min={L.rounds.min} max={L.rounds.max} onCommit={(v) => patch({ rounds: v })} hint="One spy per round; the spy rotates." {...range} />
      <RangeSetting
        id="roundMinutes"
        label="Round length in minutes"
        rowLabel="Round length"
        value={settings.roundMinutes}
        display={`${settings.roundMinutes} min`}
        min={L.roundMinutes.min}
        max={L.roundMinutes.max}
        onCommit={(v) => patch({ roundMinutes: v })}
        hint="When the clock runs out the agents win."
        {...range}
      />
      <RangeSetting
        id="voteSeconds"
        label="Vote window in seconds"
        rowLabel="Vote window"
        value={settings.voteSeconds}
        display={`${settings.voteSeconds}s`}
        min={L.voteSeconds.min}
        max={L.voteSeconds.max}
        step={L.voteSeconds.step}
        onCommit={(v) => patch({ voteSeconds: v })}
        hint="Missing votes count as No."
        {...range}
      />
    </>
  );
}
