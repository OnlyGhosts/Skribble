import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { EyeIcon } from '../components/Icons';
import { WATCHING_TEXT } from '../lib/watching';
import { StackCount } from './Stakes';

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface ShellProps {
  label: string;
  onSubmit(): void;
  testId: string;
  data?: DataAttrs;
  /**
   * The table's own buttons under the main one (Blackjack's Sit out, Deal now, Skip): full width,
   * in a row that keeps its place whether or not one is on offer, so the panel never jumps.
   */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * A button clicked with a mouse or a tap (`detail` > 0) lets go of the focus, so Space stays the
 * table's shortcut (click MAX, then Space bets) instead of pressing that button again. A keyboard
 * press (`detail` 0) keeps the focus where the player put it.
 */
export function releaseClickedButton(e: { detail: number; target: EventTarget | null }): void {
  if (e.detail === 0) return;
  const t = e.target as { closest?: (selector: string) => unknown } | null;
  const button = t && typeof t.closest === 'function' ? (t.closest('button') as { blur?: () => void } | null) : null;
  button?.blur?.();
}

/**
 * The control panel shell, the same place all game long: the game's rows, then the table's own
 * buttons. Whose turn it is lives on the table, not here. A form, so Enter in the amount sends.
 */
export function PanelShell({ label, onSubmit, testId, data, actions, children }: ShellProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form className="tbl-panel" onSubmit={submit} onClick={releaseClickedButton} noValidate aria-label={label} data-testid={testId} {...data}>
      {children}
      {actions !== undefined && <div className="tbl-panel__actions">{actions}</div>}
    </form>
  );
}

/**
 * A spectator's panel in place of the controls: one quiet line saying they watch and can play the
 * next game. A host who watches keeps the table's buttons under it (Deal now, Skip).
 */
export function WatchingPanel({ testId, actions }: { testId: string; actions?: ReactNode }) {
  return (
    <section className="tbl-panel tbl-panel--watching" aria-label="Watching" data-testid={testId} data-watching="true">
      <p className="tbl-panel__watching" data-testid="watching-note">
        <span className="tbl-panel__watch-icon" aria-hidden="true">
          <EyeIcon size={18} />
        </span>
        <span>{WATCHING_TEXT}</span>
      </p>
      {actions && <div className="tbl-panel__actions">{actions}</div>}
    </section>
  );
}

/** One of the table's own buttons under the main one: a full-width secondary button, dimmed when not on offer. */
export function TableButton({ label, ariaLabel, testId, onClick, enabled = true }: { label: string; ariaLabel?: string; testId: string; onClick(): void; enabled?: boolean }) {
  return (
    <button type="button" className="btn btn--secondary btn--block tbl-panel__act" onClick={onClick} disabled={!enabled} aria-label={ariaLabel} data-testid={testId}>
      {label}
    </button>
  );
}

/**
 * Row 1: what the amount is for, and my stack (`truth` is the real count behind a balance still
 * catching up). `anchor`: where my chips fly from and back to (Poker's `seat:<id>`).
 */
export function PanelLabelRow({ label, htmlFor, balance, truth, anchor }: { label: string; htmlFor: string; balance: number; truth: number; anchor?: string }) {
  return (
    <div className="tbl-panel__label-row">
      <label className="tbl-panel__label" htmlFor={htmlFor}>
        {label}
      </label>
      <span className="tbl-panel__balance" data-testid="my-chips" data-chips={truth} data-table-anchor={anchor} aria-label={`Balance ${balance} chips`}>
        <StackCount value={balance} />
      </span>
    </div>
  );
}

/** The moves, two to a row (three in one row; all in one row on a phone); every one always there. */
export function PanelMoves({ label = 'Your moves', count, children }: { label?: string; count: number; children: ReactNode }) {
  return (
    <div className={`tbl-panel__moves${count === 3 ? ' tbl-panel__moves--3' : ''}`} style={{ '--moves': count } as CSSProperties} role="group" aria-label={label}>
      {children}
    </div>
  );
}

interface MoveProps {
  label: string;
  /** What a screen reader hears when the label alone is short of it ("Raise to 80" for "Raise"). */
  ariaLabel?: string;
  testId: string;
  enabled: boolean;
  onClick(): void;
  primary?: boolean;
  /** Desktop: the key that does the same (aria-keyshortcuts). */
  hotkey?: string;
  /** A small icon after the label. */
  icon?: ReactNode;
  /** Just tapped and on its way: it stays pressed (and every move waits) until the table answers. */
  sent?: boolean;
  data?: DataAttrs;
}

/** One move: lit when it is on offer, dimmed (not gone) otherwise, so the layout never shifts. */
export function MoveButton({ label, ariaLabel, testId, enabled, onClick, primary = false, hotkey, icon, sent = false, data }: MoveProps) {
  return (
    <button
      type="button"
      className={`btn ${primary ? 'btn--primary' : 'btn--secondary'} tbl-move`}
      onClick={onClick}
      disabled={!enabled}
      aria-label={ariaLabel}
      aria-keyshortcuts={hotkey}
      aria-busy={sent || undefined}
      data-testid={testId}
      data-primary={primary}
      data-sent={sent || undefined}
      {...data}
    >
      <span className="tbl-move__label">{label}</span>
      {icon && (
        <span className="tbl-move__icon" aria-hidden="true">
          {icon}
        </span>
      )}
    </button>
  );
}
