import { BLACKJACK_PAYOUTS, BLACKJACK_SETTINGS_LIMITS, DEFAULT_BLACKJACK_SETTINGS, UNLIMITED_ROUNDS, type BlackjackPayout, type BlackjackSettings } from '@shared/games/blackjack/protocol';
import { RangeSetting, SettingRow, ToggleSetting } from '../../platform/components/SettingControls';
import type { SettingsFieldsProps } from '../../platform/game';
import { ChipsSetting } from '../../platform/components/ChipsSetting';

const L = BLACKJACK_SETTINGS_LIMITS;

const PAYOUT_LABELS: Record<BlackjackPayout, string> = { '3:2': '3 to 2', '6:5': '6 to 5' };

/** Blackjack's rows in the lobby settings panel: the chips, the table limits, the rounds and the shoe, the clocks and the house rules. */
export function BlackjackSettingsFields({ settings, canEdit, patch }: SettingsFieldsProps<BlackjackSettings>) {
  const range = { canEdit, revision: settings };
  const unlimited = settings.rounds === UNLIMITED_ROUNDS;
  return (
    <>
      <ChipsSetting id="startingChips" label="Starting chips" value={settings.startingChips} min={L.startingChips.min} max={L.startingChips.max} presets={[500, 1000, 2500, 5000, 10000]} canEdit={canEdit} onCommit={(v) => patch({ startingChips: v })} hint="Every player starts with this stack. The chips are the score." />
      <ChipsSetting id="minBet" label="Minimum bet" value={settings.minBet} min={L.minBet.min} max={L.minBet.max} presets={[5, 10, 25, 50, 100]} canEdit={canEdit} onCommit={(v) => patch({ minBet: v })} hint="A player who cannot cover the minimum is out." />
      <ChipsSetting id="maxBet" label="Maximum bet" value={settings.maxBet} min={Math.max(L.maxBet.min, settings.minBet)} max={L.maxBet.max} presets={[100, 250, 500, 1000, 5000]} canEdit={canEdit} onCommit={(v) => patch({ maxBet: v })} />
      <ToggleSetting
        id="unlimitedRounds"
        checked={unlimited}
        disabled={!canEdit}
        onChange={(on) => patch({ rounds: on ? UNLIMITED_ROUNDS : DEFAULT_BLACKJACK_SETTINGS.rounds })}
        label="Unlimited rounds"
        hint="Play until one player has chips left, or until the host ends the game."
      />
      {unlimited ? (
        <SettingRow label="Rounds" testId="rounds" value="Unlimited" />
      ) : (
        <RangeSetting id="rounds" label="Rounds" value={settings.rounds} min={1} max={L.rounds.max} onCommit={(v) => patch({ rounds: v })} {...range} />
      )}
      <RangeSetting id="decks" label="Decks in the shoe" rowLabel="Decks" value={settings.decks} min={L.decks.min} max={L.decks.max} onCommit={(v) => patch({ decks: v })} hint="The shoe is reshuffled once under a quarter of it is left." {...range} />
      <RangeSetting id="betSeconds" label="Betting time in seconds" rowLabel="Betting time" value={settings.betSeconds} display={`${settings.betSeconds}s`} min={L.betSeconds.min} max={L.betSeconds.max} onCommit={(v) => patch({ betSeconds: v })} hint="Anyone who has not bet by then plays the minimum." {...range} />
      <RangeSetting id="actSeconds" label="Turn time in seconds" rowLabel="Turn time" value={settings.actSeconds} display={`${settings.actSeconds}s`} min={L.actSeconds.min} max={L.actSeconds.max} onCommit={(v) => patch({ actSeconds: v })} hint="A hand that runs out of time stands." {...range} />
      <RangeSetting id="resultsSeconds" label="Final table time in seconds" rowLabel="Final table" value={settings.resultsSeconds} display={`${settings.resultsSeconds}s`} min={L.resultsSeconds.min} max={L.resultsSeconds.max} onCommit={(v) => patch({ resultsSeconds: v })} hint="How long the last hand stays up before the podium." {...range} />
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
      <ToggleSetting id="allowSplit" checked={settings.allowSplit} disabled={!canEdit} onChange={(v) => patch({ allowSplit: v })} label="Splitting pairs" hint="Split pairs up to four hands. Split aces get one card each. 21 after a split pays 1 to 1." />
    </>
  );
}
