import { useEffect, useState } from 'react';
import type { BlackjackActions, BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { useHotkeys } from '../../../platform/lib/hotkeys';
import { AmountField } from '../../../platform/table/AmountField';
import { MoveButton, PanelLabelRow, PanelMoves, PanelShell, StatusAction, type PanelStatus } from '../../../platform/table/ControlPanel';
import { dealNow, double, hit, placeBet, sitOut, skipTurn, split, stand } from '../actions';
import { betAmount, betWindow, defaultBet, doubleBet, halfBet, suggestedBet } from '../lib/bet';
import { HOTKEY_HINT } from '../lib/text';
import { useBlackjack, useBlackjackStore } from '../store';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  meId: string;
  /** The balance on show (a payout still animating is not on it yet). */
  balance: number;
  status: PanelStatus;
  /** Sends can go out: the game is running and the socket is up. */
  canSend: boolean;
  /** Cards are still landing: the moves wait for them. */
  busy: boolean;
  /** The player in play, for the host's Skip. */
  turnName: string;
  /** Desktop: the keyboard shortcuts and their hint line. */
  hotkeys: boolean;
}

interface Move {
  id: 'hit' | 'stand' | 'split' | 'double';
  key: keyof BlackjackActions;
  label: string;
  hotkey: string;
  send(): boolean;
}

const MOVES: Record<Move['id'], Move> = {
  hit: { id: 'hit', key: 'canHit', label: 'Hit', hotkey: 'H', send: hit },
  stand: { id: 'stand', key: 'canStand', label: 'Stand', hotkey: 'S', send: stand },
  split: { id: 'split', key: 'canSplit', label: 'Split', hotkey: 'P', send: split },
  double: { id: 'double', key: 'canDouble', label: 'Double', hotkey: 'D', send: double },
};

/** After my Skip moves the play on, how long Skip stays dimmed for the next hand: a quick second tap must not stand it too. */
export const SKIP_REARM_MS = 700;

interface TableActionProps {
  view: BlackjackView;
  turnName: string;
  /** The hand I just skipped (its turnKey): Skip stays dimmed until a little after the play has moved on. */
  skipped: string | null;
  onSkip(key: string): void;
}

/** The hand in play, as a key: a new turn (or a new split hand) is a new key. */
export function turnKey(view: BlackjackView): string | null {
  return view.phase === 'acting' && view.turn ? `${view.round}:${view.turn.playerId}:${view.turn.handIndex}` : null;
}

/**
 * The table controls on offer beside the status line: Sit out while my bet is still to place, Deal
 * now once a bet is down (both, for a host who has not bet), Skip on another player's turn.
 */
export function TableAction({ view, turnName, skipped, onSkip }: TableActionProps) {
  const { canSitOut, canDealNow, canSkip } = view.controls;
  const key = turnKey(view);
  if (canSkip && view.turn && key !== null) {
    const target = view.turn;
    const skip = () => {
      if (skipped === null && skipTurn(target)) onSkip(key);
    };
    return <StatusAction label="Skip" ariaLabel={`Stand ${turnName}'s hand`} testId="skip-turn" enabled={skipped === null} onClick={skip} />;
  }
  return (
    <>
      {canSitOut && <StatusAction label="Sit out" ariaLabel="Sit this hand out" testId="sit-out" onClick={() => void sitOut()} />}
      {canDealNow && <StatusAction label="Deal now" ariaLabel="Deal now to everyone who has bet" testId="deal-now" onClick={() => void dealNow()} />}
    </>
  );
}

/**
 * The control panel, the same place all game long: the bet amount with 1/2, 2x and MAX, then Hit
 * and Stand, Split and Double, then one big Bet. Every control is always there; what is not on
 * offer right now is dimmed. The amount is remembered between rounds.
 */
export function ControlPanel({ room, view, meId, balance, status, canSend, busy, turnName, hotkeys }: Props) {
  const settings = room.settings;
  const seat = view.players[meId];
  const betText = useBlackjack((s) => s.betText);
  const lastBet = useBlackjack((s) => s.lastBet);
  const [editing, setEditing] = useState(false);
  const [skipped, setSkipped] = useState<string | null>(null);
  const turn = turnKey(view);
  // Once the hand I skipped is over, Skip comes back for the next one after a beat.
  useEffect(() => {
    if (skipped === null || skipped === turn) return undefined;
    const t = window.setTimeout(() => setSkipped(null), SKIP_REARM_MS);
    return () => window.clearTimeout(t);
  }, [turn, skipped]);

  const range = seat && !seat.bustedOut ? betWindow(seat.chips, seat.bet) : null;
  const text = betText ?? (range ? String(defaultBet(lastBet, range, suggestedBet(settings.startingChips))) : '');
  const amount = range ? betAmount(text, range) : null;
  const canBet = canSend && !busy && range !== null && amount !== null && view.phase === 'betting' && view.order.includes(meId) && seat !== undefined && seat.bet === 0;
  const fieldOn = range !== null && canSend;
  // Away from the keyboard the field shows what Bet would send (a stack that shrank clamps it).
  const shown = editing || amount === null ? text : String(amount);
  const myTurn = view.phase === 'acting' && view.turn?.playerId === meId;
  const moveOn = (move: Move) => canSend && myTurn && !busy && view.actions[move.key];

  const setAmount = (n: number) => useBlackjackStore.getState().setBetText(String(n));
  const bet = () => {
    if (!canBet || amount === null) return;
    setAmount(amount);
    placeBet(amount);
  };

  // Desktop shortcuts: Space bets, H S D P play.
  const keyed = (move: Move) => (moveOn(move) ? () => void move.send() : null);
  useHotkeys(hotkeys, { Space: canBet ? bet : null, H: keyed(MOVES.hit), S: keyed(MOVES.stand), D: keyed(MOVES.double), P: keyed(MOVES.split) });

  const moveButton = (move: Move, primary = false) => (
    <MoveButton label={move.label} testId={`action-${move.id}`} enabled={moveOn(move)} onClick={() => move.send()} primary={primary} hotkey={hotkeys ? move.hotkey : undefined} />
  );

  return (
    <PanelShell
      label="Bet and play"
      status={status}
      onSubmit={bet}
      testId="bj-panel"
      data={{ 'data-min': range?.min, 'data-max': range?.max, 'data-amount': amount ?? undefined }}
      hint={hotkeys && HOTKEY_HINT}
      action={canSend && !busy && <TableAction view={view} turnName={turnName} skipped={skipped} onSkip={setSkipped} />}
      actionSlot
    >
      <PanelLabelRow label="Bet amount" htmlFor="bj-bet-amount" balance={balance} truth={seat?.chips ?? 0} />
      <AmountField
        id="bj-bet-amount"
        value={shown}
        enabled={fieldOn}
        onChange={(t) => useBlackjackStore.getState().setBetText(t)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          if (amount !== null) setAmount(amount);
        }}
        onClear={() => useBlackjackStore.getState().setBetText('')}
        steps={[
          { label: '1/2', ariaLabel: 'Half the amount', testId: 'bet-half', onClick: () => range && setAmount(halfBet(amount ?? range.min, range)) },
          { label: '2x', ariaLabel: 'Double the amount', testId: 'bet-double', onClick: () => range && setAmount(doubleBet(amount ?? range.min, range)) },
          { label: 'MAX', ariaLabel: 'All in', testId: 'bet-max', onClick: () => range && setAmount(range.max) },
        ]}
        describedBy="bj-bet-range"
        inputTestId="bet-input"
        clearTestId="bet-clear"
      />
      <span id="bj-bet-range" className="sr-only">
        {range ? `Any bet from 1 to ${range.max} chips` : 'No chips to bet'}
      </span>
      <PanelMoves>
        {moveButton(MOVES.hit, true)}
        {moveButton(MOVES.stand)}
        {moveButton(MOVES.split)}
        {moveButton(MOVES.double)}
      </PanelMoves>
      <button type="submit" className="btn btn--primary btn--lg btn--block tbl-panel__primary" disabled={!canBet} aria-keyshortcuts={hotkeys ? 'Space' : undefined} data-testid="place-bet" data-placed={seat !== undefined && seat.bet > 0 && view.phase === 'betting'}>
        {view.phase === 'betting' && seat !== undefined && seat.bet > 0 ? 'Bet placed' : 'Bet'}
      </button>
    </PanelShell>
  );
}
