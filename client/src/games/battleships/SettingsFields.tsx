import { BATTLESHIPS_BOARD_SIZES, BATTLESHIPS_FLEETS, BATTLESHIPS_SETTINGS_LIMITS, type BattleshipsSettings } from '@shared/games/battleships/protocol';
import { RangeSetting, SettingRow, ToggleSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';

const L = BATTLESHIPS_SETTINGS_LIMITS;

interface ChoiceProps<T extends string | number> {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; blurb?: string }>;
  canEdit: boolean;
  onChange(value: T): void;
  hint?: string;
}

/** A row of options the host taps (a radio group); everyone else reads the chosen one. */
function ChoiceSetting<T extends string | number>({ id, label, value, options, canEdit, onChange, hint }: ChoiceProps<T>) {
  const current = options.find((o) => o.value === value);
  const control = (
    <div className="bs-choice" role="radiogroup" aria-label={label} data-testid={`settings-${id}`} data-value={String(value)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`bs-choice__option${o.value === value ? ' is-selected' : ''}`}
          disabled={!canEdit}
          onClick={() => onChange(o.value)}
          data-testid={`settings-${id}-${o.value}`}
        >
          <span className="bs-choice__label">{o.label}</span>
          {o.blurb && <span className="bs-choice__blurb">{o.blurb}</span>}
        </button>
      ))}
    </div>
  );
  return <SettingRow label={label} testId={id} value={current?.label ?? String(value)} hint={hint} control={canEdit ? control : undefined} />;
}

/** Battleships' rows in the lobby settings panel: mode, board, fleet, the two clocks and the dice. */
export function BattleshipsSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<BattleshipsSettings>) {
  const range = { canEdit, revision: settings };
  return (
    <>
      <ChoiceSetting
        id="mode"
        label="Mode"
        value={settings.mode}
        canEdit={canEdit}
        onChange={(mode) => patch({ mode })}
        options={[
          { value: 'solo', label: 'Every player for themselves', blurb: 'A board and a fleet each.' },
          { value: 'teams', label: 'Two teams', blurb: 'One shared board per team; the captain places.' },
        ]}
      />
      <ChoiceSetting
        id="boardSize"
        label="Board"
        value={settings.boardSize}
        canEdit={canEdit}
        onChange={(boardSize) => patch({ boardSize })}
        options={BATTLESHIPS_BOARD_SIZES.map((size) => ({ value: size, label: `${size} × ${size}` }))}
      />
      <ChoiceSetting
        id="fleet"
        label="Fleet"
        value={settings.fleet}
        canEdit={canEdit}
        onChange={(fleet) => patch({ fleet })}
        options={(Object.keys(BATTLESHIPS_FLEETS) as Array<keyof typeof BATTLESHIPS_FLEETS>).map((fleet) => ({
          value: fleet,
          label: fleet === 'small' ? 'Small' : 'Classic',
          blurb: `Ships of ${BATTLESHIPS_FLEETS[fleet].join(', ')}`,
        }))}
      />
      <RangeSetting
        id="placeSeconds"
        label="Placing time in seconds"
        rowLabel="Placing time"
        value={settings.placeSeconds}
        display={`${settings.placeSeconds}s`}
        min={L.placeSeconds.min}
        max={L.placeSeconds.max}
        onCommit={(v) => patch({ placeSeconds: v })}
        hint="Fleets not placed in time take random positions."
        {...range}
      />
      <RangeSetting
        id="turnSeconds"
        label="Turn time in seconds"
        rowLabel="Turn time"
        value={settings.turnSeconds}
        display={`${settings.turnSeconds}s`}
        min={L.turnSeconds.min}
        max={L.turnSeconds.max}
        onCommit={(v) => patch({ turnSeconds: v })}
        hint="A shot is fired for you when the clock runs out."
        {...range}
      />
      <ToggleSetting id="diceMoves" checked={settings.diceMoves} disabled={!canEdit} onChange={(v) => patch({ diceMoves: v })} label="Dice moves" hint="Roll a die after every shot: a 5 or 6 lets you secretly slide an undamaged ship one cell." />
    </>
  );
}
