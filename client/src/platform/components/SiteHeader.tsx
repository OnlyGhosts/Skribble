import type { ReactNode } from 'react';
import { SITE_NAME } from '@shared/platform/site';
import { navigate } from '../router';
import { ConnectionPill } from './ConnectionPill';
import { GamepadIcon } from './Icons';
import { SoundToggle, ThemeToggle } from './ThemeToggle';

interface Props {
  /** A pill after the brand: the game's name, "Lobby", ... */
  crumb?: string;
  /** Extra controls after the toggles (a Leave button, say). */
  children?: ReactNode;
  /** Hide the connection pill (the library has no room to be connected to). */
  showConnection?: boolean;
}

/**
 * The brand (a link back to the library), the connection state and the theme/sound toggles.
 * Inside a room the brand link leaves it: routeSync leaves whenever the address bar stops naming the room.
 */
export function SiteHeader({ crumb, children, showConnection = true }: Props) {
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
        <span className="brand__mark" aria-hidden="true">
          <GamepadIcon size={20} />
        </span>
        <span className="brand__name">{SITE_NAME}</span>
        {crumb && <span className="brand__crumb">{crumb}</span>}
      </a>
      <div className="site-header__actions">
        {showConnection && <ConnectionPill />}
        <SoundToggle />
        <ThemeToggle />
        {children}
      </div>
    </header>
  );
}
