import { gameById } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import type { AnyGameClientModule } from '../game';
import { updateSettings } from '../net/actions';
import { ContentModeSetting } from './ContentModeSetting';
import { ReadoutWidthScope } from './SettingControls';

interface Props {
  room: RoomState;
  game: AnyGameClientModule | null;
}

/**
 * The host's settings: the platform's own (the content mode), then the game's
 * `SettingsFields` under them. Only the host's room renders it. The content mode only shows for a
 * game that reads it (GameMeta.contentModes); for the others it stays stored, so switching back
 * restores it.
 */
export function SettingsPanel({ room, game }: Props) {
  const settings = room.settings;
  const GameFields = game?.SettingsFields;

  return (
    <div className="settings" data-testid="settings-panel">
      <ReadoutWidthScope>
        {gameById(room.gameId).contentModes && <ContentModeSetting value={settings.contentMode} onChange={(contentMode) => updateSettings({ contentMode })} />}
        {GameFields && <GameFields settings={settings} patch={(partial) => updateSettings(partial)} />}
      </ReadoutWidthScope>
    </div>
  );
}
