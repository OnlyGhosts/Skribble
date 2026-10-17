import { useState } from 'react';
import type { PokerView } from '@shared/games/poker/protocol';
import { useHotkeys } from '../../../platform/lib/hotkeys';
import { AmountField } from '../../../platform/table/AmountField';
import { MoveButton, PanelLabelRow, PanelMoves, PanelShell, WatchingPanel } from '../../../platform/table/ControlPanel';
import { AllInIcon, FoldIcon, RaiseIcon } from '../../../platform/table/Icons';
import { allIn, call, check, fold, wager } from '../actions';
import { amountFrom, idleAmount, potSized, raiseRange, wagerKind } from '../lib/raise';
import { formatChips } from '../lib/text';
import { seatAnchor } from '../lib/timeline';
import { usePoker, usePokerStore } from '../store';

interface Props {
  view: PokerView;
  meId: string;
  /** My stack on show (a pot still sliding over is not on it yet). */
  balance: number;
  /** I watch the whole game: no moves, one line. */
  watching: boolean;
  /** Sends can go out: the game is running, the socket is up and the seat is back (no rejoin in flight). */
  canSend: boolean;
  /** Cards or chips are still moving: the moves wait for them. */
  busy: boolean;
  /** Desktop: the keyboard shortcuts. */
  hotkeys: boolean;
}

/**
 * The control panel, the same place all game long and the same shell as Blackjack's: the raise
 * amount (my stack beside its label) with half pot, Pot and Max by it, then Fold, Bet or Raise
 * (sending the amount) and All in in one row, then the main move, Check or Call, as the one big
 * button. Every control is always there, lit only on my turn when it
 * is on offer. The amount starts at the minimum raise each turn.
 */
export function ControlPanel({ view, meId, balance, watching, canSend, busy, hotkeys }: Props) {
  const seat = view.players[meId];
  const raiseText = usePoker((s) => s.raiseText);
  const pending = usePoker((s) => s.pending);
  const [editing, setEditing] = useState(false);
  const { actions } = view;
  // A move of mine still waiting for the table's answer holds them all: a second tap never plays twice.
  const myTurn = canSend && !busy && pending === null && view.phase === 'acting' && view.turn === meId;
  const range = myTurn ? raiseRange(actions) : null;
  // Off my turn the field keeps what I last typed, or the least raise the table would take, dimmed: never an empty box.
  const text = raiseText ?? String(range ? range.min : idleAmount(view));
  const amount = range ? amountFrom(text, range) : null;
  const shown = editing || amount === null ? text : String(amount);
  const myBet = seat?.bet ?? 0;

  const setAmount = (n: number) => usePokerStore.getState().setRaiseText(String(n));
  const canWager = range !== null && amount !== null;
  const send = () => {
    if (!canWager || amount === null) return;
    wager(view, actions, amount);
  };
  const can = {
    fold: myTurn && actions.canFold,
    checkCall: myTurn && (actions.canCall || actions.canCheck),
    allIn: myTurn && actions.canAllIn,
  };
  const checkOrCall = () => (actions.canCall ? call(view) : check(view));
  useHotkeys(hotkeys, { F: can.fold ? () => void fold(view) : null, C: can.checkCall ? () => void checkOrCall() : null, R: canWager ? send : null, A: can.allIn ? () => void allIn(view) : null });
  const sent = (move: string) => pending?.move === move;

  const kind = wagerKind(view, range);
  const wagerWord = kind === 'bet' ? 'Bet' : 'Raise';
  // The button says the move; the field above it says the amount ("Raise to" 80).
  const wagerAria = amount !== null ? (kind === 'bet' ? `Bet ${amount}` : `Raise to ${amount}`) : wagerWord;
  const callLabel = actions.canCall ? `Call ${formatChips(actions.callAmount)}` : 'Check';
  const steps = [
    { label: '\u00bd pot', ariaLabel: 'Half the pot', testId: 'raise-half', value: range ? potSized(view, myBet, range, 0.5) : null },
    { label: 'Pot', ariaLabel: 'The pot', testId: 'raise-pot', value: range ? potSized(view, myBet, range, 1) : null },
    { label: 'Max', ariaLabel: 'All your chips', testId: 'raise-max', value: range ? range.max : null },
  ];

  // A spectator of the whole game has no moves at all: one line in place of the controls.
  if (watching) return <WatchingPanel testId="pk-panel" />;

  return (
    <PanelShell
      label="Your moves"
      onSubmit={send}
      testId="pk-panel"
      data={{ 'data-kind': range?.kind, 'data-min': range?.min, 'data-max': range?.max, 'data-amount': amount ?? undefined, 'data-my-turn': myTurn }}
    >
      <PanelLabelRow label={kind === 'bet' ? 'Bet amount' : 'Raise to'} htmlFor="pk-raise-amount" balance={balance} truth={seat?.chips ?? 0} anchor={seatAnchor(meId)} />
      <AmountField
        id="pk-raise-amount"
        value={shown}
        enabled={range !== null}
        onChange={(t) => usePokerStore.getState().setRaiseText(t)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          if (amount !== null) setAmount(amount);
        }}
        onClear={() => usePokerStore.getState().setRaiseText('')}
        steps={steps.map((s) => ({ label: s.label, ariaLabel: s.ariaLabel, testId: s.testId, pressed: s.value !== null && s.value === amount, onClick: () => s.value !== null && setAmount(s.value) }))}
        describedBy="pk-raise-range"
        inputTestId="raise-input"
        clearTestId="raise-clear"
      />
      <span id="pk-raise-range" className="sr-only">
        {range ? `Between ${range.min} and ${range.max} chips` : 'No raise possible'}
      </span>
      <PanelMoves count={3}>
        <MoveButton label="Fold" icon={<FoldIcon size={16} />} testId="action-fold" enabled={can.fold} onClick={() => void fold(view)} sent={sent('fold')} hotkey={hotkeys ? 'F' : undefined} />
        <MoveButton label={wagerWord} ariaLabel={wagerAria} icon={<RaiseIcon size={16} />} testId="action-raise" enabled={canWager} onClick={send} sent={sent('bet') || sent('raise')} hotkey={hotkeys ? 'R' : undefined} data={{ 'data-kind': kind, 'data-amount': amount ?? undefined }} />
        <MoveButton label="All in" icon={<AllInIcon size={16} />} testId="action-allin" enabled={can.allIn} onClick={() => void allIn(view)} sent={sent('allIn')} hotkey={hotkeys ? 'A' : undefined} />
      </PanelMoves>
      <button
        type="button"
        className="btn btn--primary btn--lg btn--block tbl-panel__primary"
        disabled={!can.checkCall}
        onClick={() => void checkOrCall()}
        aria-keyshortcuts={hotkeys ? 'C' : undefined}
        data-testid={actions.canCall ? 'action-call' : 'action-check'}
        data-amount={actions.canCall ? actions.callAmount : undefined}
        data-sent={sent('call') || sent('check') || undefined}
      >
        {callLabel}
      </button>
    </PanelShell>
  );
}
