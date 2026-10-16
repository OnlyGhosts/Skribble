import { CONTENT_MODES, CONTENT_MODE_INFO, upgradeContentMode, type ContentMode } from '@shared/platform/settings';
import { noOrphan } from '../lib/format';
import { CheckIcon } from './Icons';

interface Props {
  value: ContentMode;
  onChange(mode: ContentMode): void;
}

/**
 * The room's content mode: two cards the host taps (a radio group). The games that read it draw
 * their words, prompts and locations from the chosen mode.
 */
export function ContentModeSetting({ value: stored, onChange }: Props) {
  // A snapshot from an older server could still say 'cheeky'; it plays as Family.
  const value = upgradeContentMode(stored);
  return (
    <div className="setting" data-testid="settings-row-contentMode">
      <span className="setting__label" id="content-mode-label">
        Content
      </span>
      <div className="content-modes" role="radiogroup" aria-labelledby="content-mode-label" data-testid="settings-contentMode" data-value={value}>
        {CONTENT_MODES.map((mode) => {
          const info = CONTENT_MODE_INFO[mode];
          const selected = mode === value;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`content-mode content-mode--${mode}${selected ? ' is-selected' : ''}`}
              onClick={() => onChange(mode)}
              data-testid={`content-mode-${mode}`}
            >
              <span className="content-mode__head">
                <span className="content-mode__label">{info.label}</span>
                {mode === 'unhinged' && <span className="pill content-mode__age">18+</span>}
                {selected && (
                  <span className="content-mode__check" aria-hidden="true">
                    <CheckIcon size={14} />
                  </span>
                )}
              </span>
              <span className="content-mode__blurb">{noOrphan(info.blurb)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
