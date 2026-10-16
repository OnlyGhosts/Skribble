import type { CSSProperties, FormEvent, ReactNode } from 'react';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from '../components/Avatar';
import { EyeIcon } from '../components/Icons';
import { WATCHING_TEXT } from '../lib/watching';
import { StackCount } from './Stakes';

/** How the panel's status line reads: lime when it is on me, lilac while someone else (or the dealer) plays, red when I am out. */
export type StatusTone = 'go' | 'other' | 'bad' | 'quiet';

export interface PanelStatus {
  /** The game's own state name, for data-state. */
  state: string;
  text: string;
  tone: StatusTone;
  /** The avatar of the player whose turn it is, in place of the dot. */
  who?: AvatarData;
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
  /** A small control at the end of the status line (Blackjack's Sit out, Deal now, Skip). */
  action?: ReactNode;
  /** The status line keeps the action's height whether or not one is on offer, so the panel never jumps. */
  actionSlot?: boolean;
  /** `bottom`: a quiet line under the controls (the table says whose turn it is); `top`: the panel's first line. */
  statusAt?: 'top' | 'bottom';
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
 * The control panel shell, the same place all game long: the status line (whose turn it is) and
 * the game's rows, then the shortcut hint on a desktop. A form, so Enter in the amount sends.
 */
export function PanelShell({ label, status, onSubmit, testId, data, hint, action, actionSlot = false, statusAt = 'top', children }: ShellProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  const line = (
    <div className={`tbl-panel__status tbl-panel__status--${status.tone}${status.who ? ' tbl-panel__status--who' : ''}${actionSlot ? ' tbl-panel__status--slot' : ''} tbl-panel__status--${statusAt}`}>
      {status.who && (
        <span className="tbl-panel__who" aria-hidden="true">
          <Avatar avatar={status.who} size="sm" />
        </span>
      )}
      <p className="tbl-panel__status-text" data-testid="turn-status" data-state={status.state} role="status" aria-live="polite">
        {status.text}
      </p>
      {action}
    </div>
  );
  return (
    <form className={`tbl-panel tbl-panel--status-${statusAt}`} onSubmit={submit} onClick={releaseClickedButton} noValidate aria-label={label} data-testid={testId} {...data}>
      {statusAt === 'top' && line}
      {children}
      {statusAt === 'bottom' && line}
      {hint && (
        <p className="tbl-panel__hint" data-testid="hotkey-hint">
          {hint}
        </p>
      )}
    </form>
  );
}

/**
 * A spectator's panel in place of the controls: one quiet line saying they watch and can play the
 * next game. A host who watches keeps their table controls in `action` (Deal now, Skip).
 */
export function WatchingPanel({ testId, action }: { testId: string; action?: ReactNode }) {
  return (
    <section className="tbl-panel tbl-panel--watching" aria-label="Watching" data-testid={testId} data-watching="true">
      <div className="tbl-panel__status tbl-panel__status--quiet tbl-panel__status--watching">
        <span className="tbl-panel__watch-icon" aria-hidden="true">
          <EyeIcon size={18} />
        </span>
        <p className="tbl-panel__status-text" data-testid="turn-status" data-state="spectating" role="status">
          {WATCHING_TEXT}
        </p>
      </div>
      {action && <div className="tbl-panel__watch-actions">{action}</div>}
    </section>
  );
}

/** The small control at the end of the status line: a pill whose tap target is a full 44px tall. */
export function StatusAction({ label, ariaLabel, testId, onClick, enabled = true }: { label: string; ariaLabel?: string; testId: string; onClick(): void; enabled?: boolean }) {
  return (
    <button type="button" className="tbl-panel__act" onClick={onClick} disabled={!enabled} aria-label={ariaLabel} data-testid={testId}>
      {label}
    </button>
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
