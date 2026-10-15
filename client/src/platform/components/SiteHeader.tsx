import type { CSSProperties } from 'react';
import { WORDMARK_GEAR_POSITION } from '../brand/wordmark';
import { navigate } from '../router';
import { ConnectionPill } from './ConnectionPill';
import { SettingsMenu, type MenuAction } from './Preferences';
import { Wordmark } from './Wordmark';

interface Props {
  /** Rows under the preferences in the gear's popover (the lobby's Leave room). */
  menuActions?: MenuAction[];
  /** The front door's header: the logo fills the header's width. */
  hero?: boolean;
}

/** Where the gear "o" sits in the logo's box, for the settings button and its popover. */
const GEAR_VARS = { '--gear-x': WORDMARK_GEAR_POSITION.left, '--gear-y': WORDMARK_GEAR_POSITION.top } as CSSProperties;

/**
 * The logo (a link back to the front door) whose gear "o" in ".io" is the settings button, and a
 * status pill only while the socket is not connected. Inside a room the logo link leaves it:
 * routeSync leaves whenever the address bar stops naming the room.
 */
export function SiteHeader({ menuActions, hero = false }: Props) {
  return (
    <header className={`site-header${hero ? ' site-header--hero' : ''}`} data-testid="site-header">
      <div className="site-header__brand">
        <div className="logo" style={GEAR_VARS}>
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
          <SettingsMenu actions={menuActions} variant="logo" />
        </div>
      </div>
      <div className="site-header__actions">
        <ConnectionPill />
      </div>
    </header>
  );
}
