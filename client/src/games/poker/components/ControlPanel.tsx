import { useState } from 'react';
import type { PokerView } from '@shared/games/poker/protocol';
import { useHotkeys } from '../../../platform/lib/hotkeys';
import { AmountField } from '../../../platform/table/AmountField';
import { MoveButton, PanelLabelRow, PanelMoves, PanelShell, type PanelStatus } from '../../../platform/table/ControlPanel';
import { allIn, call, check, fold, wager } from '../actions';
import { amountFrom, potSized, raiseRange } from '../lib/raise';
import { HOTKEY_HINT, formatChips } from '../lib/text';
import { usePoker, usePokerStore } from '../store';

interface Props {
  view: PokerView;
  meId: string;
  /** My stack on show (a pot still sliding over is not on it yet). */
  balance: number;
  status: PanelStatus;
  /** Sends can go out: the game is running and the socket is up. */
  canSend: boolean;
  /** Cards or chips are still moving: the moves wait for them. */
  busy: boolean;
  /** Desktop: the keyboard shortcuts and their hint line. */
  hotkeys: boolean;
}

/**
 * The control panel, the same place all game long and the same shell as Blackjack's: the raise
 * amount with 1/2 pot, Pot and MAX joined to it, then Fold and Check or Call, then Bet or Raise
 * (named from the field) and All in. Every control is always there, lit only on my turn when it
 * is on offer. The amount starts at the minimum raise each turn.
 */
export function ControlPanel({ view, meId, balance, status, canSend, busy, hotkeys }: Props) {
  const seat = view.players[meId];
  const raiseText = usePoker((s) => s.raiseText);
  const [editing, setEditing] = useState(false);
  const { actions } = view;
  const myTurn = canSend && !busy && view.phase === 'acting' && view.turn === meId;
  const range = myTurn ? raiseRange(actions) : null;
  const text = raiseText ?? (range ? String(range.min) : '');
  const amount = range ? amountFrom(text, range) : null;
  const shown = editing || amount === null ? text : String(amount);
  const myBet = seat?.bet ?? 0;

  const setAmount = (n: number) => usePokerStore.getState().setRaiseText(String(n));
  const canWager = range !== null && amount !== null;
  const send = () => {
    if (!canWager || amount === null) return;
    wager(actions, amount);
  };
  const can = {
    fold: myTurn && actions.canFold,
    checkCall: myTurn && (actions.canCall || actions.canCheck),
    allIn: myTurn && actions.canAllIn,
  };
  const checkOrCall = () => (actions.canCall ? call() : check());
  useHotkeys(hotkeys, { F: can.fold ? () => void fold() : null, C: can.checkCall ? () => void checkOrCall() : null, R: canWager ? send : null, A: can.allIn ? () => void allIn() : null });

  const kind = range?.kind ?? (actions.canBet ? 'bet' : 'raise');
  const wagerLabel = amount !== null ? (kind === 'bet' ? `Bet ${formatChips(amount)}` : `Raise to ${formatChips(amount)}`) : kind === 'bet' ? 'Bet' : 'Raise';
  const callLabel = actions.canCall ? `Call ${formatChips(actions.callAmount)}` : 'Check';
  const steps = range
    ? [
        { label: '1/2 pot', ariaLabel: 'Half the pot', testId: 'raise-half', value: potSized(view, myBet, range, 0.5) },
        { label: 'Pot', ariaLabel: 'The pot', testId: 'raise-pot', value: potSized(view, myBet, range, 1) },
        { label: 'MAX', ariaLabel: 'All your chips', testId: 'raise-max', value: range.max },
      ]
    : [
        { label: '1/2 pot', ariaLabel: 'Half the pot', testId: 'raise-half', value: null },
        { label: 'Pot', ariaLabel: 'The pot', testId: 'raise-pot', value: null },
        { label: 'MAX', ariaLabel: 'All your chips', testId: 'raise-max', value: null },
      ];

  return (
    <PanelShell
      label="Your moves"
      status={status}
      onSubmit={send}
      testId="pk-panel"
      data={{ 'data-kind': range?.kind, 'data-min': range?.min, 'data-max': range?.max, 'data-amount': amount ?? undefined, 'data-my-turn': myTurn }}
      hint={hotkeys && HOTKEY_HINT}
    >
      <PanelLabelRow label={kind === 'bet' ? 'Bet amount' : 'Raise to'} htmlFor="pk-raise-amount" balance={balance} truth={seat?.chips ?? 0} />
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
      <PanelMoves>
        <MoveButton label="Fold" testId="action-fold" enabled={can.fold} onClick={() => void fold()} hotkey={hotkeys ? 'F' : undefined} />
        <MoveButton label={callLabel} testId={actions.canCall ? 'action-call' : 'action-check'} enabled={can.checkCall} onClick={() => void checkOrCall()} primary hotkey={hotkeys ? 'C' : undefined} data={{ 'data-amount': actions.canCall ? actions.callAmount : undefined }} />
        <MoveButton label={wagerLabel} testId="action-raise" enabled={canWager} onClick={send} hotkey={hotkeys ? 'R' : undefined} data={{ 'data-kind': kind }} />
        <MoveButton label="All in" testId="action-allin" enabled={can.allIn} onClick={() => void allIn()} hotkey={hotkeys ? 'A' : undefined} />
      </PanelMoves>
    </PanelShell>
  );
}
