import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_THEME, type Theme } from '../lib/storage';
import { usePlatformStore } from '../store/usePlatformStore';
import { GearIcon } from './Icons';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

/** The per-device preferences: theme (dark by default, remembered) and sound effects. Rows for a menu sheet or the settings popover. */
export function PreferenceRows() {
  const pref = usePlatformStore((s) => s.prefs.theme);
  const setTheme = usePlatformStore((s) => s.setTheme);
  const sound = usePlatformStore((s) => s.prefs.sound);
  const setSound = usePlatformStore((s) => s.setSound);
  const theme = pref ?? DEFAULT_THEME;
  const themeLabel = useId();
  const soundLabel = useId();
  return (
    <>
      <div className="pref-row">
        <span className="pref-row__label" id={themeLabel}>
          Theme
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby={themeLabel}>
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={theme === t.value}
              className={`segmented__option${theme === t.value ? ' is-selected' : ''}`}
              onClick={() => setTheme(t.value)}
              data-testid={`theme-${t.value}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pref-row">
        <span className="pref-row__label" id={soundLabel}>
          Sound effects
        </span>
        <button type="button" role="switch" aria-checked={sound} aria-labelledby={soundLabel} className="switch" onClick={() => setSound(!sound)} data-testid="sound-toggle">
          <span className="switch__track" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

/** A row under the preferences in the gear's popover (the lobby's Copy invite link and Leave room). */
export interface MenuAction {
  label: string;
  icon: ReactNode;
  onSelect(): void;
  testId: string;
  /** 'danger' for a serious action (the host's End game). */
  tone?: 'danger';
}

/**
 * The gear in a header: a small popover with the preferences and the screen's own actions. Escape
 * or a tap outside closes it and gives the focus back to the gear; picking an action closes it.
 */
interface SettingsMenuProps {
  actions?: MenuAction[];
  /**
   * Where the trigger lives. 'icon' (default) is a gear button of its own. 'logo' is a clear
   * button laid over the logo's gear "o" (the logo draws the gear; its box, the positioned
   * parent, says where the gear is in --gear-x and --gear-y).
   */
  variant?: 'icon' | 'logo';
}

export function SettingsMenu({ actions = [], variant = 'icon' }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`settings-menu${variant === 'logo' ? ' settings-menu--logo' : ''}`} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={variant === 'logo' ? 'settings-menu__logo-gear' : 'icon-btn'}
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        data-testid="settings-menu"
      >
        {variant === 'icon' && <GearIcon size={20} />}
      </button>
      {open && (
        <div className="settings-menu__panel" id={panelId} role="dialog" aria-label="Settings" data-testid="settings-popover">
          <PreferenceRows />
          {actions.length > 0 && (
            <div className="settings-menu__actions">
              {actions.map((a) => (
                <button
                  key={a.testId}
                  type="button"
                  className={`settings-menu__action${a.tone === 'danger' ? ' settings-menu__action--danger' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    a.onSelect();
                  }}
                  data-testid={a.testId}
                >
                  {a.icon}
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
