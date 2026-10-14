import { useEffect, useState, type KeyboardEvent } from 'react';
import { BLACKJACK_PAYOUTS, BLACKJACK_SETTINGS_LIMITS, type BlackjackPayout, type BlackjackSettings } from '@shared/games/blackjack/protocol';
import { RangeSetting, SettingRow, ToggleSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';
import { formatChips, parseChipAmount } from './lib/text';
import { ChipIcon } from './components/Icons';

const L = BLACKJACK_SETTINGS_LIMITS;

interface ChipsProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  presets: readonly number[];
  canEdit: boolean;
  onCommit(value: number): void;
  hint?: string;
}

/**
 * A chip amount: preset buttons for the usual stacks and a number field (the phone's numeric
 * keyboard) for anything else, committed on blur or Enter and clamped to the table's limits. A
 * field left blank commits nothing and shows the value again.
 */
function ChipsSetting({ id, label, value, min, max, presets, canEdit, onCommit, hint }: ChipsProps) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const commit = (next: number) => {
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  const commitText = () => commit(parseChipAmount(text, min, max) ?? value);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitText();
    }
  };
  const control = (
    <div className="bj-setting" data-testid={`settings-${id}-control`}>
      <div className="bj-setting__presets" role="group" aria-label={`${label} presets`}>
        {presets.map((preset) => (
          <button key={preset} type="button" className={`bj-setting__preset${preset === value ? ' is-selected' : ''}`} aria-pressed={preset === value} onClick={() => commit(preset)} data-testid={`settings-${id}-${preset}`}>
            {formatChips(preset)}
          </button>
        ))}
      </div>
      <label className="bj-setting__field">
        <ChipIcon size={18} className="bj-chips__coin" />
        <span className="sr-only">{label}</span>
        <input
          className="input bj-setting__input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={text}
          enterKeyHint="done"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commitText();
          }}
          onKeyDown={onKeyDown}
          data-testid={`settings-${id}`}
        />
      </label>
    </div>
  );
  return <SettingRow label={label} testId={id} value={formatChips(value)} hint={hint} control={canEdit ? control : undefined} />;
}

const PAYOUT_LABELS: Record<BlackjackPayout, string> = { '3:2': '3 to 2', '6:5': '6 to 5' };

/** Blackjack's rows in the lobby settings panel: the chips, the table limits, the rounds and the shoe, the clocks and the house rules. */
export function BlackjackSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<BlackjackSettings>) {
  const range = { canEdit, revision: settings };
  return (
    <>
      <ChipsSetting id="startingChips" label="Starting chips" value={settings.startingChips} min={L.startingChips.min} max={L.startingChips.max} presets={[500, 1000, 2500, 5000, 10000]} canEdit={canEdit} onCommit={(v) => patch({ startingChips: v })} hint="Every player starts with this stack; the chips are the score." />
      <ChipsSetting id="minBet" label="Minimum bet" value={settings.minBet} min={L.minBet.min} max={L.minBet.max} presets={[5, 10, 25, 50, 100]} canEdit={canEdit} onCommit={(v) => patch({ minBet: v })} hint="A player who cannot cover the minimum is out of the game." />
      <ChipsSetting id="maxBet" label="Maximum bet" value={settings.maxBet} min={Math.max(L.maxBet.min, settings.minBet)} max={L.maxBet.max} presets={[100, 250, 500, 1000, 5000]} canEdit={canEdit} onCommit={(v) => patch({ maxBet: v })} />
      <RangeSetting id="rounds" label="Rounds" value={settings.rounds} min={L.rounds.min} max={L.rounds.max} onCommit={(v) => patch({ rounds: v })} {...range} />
      <RangeSetting id="decks" label="Decks in the shoe" rowLabel="Decks" value={settings.decks} min={L.decks.min} max={L.decks.max} onCommit={(v) => patch({ decks: v })} hint="The shoe is reshuffled once under a quarter of it remains." {...range} />
      <RangeSetting id="betSeconds" label="Betting time in seconds" rowLabel="Betting time" value={settings.betSeconds} display={`${settings.betSeconds}s`} min={L.betSeconds.min} max={L.betSeconds.max} onCommit={(v) => patch({ betSeconds: v })} hint="Whoever has not bet by then plays the minimum." {...range} />
      <RangeSetting id="actSeconds" label="Move time in seconds" rowLabel="Move time" value={settings.actSeconds} display={`${settings.actSeconds}s`} min={L.actSeconds.min} max={L.actSeconds.max} onCommit={(v) => patch({ actSeconds: v })} hint="A hand that runs out of time stands." {...range} />
      <RangeSetting id="resultsSeconds" label="Results time in seconds" rowLabel="Results time" value={settings.resultsSeconds} display={`${settings.resultsSeconds}s`} min={L.resultsSeconds.min} max={L.resultsSeconds.max} onCommit={(v) => patch({ resultsSeconds: v })} hint="The host can skip ahead at any time." {...range} />
      <SettingRow
        label="Blackjack pays"
        testId="blackjackPayout"
        value={PAYOUT_LABELS[settings.blackjackPayout]}
        control={
          canEdit ? (
            <div className="bj-setting__presets" role="radiogroup" aria-label="Blackjack pays" data-testid="settings-blackjackPayout" data-value={settings.blackjackPayout}>
              {BLACKJACK_PAYOUTS.map((payout) => (
                <button key={payout} type="button" role="radio" aria-checked={payout === settings.blackjackPayout} className={`bj-setting__preset${payout === settings.blackjackPayout ? ' is-selected' : ''}`} onClick={() => patch({ blackjackPayout: payout })} data-testid={`settings-blackjackPayout-${payout.replace(':', '-')}`}>
                  {PAYOUT_LABELS[payout]}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
      <ToggleSetting id="dealerHitsSoft17" checked={settings.dealerHitsSoft17} disabled={!canEdit} onChange={(v) => patch({ dealerHitsSoft17: v })} label="Dealer hits soft 17" hint="The dealer draws on a 17 with an ace counted as 11." />
      <ToggleSetting id="allowDouble" checked={settings.allowDouble} disabled={!canEdit} onChange={(v) => patch({ allowDouble: v })} label="Doubling down" hint="Double the stake on your first two cards for exactly one more card." />
      <ToggleSetting id="allowSplit" checked={settings.allowSplit} disabled={!canEdit} onChange={(v) => patch({ allowSplit: v })} label="Splitting pairs" hint="One split per round; split aces get one card each; 21 after a split pays 1 to 1." />
    </>
  );
}
