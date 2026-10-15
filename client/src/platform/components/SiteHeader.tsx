import { navigate } from '../router';
import { ConnectionPill } from './ConnectionPill';
import { SettingsMenu, type MenuAction } from './Preferences';
import { Wordmark } from './Wordmark';

interface Props {
  /** Rows under the preferences in the gear's popover (the lobby's Leave room). */
  menuActions?: MenuAction[];
  /** The front door's header: the logo fills the header's width, under the gear. */
  hero?: boolean;
}

/**
 * The logo (a link back to the front door), a status pill only while the socket is not
 * connected, and the settings gear. Inside a room the logo link leaves it: routeSync leaves
 * whenever the address bar stops naming the room.
 */
export function SiteHeader({ menuActions, hero = false }: Props) {
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
      </div>
      <div className="site-header__actions">
        <ConnectionPill />
        <SettingsMenu actions={menuActions} />
      </div>
    </header>
  );
}
