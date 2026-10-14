import type { ReactNode } from 'react';
import { navigate } from '../router';
import { ConnectionPill } from './ConnectionPill';
import { SoundToggle, ThemeToggle } from './ThemeToggle';
import { Wordmark } from './Wordmark';

interface Props {
  /** A small label after the wordmark: the game's name inside a room. */
  crumb?: string;
  /** Extra controls after the toggles (a Leave button, say). */
  children?: ReactNode;
  /** Hide the connection pill. */
  showConnection?: boolean;
  /** Hide the sound toggle (the front door has nothing to hear). */
  showSound?: boolean;
}

/**
 * The wordmark (a link back to the front door), the connection state and the theme (and sound)
 * toggles. Inside a room the wordmark link leaves it: routeSync leaves whenever the address bar
 * stops naming the room.
 */
export function SiteHeader({ crumb, children, showConnection = true, showSound = true }: Props) {
  return (
    <header className="site-header" data-testid="site-header">
      <a
        className="brand"
        href="/"
        data-testid="brand-link"
        onClick={(e) => {
          e.preventDefault();
          navigate('/');
        }}
      >
        <Wordmark />
        {crumb && <span className="brand__crumb">{crumb}</span>}
      </a>
      <div className="site-header__actions">
        {showConnection && <ConnectionPill />}
        {showSound && <SoundToggle />}
        <ThemeToggle />
        {children}
      </div>
    </header>
  );
}
