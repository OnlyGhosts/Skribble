import type { RoomState } from '@shared/platform/protocol';
import type { AnyGameClientModule } from '../game';
import { updateSettings } from '../net/actions';
import { ContentModeSetting } from './ContentModeSetting';
import { ToggleSetting } from './SettingControls';

interface Props {
  room: RoomState;
  isHost: boolean;
  game: AnyGameClientModule | null;
}

/** The platform's own settings (content mode, mid-game joins), then the game's `SettingsFields` under them. Only the host sends patches. */
export function SettingsPanel({ room, isHost, game }: Props) {
  const settings = room.settings;
  const send = (patch: Record<string, unknown>) => {
    if (isHost) updateSettings(patch);
  };
  const GameFields = game?.SettingsFields;

  return (
    <div className={`settings${isHost ? '' : ' settings--readonly'}`} data-testid="settings-panel">
      {!isHost && <p className="settings__note">Only the host can change settings.</p>}
      <ContentModeSetting value={settings.contentMode} canEdit={isHost} onChange={(contentMode) => send({ contentMode })} />
      <ToggleSetting
        id="allowMidGameJoin"
        checked={settings.allowMidGameJoin}
        disabled={!isHost}
        onChange={(v) => send({ allowMidGameJoin: v })}
        label="Allow joining mid-game"
        hint="Friends with the code can hop in while a game is running."
      />
      {GameFields && <GameFields settings={settings} canEdit={isHost} patch={(partial) => send(partial)} />}
    </div>
  );
}
