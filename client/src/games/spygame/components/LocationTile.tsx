import type { ReactNode } from 'react';
import type { SpyLocation } from '@shared/games/spygame/locations';
import { CheckIcon, CloseIcon } from '../../../platform/components/Icons';
import { locationImage } from '../images';

export type TileState = 'idle' | 'highlighted' | 'ruledOut' | 'real';

interface Props {
  location: SpyLocation;
  /** sm: a reference row; md: a guess row; lg: the agents' hero tile. */
  size: 'sm' | 'md' | 'lg';
  state?: TileState;
  /** Makes the tile a button. */
  onClick?(): void;
  disabled?: boolean;
  testId?: string;
  /** Printed under the name (the "tap again" hint). */
  hint?: ReactNode;
}

function Picture({ location }: { location: SpyLocation }) {
  const src = locationImage(location.id);
  return (
    <span className="spy-tile__picture" aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <span className="spy-tile__emoji">{location.emoji}</span>}
    </span>
  );
}

/** A location as a picture plus its name; a button when `onClick` is given. */
export function LocationTile({ location, size, state = 'idle', onClick, disabled, testId, hint }: Props) {
  const className = `spy-tile spy-tile--${size} spy-tile--${state}`;
  const body = (
    <>
      <Picture location={location} />
      <span className="spy-tile__body">
        <span className="spy-tile__name">{location.name}</span>
        {hint && <span className="spy-tile__hint">{hint}</span>}
      </span>
      {state === 'ruledOut' && (
        <span className="spy-tile__mark spy-tile__mark--out" aria-label="Ruled out">
          <CloseIcon size={size === 'lg' ? 28 : 16} />
        </span>
      )}
      {state === 'real' && (
        <span className="spy-tile__mark spy-tile__mark--real" aria-label="The location">
          <CheckIcon size={14} />
        </span>
      )}
    </>
  );
  const data = { 'data-testid': testId, 'data-location-id': location.id, 'data-state': state };
  if (!onClick) {
    return (
      <div className={className} {...data}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled} aria-pressed={state === 'highlighted'} aria-label={state === 'ruledOut' ? `${location.name}, ruled out` : location.name} {...data}>
      {body}
    </button>
  );
}
