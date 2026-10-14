import type { FormEvent, ReactNode } from 'react';
import { Chips } from '../components/Chips';

/** How the panel's status line reads: lime when it is on me, lilac while someone else (or the dealer) plays, red when I am out. */
export type StatusTone = 'go' | 'other' | 'bad' | 'quiet';

export interface PanelStatus {
  /** The game's own state name, for data-state. */
  state: string;
  text: string;
  tone: StatusTone;
}

type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

interface ShellProps {
  label: string;
  status: PanelStatus;
  onSubmit(): void;
  testId: string;
  data?: DataAttrs;
  /** Desktop: the shortcuts line under the controls. */
  hint?: string | false;
  children: ReactNode;
}

/**
 * The control panel shell, the same place all game long: the status line (whose turn it is), then
 * the game's rows, then the shortcut hint on a desktop. A form, so Enter in the amount sends.
 */
export function PanelShell({ label, status, onSubmit, testId, data, hint, children }: ShellProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form className="tbl-panel" onSubmit={submit} noValidate aria-label={label} data-testid={testId} {...data}>
      <p className={`tbl-panel__status tbl-panel__status--${status.tone}`} data-testid="turn-status" data-state={status.state} role="status" aria-live="polite">
        {status.text}
      </p>
      {children}
      {hint && (
        <p className="tbl-panel__hint" data-testid="hotkey-hint">
          {hint}
        </p>
      )}
    </form>
  );
}

/** Row 1: what the amount is for, and my stack (`truth` is the real count behind a balance still catching up). */
export function PanelLabelRow({ label, htmlFor, balance, truth }: { label: string; htmlFor: string; balance: number; truth: number }) {
  return (
    <div className="tbl-panel__label-row">
      <label className="tbl-panel__label" htmlFor={htmlFor}>
        {label}
      </label>
      <span className="tbl-panel__balance" data-testid="my-chips" data-chips={truth} aria-label={`Balance ${balance} chips`}>
        <Chips value={balance} size={14} />
      </span>
    </div>
  );
}

/** The moves, two to a row; every one always there. */
export function PanelMoves({ label = 'Your moves', children }: { label?: string; children: ReactNode }) {
  return (
    <div className="tbl-panel__moves" role="group" aria-label={label}>
      {children}
    </div>
  );
}

interface MoveProps {
  label: string;
  testId: string;
  enabled: boolean;
  onClick(): void;
  primary?: boolean;
  /** Desktop: the key that does the same (aria-keyshortcuts). */
  hotkey?: string;
  data?: DataAttrs;
}

/** One move: lit when it is on offer, dimmed (not gone) otherwise, so the layout never shifts. */
export function MoveButton({ label, testId, enabled, onClick, primary = false, hotkey, data }: MoveProps) {
  return (
    <button type="button" className={`btn ${primary ? 'btn--primary' : 'btn--secondary'} tbl-move`} onClick={onClick} disabled={!enabled} aria-keyshortcuts={hotkey} data-testid={testId} {...data}>
      {label}
    </button>
  );
}
