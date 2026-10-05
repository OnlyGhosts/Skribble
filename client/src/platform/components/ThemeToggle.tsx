import { usePlatformStore } from '../store/usePlatformStore';
import { DARK_SCHEME_QUERY, useMediaQuery } from '../lib/media';
import type { Theme } from '../lib/storage';
import { MoonIcon, SoundOffIcon, SoundOnIcon, SunIcon } from './Icons';

export function ThemeToggle() {
  const pref = usePlatformStore((s) => s.prefs.theme);
  const setTheme = usePlatformStore((s) => s.setTheme);
  const systemDark = useMediaQuery(DARK_SCHEME_QUERY);
  const resolved: Theme = pref ?? (systemDark ? 'dark' : 'light');
  const next: Theme = resolved === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      data-testid="theme-toggle"
    >
      {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

export function SoundToggle() {
  const sound = usePlatformStore((s) => s.prefs.sound);
  const setSound = usePlatformStore((s) => s.setSound);
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setSound(!sound)}
      aria-label={sound ? 'Mute sound effects' : 'Unmute sound effects'}
      aria-pressed={sound}
      title={sound ? 'Sound on' : 'Sound off'}
      data-testid="sound-toggle"
    >
      {sound ? <SoundOnIcon /> : <SoundOffIcon />}
    </button>
  );
}
