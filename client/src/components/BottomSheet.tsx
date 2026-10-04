import { useEffect, type ReactNode } from 'react';
import { CloseIcon } from './Icons';

interface Props {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  testId: string;
}

/** Phone-style bottom sheet: dimmed backdrop, close button, tap outside or Escape to dismiss. */
export function BottomSheet({ open, title, onClose, children, testId }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <button type="button" className="sheet__backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} data-testid={`${testId}-backdrop`} />
      <div className="sheet__panel">
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
