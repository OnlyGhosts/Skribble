import type { ReactNode } from 'react';
import { navigate } from '../router';
import { ConnectionPill } from './ConnectionPill';
import { SettingsMenu } from './Preferences';
import { Wordmark } from './Wordmark';

interface Props {
  /** Extra controls before the settings gear (a Leave button, say). */
  children?: ReactNode;
  /** Something beside the wordmark (the Home mascots). */
  aside?: ReactNode;
  /** The front door's header: the wordmark fills the header's width, the aside perches above it. */
  hero?: boolean;
}

/**
 * The wordmark (a link back to the front door), a status pill only while the socket is not
 * connected, and the settings gear. Inside a room the wordmark link leaves it: routeSync leaves
 * whenever the address bar stops naming the room.
 */
export function SiteHeader({ children, aside, hero = false }: Props) {
  return (
    <header className={`site-header${hero ? ' site-header--hero' : ''}`} data-testid="site-header">
      <div className="site-header__brand">
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
        </a>
        {aside}
      </div>
      <div className="site-header__actions">
        <ConnectionPill />
        {children}
        <SettingsMenu />
      </div>
    </header>
  );
}
