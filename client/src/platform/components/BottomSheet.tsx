import { useRef, type ReactNode } from 'react';
import { useModalFocus } from '../lib/useModalFocus';
import { CloseIcon } from './Icons';

interface Props {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  testId: string;
}

/**
 * Phone-style bottom sheet: dimmed backdrop, close button, tap outside or Escape to dismiss.
 * A modal dialog for keyboard and screen-reader users too: it takes the focus when it opens,
 * keeps Tab inside the panel and hands the focus back to the control that opened it.
 */
export function BottomSheet({ open, title, onClose, children, testId }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(panelRef, open, onClose);

  if (!open) return null;
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <button type="button" className="sheet__backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} data-testid={`${testId}-backdrop`} />
      <div className="sheet__panel" ref={panelRef} tabIndex={-1}>
        <div className="sheet__handle" aria-hidden="true" />
        <header className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" data-testid={`${testId}-close`}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}
