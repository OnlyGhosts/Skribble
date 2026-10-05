import { gameById, type GameMeta } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import type { AnyGameClientModule } from '../game';
import { updateSettings } from '../net/actions';
import { RangeSetting, ToggleSetting } from './SettingControls';

interface Props {
  room: RoomState;
  isHost: boolean;
  game: AnyGameClientModule | null;
}

/** The slider cannot ask for fewer seats than are taken: the server would clamp the patch and the thumb would lie. */
export function maxPlayersMin(playerCount: number, meta: GameMeta): number {
  return Math.min(meta.maxPlayers, Math.max(meta.minPlayers, playerCount));
}

/** The platform's own settings, then the game's `SettingsFields` under them. Only the host sends patches. */
export function SettingsPanel({ room, isHost, game }: Props) {
  const meta = gameById(room.gameId);
  const settings = room.settings;
  const send = (patch: Record<string, unknown>) => {
    if (isHost) updateSettings(patch);
  };
  const GameFields = game?.SettingsFields;

  return (
    <div className={`settings${isHost ? '' : ' settings--readonly'}`} data-testid="settings-panel">
      {!isHost && <p className="settings__note">Only the host can change settings.</p>}
      <RangeSetting
        id="maxPlayers"
        label="Maximum players"
        rowLabel="Max players"
        canEdit={isHost}
        value={settings.maxPlayers}
        min={maxPlayersMin(room.players.length, meta)}
        max={meta.maxPlayers}
        onCommit={(v) => send({ maxPlayers: v })}
        revision={settings}
      />
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
