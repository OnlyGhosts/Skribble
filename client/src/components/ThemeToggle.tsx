import { useEffect, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { Theme } from '../lib/storage';
import { MoonIcon, SoundOffIcon, SoundOnIcon, SunIcon } from './Icons';

function useSystemTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return theme;
}

export function ThemeToggle() {
  const pref = useGameStore((s) => s.prefs.theme);
  const setTheme = useGameStore((s) => s.setTheme);
  const system = useSystemTheme();
  const resolved: Theme = pref ?? system;
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
  const sound = useGameStore((s) => s.prefs.sound);
  const setSound = useGameStore((s) => s.setSound);
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
