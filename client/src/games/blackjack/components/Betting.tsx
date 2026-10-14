import { useEffect, useState, type FormEvent } from 'react';
import { placeBet } from '../actions';
import { clampBet } from '../hooks';
import { formatChips } from '../lib/text';
import { useBlackjack, useBlackjackStore } from '../store';
import { ChipIcon } from '../../../platform/components/Chips';

interface Props {
  minBet: number;
  /** The most this seat may stake: the table maximum or the player's chips. */
  cap: number;
  /** The stake already down, when the panel re-opened to change it. */
  current: number;
  /** The socket is up and the game running. */
  canSend: boolean;
}

const STEPS = [10, 50, 100] as const;

/** The betting panel: the amount (typed, slid or tapped up in steps) and one big Place bet. */
export function Betting({ minBet, cap, current, canSend }: Props) {
  const draft = useBlackjack((s) => s.betDraft);
  const lastBet = useBlackjack((s) => s.lastBet);
  const amount = clampBet(draft ?? (current || lastBet || minBet), minBet, cap);
  const [text, setText] = useState(String(amount));
  useEffect(() => setText(String(amount)), [amount]);
  const set = (next: number) => useBlackjackStore.getState().setBetDraft(clampBet(next, minBet, cap));
  const commitText = () => set(Number(text));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = clampBet(Number(text), minBet, cap);
    set(value);
    placeBet(value);
  };
  const allIn = cap < minBet;
  return (
    <form className="bj-bet" onSubmit={submit} noValidate data-testid="bet-panel" data-min={minBet} data-max={cap} data-amount={amount}>
      <div className="bj-bet__head">
        <span className="bj-bet__title">{current > 0 ? 'Change your bet' : 'Your bet'}</span>
        <span className="bj-bet__range">
          {formatChips(minBet)} – {formatChips(cap)}
        </span>
      </div>
      <label className="bj-bet__amount">
        <ChipIcon size={22} className="chip-count__coin" />
        <span className="sr-only">Bet amount in chips</span>
        <input
          className="input bj-bet__input"
          type="number"
          inputMode="numeric"
          min={minBet}
          max={cap}
          step={1}
          value={text}
          enterKeyHint="go"
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          data-testid="bet-input"
        />
      </label>
      <input className="range bj-bet__slider" type="range" min={minBet} max={cap} step={1} value={amount} aria-label="Bet amount" onChange={(e) => set(Number(e.target.value))} data-testid="bet-slider" />
      <div className="bj-bet__quick" role="group" aria-label="Quick bets">
        <button type="button" className="btn btn--ghost btn--sm bj-bet__quick-btn" onClick={() => set(minBet)} data-testid="bet-min">
          Min
        </button>
        {STEPS.map((step) => (
          <button key={step} type="button" className="btn btn--ghost btn--sm bj-bet__quick-btn" onClick={() => set(amount + step)} data-testid={`bet-plus-${step}`}>
            +{step}
          </button>
        ))}
        <button type="button" className="btn btn--ghost btn--sm bj-bet__quick-btn" onClick={() => set(amount * 2)} data-testid="bet-double">
          ×2
        </button>
        <button type="button" className="btn btn--ghost btn--sm bj-bet__quick-btn" onClick={() => set(cap)} data-testid="bet-max">
          Max
        </button>
      </div>
      <button type="submit" className="btn btn--primary btn--lg btn--block bj-bet__place" disabled={!canSend || allIn} data-testid="place-bet">
        {current > 0 ? 'Change bet' : 'Place bet'} · {formatChips(amount)}
      </button>
    </form>
  );
}
