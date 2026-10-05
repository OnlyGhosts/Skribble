import { usePlatformStore } from '../store/usePlatformStore';
import { CloseIcon } from './Icons';

export function Toasts() {
  const toasts = usePlatformStore((s) => s.toasts);
  const dismiss = usePlatformStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role="status" data-testid="toast">
          <span className="toast__text">{t.text}</span>
          <button type="button" className="toast__close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
            <CloseIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
