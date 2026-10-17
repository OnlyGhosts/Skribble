import { useEffect, useState, type ReactNode } from 'react';
import type { BlackjackActions, BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { useHotkeys } from '../../../platform/lib/hotkeys';
import { AmountField } from '../../../platform/table/AmountField';
import { MoveButton, PanelLabelRow, PanelMoves, PanelShell, TableButton, WatchingPanel } from '../../../platform/table/ControlPanel';
import { DoubleIcon, HitIcon, SplitIcon, StandIcon } from '../../../platform/table/Icons';
import { dealNow, placeBet, playMove, queueBet, sitOut, skipTurn, type MoveKind } from '../actions';
import { suggestedMove, type MoveId } from '../lib/advice';
import type { Pending } from '../lib/pending';
import { betAmount, betWindow, defaultBet, doubleBet, halfBet, suggestedBet } from '../lib/bet';
import { useBlackjack, useBlackjackStore } from '../store';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  meId: string;
  /** The balance on show (a payout still animating is not on it yet). */
  balance: number;
  /** I watch the whole game: no moves, one line. */
  watching: boolean;
  /** Sends can go out: the game is running, the socket is up and the seat is back (no rejoin in flight). */
  canSend: boolean;
  /** My hand in play and the dealer's up card have landed: my moves may go (the rest of the deal can still be sliding in). */
  movesReady: boolean;
  /** The last round's reveal is still playing: the table actions wait for it (a Bet does not: the server takes it). */
  dealerPlaying: boolean;
  /** A tap of mine still waiting for the table's answer: every control is held. */
  pending: Pending | null;
  /** A bet tapped before the bets opened, to go out when they do. */
  queued: boolean;
  /** The player in play, for the host's Skip. */
  turnName: string;
  /** Desktop: the keyboard shortcuts. */
  hotkeys: boolean;
}

interface Move {
  id: MoveId & MoveKind;
  key: keyof BlackjackActions;
  label: string;
  hotkey: string;
  icon: ReactNode;
}

const MOVES: Record<MoveId, Move> = {
  hit: { id: 'hit', key: 'canHit', label: 'Hit', hotkey: 'H', icon: <HitIcon size={16} /> },
  stand: { id: 'stand', key: 'canStand', label: 'Stand', hotkey: 'S', icon: <StandIcon size={16} /> },
  split: { id: 'split', key: 'canSplit', label: 'Split', hotkey: 'P', icon: <SplitIcon size={16} /> },
  double: { id: 'double', key: 'canDouble', label: 'Double', hotkey: 'D', icon: <DoubleIcon size={16} /> },
};

/** After my Skip moves the play on, how long Skip stays dimmed for the next hand: a quick second tap must not stand it too. */
export const SKIP_REARM_MS = 700;

interface TableActionProps {
  view: BlackjackView;
  meId: string;
  turnName: string;
  /** The buttons may go: the socket is up, no tap is waiting, the reveal is over. */
  live: boolean;
  /** A spectator's panel: nothing at all when nothing is on offer. */
  watching?: boolean;
  /** The hand I just skipped (its turnKey): Skip stays dimmed until a little after the play has moved on. */
  skipped: string | null;
  onSkip(key: string): void;
}

/**
 * What a Bet tap does: bet on the round whose bets are open, or queue the bet for the round whose
 * bets are about to open (its outcomes are up), even while this phone still plays the reveal: the
 * server takes the bet either way. Null: Bet is not on offer.
 */
export function betTap(view: BlackjackView, meId: string, amount: number | null, opts: { canSend: boolean; held: boolean; queued: boolean }): 'place' | 'queue' | null {
  const seat = view.players[meId];
  if (!opts.canSend || opts.held || opts.queued || amount === null || !seat || seat.bustedOut || seat.bet > 0) return null;
  if (view.phase === 'betting' && view.order.includes(meId)) return 'place';
  if (view.phase === 'results' && seat.chips > 0) return 'queue';
  return null;
}

/** The hand in play, as a key: a new turn (or a new split hand) is a new key. */
export function turnKey(view: BlackjackView): string | null {
  return view.phase === 'acting' && view.turn ? `${view.round}:${view.turn.playerId}:${view.turn.handIndex}` : null;
}

/**
 * The table's own buttons under Bet: Sit out while my bet is still to place, Deal now once a bet
 * is down (both, for a host who has not bet, side by side), Skip on another player's turn. The row
 * keeps its place all game long: with none on offer, Sit out stays there dimmed (a spectator's
 * panel shows none).
 */
export function TableAction({ view, meId, turnName, live, watching = false, skipped, onSkip }: TableActionProps) {
  const { canSitOut, canDealNow, canSkip } = view.controls;
  const key = turnKey(view);
  if (live && canSkip && view.turn && key !== null) {
    const target = view.turn;
    const skip = () => {
      if (skipped === null && skipTurn(target, view, meId)) onSkip(key);
    };
    return <TableButton label="Skip" ariaLabel={`Stand ${turnName}’s hand`} testId="skip-turn" enabled={skipped === null} onClick={skip} />;
  }
  const sitOutOn = live && canSitOut;
  const dealNowOn = live && canDealNow;
  if (!sitOutOn && !dealNowOn) return watching ? null : <TableButton label="Sit out" ariaLabel="Sit this hand out" testId="sit-out-off" enabled={false} onClick={() => undefined} />;
  return (
    <>
      {sitOutOn && <TableButton label="Sit out" ariaLabel="Sit this hand out" testId="sit-out" onClick={() => void sitOut(view, meId)} />}
      {dealNowOn && <TableButton label="Deal now" ariaLabel="Deal now to everyone who has bet" testId="deal-now" onClick={() => void dealNow(view, meId)} />}
    </>
  );
}

/**
 * The control panel, the same place all game long: the bet amount (my stack beside its label) with
 * half, 2x and Max, then Hit and Stand, Split and Double, then one big Bet, and under it Sit out,
 * Deal now or Skip. Every control is always there; what is not on offer right now is
 * dimmed. On my turn the basic strategy move takes the lime. The amount is remembered between rounds.
 */
export function ControlPanel({ room, view, meId, balance, watching, canSend, movesReady, dealerPlaying, pending, queued, turnName, hotkeys }: Props) {
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
  const held = pending !== null;
  const tap = betTap(view, meId, amount, { canSend, held, queued });
  const canBet = tap !== null;
  const fieldOn = range !== null && canSend;
  // Away from the keyboard the field shows what Bet would send (a stack that shrank clamps it).
  const shown = editing || amount === null ? text : String(amount);
  const myTurn = view.phase === 'acting' && view.turn?.playerId === meId;
  const moveOn = (move: Move) => canSend && myTurn && movesReady && !held && view.actions[move.key];

  const setAmount = (n: number) => useBlackjackStore.getState().setBetText(String(n));
  const bet = () => {
    if (tap === null || amount === null) return;
    setAmount(amount);
    if (tap === 'place') placeBet(amount, view, meId);
    else queueBet(amount, view);
  };
  const play = (move: Move) => void playMove(move.id, view, meId);

  // Desktop shortcuts: Space bets, H S D P play.
  const keyed = (move: Move) => (moveOn(move) ? () => play(move) : null);
  useHotkeys(hotkeys, { Space: canBet ? bet : null, H: keyed(MOVES.hit), S: keyed(MOVES.stand), D: keyed(MOVES.double), P: keyed(MOVES.split) });

  // My turn: the usual play for the hand in play takes the lime; Bet goes quiet until the next round.
  const myHand = myTurn && view.turn ? seat?.hands[view.turn.handIndex] : undefined;
  const lit = myHand && movesReady ? suggestedMove(myHand.cards, view.dealer.cards[0], view.actions) : null;
  const moveButton = (move: Move) => (
    <MoveButton
      label={move.label}
      icon={move.icon}
      testId={`action-${move.id}`}
      enabled={moveOn(move)}
      onClick={() => play(move)}
      primary={lit === move.id && moveOn(move)}
      sent={pending?.kind === move.id}
      hotkey={hotkeys ? move.hotkey : undefined}
    />
  );

  const live = canSend && !held && !dealerPlaying;
  const placed = (view.phase === 'betting' && seat !== undefined && seat.bet > 0) || queued || pending?.kind === 'bet';
  // A spectator of the whole game has no moves: one line, and a watching host keeps Deal now and Skip.
  if (watching) return <WatchingPanel testId="bj-panel" actions={<TableAction view={view} meId={meId} turnName={turnName} live={live} watching skipped={skipped} onSkip={setSkipped} />} />;

  return (
    <PanelShell
      label="Bet and play"
      onSubmit={bet}
      testId="bj-panel"
      data={{ 'data-min': range?.min, 'data-max': range?.max, 'data-amount': amount ?? undefined }}
      actions={<TableAction view={view} meId={meId} turnName={turnName} live={live} skipped={skipped} onSkip={setSkipped} />}
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
          { label: '\u00bd', ariaLabel: 'Half the amount', testId: 'bet-half', onClick: () => range && setAmount(halfBet(amount ?? range.min, range)) },
          { label: '2x', ariaLabel: 'Double the amount', testId: 'bet-double', onClick: () => range && setAmount(doubleBet(amount ?? range.min, range)) },
          { label: 'Max', ariaLabel: 'All in', testId: 'bet-max', onClick: () => range && setAmount(range.max) },
        ]}
        describedBy="bj-bet-range"
        inputTestId="bet-input"
        clearTestId="bet-clear"
      />
      <span id="bj-bet-range" className="sr-only">
        {range ? `Any bet from 1 to ${range.max} chips` : 'No chips to bet'}
      </span>
      <PanelMoves count={4}>
        {moveButton(MOVES.hit)}
        {moveButton(MOVES.stand)}
        {moveButton(MOVES.split)}
        {moveButton(MOVES.double)}
      </PanelMoves>
      <button
        type="submit"
        className="btn btn--primary btn--lg btn--block tbl-panel__primary"
        disabled={!canBet}
        aria-keyshortcuts={hotkeys ? 'Space' : undefined}
        data-testid="place-bet"
        data-placed={placed}
        data-sent={(pending?.kind === 'bet' || queued) || undefined}
      >
        {placed ? 'Bet placed' : 'Bet'}
      </button>
    </PanelShell>
  );
}
