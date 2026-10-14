import { useEffect, useState, type FormEvent } from 'react';
import type { PokerView } from '@shared/games/poker/protocol';
import { ChipIcon } from '../../../platform/components/Chips';
import { call, check, fold, wager } from '../actions';
import { clampAmount, presetsFor, raiseRange, type RaiseRange } from '../lib/raise';
import { formatChips } from '../lib/text';
import { usePoker, usePokerStore } from '../store';

interface Props {
  view: PokerView;
  meId: string;
  myTurn: boolean;
  /** The socket is up and the game running. */
  canSend: boolean;
}

function confirmLabel(range: RaiseRange, amount: number): string {
  if (amount >= range.max) return `All in · ${formatChips(amount)}`;
  return range.kind === 'bet' ? `Bet ${formatChips(amount)}` : `Raise to ${formatChips(amount)}`;
}

/** The bet/raise panel: the amount (typed, slid or picked from the presets) and one confirm. */
function RaisePanel({ view, meId, range, canSend }: { view: PokerView; meId: string; range: RaiseRange; canSend: boolean }) {
  const draft = usePoker((s) => s.raiseDraft);
  const amount = clampAmount(draft ?? range.min, range);
  const [text, setText] = useState(String(amount));
  useEffect(() => setText(String(amount)), [amount]);
  const set = (next: number) => usePokerStore.getState().setRaiseDraft(clampAmount(next, range));
  const presets = presetsFor(view, view.players[meId]?.bet ?? 0, range);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = clampAmount(Number(text), range);
    set(value);
    wager(view.actions, value);
  };
  const fixed = range.min >= range.max;
  return (
    <form className="pk-raise" onSubmit={submit} noValidate data-testid="raise-panel" data-kind={range.kind} data-min={range.min} data-max={range.max} data-amount={amount}>
      <div className="pk-raise__head">
        <span className="pk-raise__title">{range.kind === 'bet' ? 'Bet' : 'Raise to'}</span>
        <span className="pk-raise__range">
          {formatChips(range.min)} – {formatChips(range.max)}
        </span>
      </div>
      <label className="pk-raise__amount">
        <ChipIcon size={22} className="chip-count__coin" />
        <span className="sr-only">{range.kind === 'bet' ? 'Bet amount in chips' : 'Raise to, in chips'}</span>
        <input
          className="input pk-raise__input"
          type="number"
          inputMode="numeric"
          min={range.min}
          max={range.max}
          step={1}
          value={text}
          enterKeyHint="go"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => set(Number(text))}
          disabled={fixed}
          data-testid="raise-input"
        />
      </label>
      {!fixed && <input className="range pk-raise__slider" type="range" min={range.min} max={range.max} step={1} value={amount} aria-label="Amount" onChange={(e) => set(Number(e.target.value))} data-testid="raise-slider" />}
      <div className="pk-raise__presets" role="group" aria-label="Quick amounts">
        {presets.map((p) => (
          <button key={p.id} type="button" className={`btn btn--ghost btn--sm pk-raise__preset${p.amount === amount ? ' is-selected' : ''}`} aria-pressed={p.amount === amount} onClick={() => set(p.amount)} data-testid={`raise-${p.id}`} data-amount={p.amount}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="pk-raise__confirm-row">
        <button type="button" className="btn btn--secondary pk-raise__cancel" onClick={() => usePokerStore.getState().openRaise(false)} data-testid="raise-cancel">
          Cancel
        </button>
        <button type="submit" className="btn btn--primary pk-raise__confirm" disabled={!canSend} data-testid="raise-confirm">
          {confirmLabel(range, amount)}
        </button>
      </div>
    </form>
  );
}

/**
 * Fold, Check or Call, and Bet or Raise (which opens the panel). The bar stays on screen, greyed
 * out, while I am in the hand and waiting, so the layout holds still when my move comes.
 */
export function ActionBar({ view, meId, myTurn, canSend }: Props) {
  const raiseOpen = usePoker((s) => s.raiseOpen);
  const seat = view.players[meId];
  if (!seat) return null;
  const { actions } = view;
  const enabled = canSend && myTurn;
  const range = raiseRange(actions);

  if (seat.status === 'allIn') {
    return (
      <div className="pk-actions pk-actions--note" data-testid="actions" data-my-turn="false">
        <p className="pk-actions__note">You are all in — sit back and watch the cards.</p>
      </div>
    );
  }
  if (enabled && raiseOpen && range) {
    return (
      <div className="pk-actions" data-testid="actions" data-my-turn={myTurn}>
        <RaisePanel view={view} meId={meId} range={range} canSend={canSend} />
      </div>
    );
  }
  const shortCall = actions.canCall && actions.callAmount >= seat.chips;
  return (
    <div className="pk-actions" role="group" aria-label="Your moves" data-testid="actions" data-my-turn={myTurn}>
      <div className="pk-actions__row">
        <button type="button" className="btn btn--secondary pk-action pk-action--fold" onClick={fold} disabled={!(enabled && actions.canFold)} data-testid="action-fold">
          Fold
        </button>
        {actions.canCall ? (
          <button type="button" className="btn btn--secondary pk-action" onClick={call} disabled={!enabled} data-testid="action-call" data-amount={actions.callAmount}>
            {shortCall ? `All in ${formatChips(actions.callAmount)}` : `Call ${formatChips(actions.callAmount)}`}
          </button>
        ) : (
          <button type="button" className="btn btn--secondary pk-action" onClick={check} disabled={!(enabled && actions.canCheck)} data-testid="action-check">
            Check
          </button>
        )}
        <button
          type="button"
          className="btn btn--primary pk-action"
          onClick={() => usePokerStore.getState().openRaise(true)}
          disabled={!(enabled && range)}
          aria-haspopup="true"
          data-testid="action-raise"
          data-kind={range?.kind ?? 'raise'}
        >
          {range?.kind === 'bet' ? 'Bet…' : 'Raise…'}
        </button>
      </div>
    </div>
  );
}
