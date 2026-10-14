import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { BlackjackActions, BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { ChipIcon, Chips } from '../../../platform/components/Chips';
import { CloseIcon } from '../../../platform/components/Icons';
import { double, hit, placeBet, split, stand } from '../actions';
import { betAmount, betWindow, defaultBet, doubleBet, halfBet } from '../lib/bet';
import { HOTKEY_HINT, type PanelStatus } from '../lib/text';
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

/** Typing in a field (the bet amount, the chat) keeps the letters for itself. */
function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/**
 * The control panel, the same place all game long: the bet amount with 1/2, 2x and MAX, then Hit
 * and Stand, Split and Double, then one big Bet. Every control is always there; what is not on
 * offer right now is dimmed. The amount is remembered between rounds.
 */
export function ControlPanel({ room, view, meId, balance, status, canSend, busy, hotkeys }: Props) {
  const settings = room.settings;
  const seat = view.players[meId];
  const betText = useBlackjack((s) => s.betText);
  const lastBet = useBlackjack((s) => s.lastBet);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);

  const range = seat && !seat.bustedOut ? betWindow(settings.minBet, settings.maxBet, seat.chips, seat.bet) : null;
  const text = betText ?? (range ? String(defaultBet(lastBet, range)) : '');
  const amount = range ? betAmount(text, range) : null;
  const canBet = canSend && range !== null && amount !== null && view.phase === 'betting' && view.order.includes(meId) && seat !== undefined && seat.bet === 0;
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    bet();
  };

  // Desktop shortcuts: Space bets, H S D P play. Re-bound every render so they always see the current state.
  const latest = useRef({ bet, moveOn, canBet });
  latest.current = { bet, moveOn, canBet };
  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || typingIn(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const { bet: doBet, moveOn: on, canBet: betOk } = latest.current;
      if (e.key === ' ') {
        if (!betOk) return;
        e.preventDefault();
        doBet();
        return;
      }
      const move = Object.values(MOVES).find((m) => m.hotkey === e.key.toUpperCase());
      if (move && on(move)) {
        e.preventDefault();
        move.send();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeys]);

  const moveButton = (move: Move, primary = false) => (
    <button
      type="button"
      className={`btn ${primary ? 'btn--primary' : 'btn--secondary'} bj-move`}
      onClick={() => move.send()}
      disabled={!moveOn(move)}
      aria-keyshortcuts={hotkeys ? move.hotkey : undefined}
      data-testid={`action-${move.id}`}
    >
      {move.label}
    </button>
  );

  return (
    <form className="bj-panel" onSubmit={submit} noValidate aria-label="Bet and play" data-testid="bj-panel" data-min={range?.min} data-max={range?.max} data-amount={amount ?? undefined}>
      <p className={`bj-panel__status bj-panel__status--${status.state}`} data-testid="turn-status" data-state={status.state} role="status" aria-live="polite">
        {status.text}
      </p>
      <div className="bj-panel__label-row">
        <label className="bj-panel__label" htmlFor="bj-bet-amount">
          Bet amount
        </label>
        <span className="bj-panel__balance" data-testid="my-chips" data-chips={seat?.chips ?? 0} aria-label={`Balance ${balance} chips`}>
          <Chips value={balance} size={14} />
        </span>
      </div>
      <div className="bj-amount">
        <div className={`bj-amount__field${fieldOn ? '' : ' is-off'}`}>
          <ChipIcon size={18} className="chip-count__coin bj-amount__coin" />
          <input
            ref={inputRef}
            id="bj-bet-amount"
            className="bj-amount__input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="go"
            value={shown}
            disabled={!fieldOn}
            onChange={(e) => useBlackjackStore.getState().setBetText(e.target.value.replace(/[^0-9]/g, ''))}
            onFocus={() => setEditing(true)}
            onBlur={() => {
              setEditing(false);
              if (amount !== null) setAmount(amount);
            }}
            aria-describedby="bj-bet-range"
            data-testid="bet-input"
          />
          {text !== '' && fieldOn && (
            <button
              type="button"
              className="bj-amount__clear"
              aria-label="Clear the amount"
              onClick={() => {
                useBlackjackStore.getState().setBetText('');
                inputRef.current?.focus();
              }}
              data-testid="bet-clear"
            >
              <CloseIcon size={14} />
            </button>
          )}
        </div>
        <div className="bj-amount__steps" role="group" aria-label="Change the amount">
          <button type="button" className="bj-amount__step" disabled={!fieldOn} onClick={() => range && setAmount(halfBet(amount ?? range.min, range))} aria-label="Half the amount" data-testid="bet-half">
            1/2
          </button>
          <button type="button" className="bj-amount__step" disabled={!fieldOn} onClick={() => range && setAmount(doubleBet(amount ?? range.min, range))} aria-label="Double the amount" data-testid="bet-double">
            2x
          </button>
          <button type="button" className="bj-amount__step" disabled={!fieldOn} onClick={() => range && setAmount(range.max)} aria-label="Maximum amount" data-testid="bet-max">
            MAX
          </button>
        </div>
      </div>
      <span id="bj-bet-range" className="sr-only">
        {range ? `Between ${range.min} and ${range.max} chips` : 'No bet possible'}
      </span>
      <div className="bj-panel__moves" role="group" aria-label="Your moves">
        {moveButton(MOVES.hit, true)}
        {moveButton(MOVES.stand)}
        {moveButton(MOVES.split)}
        {moveButton(MOVES.double)}
      </div>
      <button type="submit" className="btn btn--primary btn--lg btn--block bj-panel__bet" disabled={!canBet} aria-keyshortcuts={hotkeys ? 'Space' : undefined} data-testid="place-bet" data-placed={seat !== undefined && seat.bet > 0 && view.phase === 'betting'}>
        {view.phase === 'betting' && seat !== undefined && seat.bet > 0 ? 'Bet placed' : 'Bet'}
      </button>
      {hotkeys && (
        <p className="bj-panel__hint" data-testid="hotkey-hint">
          {HOTKEY_HINT}
        </p>
      )}
    </form>
  );
}
