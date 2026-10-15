import { BLACKJACK_PAYOUTS, BLACKJACK_SETTINGS_LIMITS, type BlackjackPayout, type BlackjackSettings } from '@shared/games/blackjack/protocol';
import { SettingRow, ToggleSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';
import { ChipsSetting } from '../../platform/components/ChipsSetting';

const L = BLACKJACK_SETTINGS_LIMITS;

const PAYOUT_LABELS: Record<BlackjackPayout, string> = { '3:2': '3 to 2', '6:5': '6 to 5' };

/**
 * Blackjack's rows in the lobby settings panel: the chips and the house rules. There are no rounds,
 * table limits, clocks or decks to set: any bet up to the stack, until one stack is left, the table
 * waits for its players, and the deck never runs out.
 */
export function BlackjackSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<BlackjackSettings>) {
  return (
    <>
      <ChipsSetting id="startingChips" label="Starting chips" value={settings.startingChips} min={L.startingChips.min} max={L.startingChips.max} presets={[500, 1000, 2500, 5000, 10000]} canEdit={canEdit} onCommit={(v) => patch({ startingChips: v })} hint="Every player starts with this stack. Bet any amount of it. The chips are the score." />
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
      <ToggleSetting id="allowDouble" checked={settings.allowDouble} disabled={!canEdit} onChange={(v) => patch({ allowDouble: v })} label="Doubling down" hint="Double the stake on two cards for exactly one more card, after a split too." />
      <ToggleSetting id="allowSplit" checked={settings.allowSplit} disabled={!canEdit} onChange={(v) => patch({ allowSplit: v })} label="Splitting pairs" hint="Split any pair, and split again on another pair. Split aces get one card each. 21 after a split pays 1 to 1." />
    </>
  );
}
