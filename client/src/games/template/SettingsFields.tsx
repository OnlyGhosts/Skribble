import { TEMPLATE_SETTINGS_LIMITS, type TemplateSettings } from '@shared/games/template/protocol';
import { RangeSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';

const L = TEMPLATE_SETTINGS_LIMITS;

/** Click Race's two rows in the lobby settings panel. */
export function ClickRaceSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<TemplateSettings>) {
  return (
    <>
      <RangeSetting
        id="targetClicks"
        label="Taps to win"
        canEdit={canEdit}
        value={settings.targetClicks}
        min={L.targetClicks.min}
        max={L.targetClicks.max}
        onCommit={(v) => patch({ targetClicks: v })}
        hint="The first player to reach this many taps wins the race."
        revision={settings}
      />
      <RangeSetting
        id="timeLimit"
        label="Time limit in seconds"
        rowLabel="Time limit"
        canEdit={canEdit}
        value={settings.timeLimit}
        display={`${settings.timeLimit}s`}
        min={L.timeLimit.min}
        max={L.timeLimit.max}
        onCommit={(v) => patch({ timeLimit: v })}
        revision={settings}
      />
    </>
  );
}
