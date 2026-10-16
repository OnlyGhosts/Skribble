import { SPYGAME_SETTINGS_LIMITS, type SpygameSettings } from '@shared/games/spygame/protocol';
import { RangeSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';

const L = SPYGAME_SETTINGS_LIMITS;

/** The Spy Game's row in the lobby settings panel: the rounds. The round clock and the vote window are fixed. */
export function SpygameSettingsFields({ settings, patch }: SettingsFieldsProps<SpygameSettings>) {
  return <RangeSetting id="rounds" label="Rounds" value={settings.rounds} min={L.rounds.min} max={L.rounds.max} onCommit={(v) => patch({ rounds: v })} hint="One spy per round; the spy rotates." revision={settings} />;
}
