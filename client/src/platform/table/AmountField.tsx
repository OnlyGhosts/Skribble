import { useRef } from 'react';
import { ChipIcon } from '../components/Chips';
import { CloseIcon } from '../components/Icons';

export interface AmountStep {
  label: string;
  ariaLabel: string;
  testId: string;
  onClick(): void;
  /** Shown as chosen (the field holds this step's amount). */
  pressed?: boolean;
}

interface Props {
  id: string;
  /** What the field shows. */
  value: string;
  /** Off: dimmed and not editable (not my move, no chips). */
  enabled: boolean;
  onChange(text: string): void;
  onFocus?(): void;
  onBlur?(): void;
  /** Empties the field and keeps the focus in it. */
  onClear(): void;
  /** The quick amounts joined to the field: 1/2, 2x, MAX; 1/2 pot, Pot, MAX. */
  steps: AmountStep[];
  describedBy?: string;
  inputTestId: string;
  clearTestId: string;
}

/**
 * The amount: one field with the coin, the numeric keyboard and a clear button, with the quick
 * amounts joined to its right as one segmented group. Enter submits the panel's form.
 */
export function AmountField({ id, value, enabled, onChange, onFocus, onBlur, onClear, steps, describedBy, inputTestId, clearTestId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="tbl-amount">
      <div className={`tbl-amount__field${enabled ? '' : ' is-off'}`}>
        <ChipIcon size={18} className="chip-count__coin tbl-amount__coin" />
        <input
          ref={inputRef}
          id={id}
          className="tbl-amount__input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="go"
          value={value}
          disabled={!enabled}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={onFocus}
          onBlur={onBlur}
          aria-describedby={describedBy}
          data-testid={inputTestId}
        />
        {value !== '' && enabled && (
          <button
            type="button"
            className="tbl-amount__clear"
            aria-label="Clear the amount"
            onClick={() => {
              onClear();
              inputRef.current?.focus();
            }}
            data-testid={clearTestId}
          >
            <CloseIcon size={14} />
          </button>
        )}
      </div>
      <div className="tbl-amount__steps" role="group" aria-label="Change the amount">
        {steps.map((s) => (
          <button key={s.testId} type="button" className="tbl-amount__step" disabled={!enabled} onClick={s.onClick} aria-label={s.ariaLabel} aria-pressed={s.pressed} data-testid={s.testId}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
