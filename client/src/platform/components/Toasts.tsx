import type { ToastKind } from '../store/usePlatformStore';
import { usePlatformStore } from '../store/usePlatformStore';
import { AlertIcon, CheckIcon, CloseIcon } from './Icons';

const ICONS: Record<ToastKind, typeof AlertIcon> = {
  info: AlertIcon,
  success: CheckIcon,
  warning: AlertIcon,
  error: AlertIcon,
};

/** Status toasts: informational ones go after a few seconds, errors stay until dismissed. */
export function Toasts() {
  const toasts = usePlatformStore((s) => s.toasts);
  const dismiss = usePlatformStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} className={`toast toast--${t.kind}`} role="status" data-testid="toast">
            <Icon size={20} className="toast__icon" />
            <span className="toast__text">{t.text}</span>
            <button type="button" className="toast__close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <CloseIcon size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
