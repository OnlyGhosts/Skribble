import { CONTENT_MODES, CONTENT_MODE_INFO, type ContentMode } from '@shared/platform/settings';

interface Props {
  value: ContentMode;
  canEdit: boolean;
  onChange(mode: ContentMode): void;
}

/**
 * The room's content mode: three cards the host taps (a radio group), read-only for everyone
 * else. Every game draws its words, prompts and locations from the chosen mode.
 */
export function ContentModeSetting({ value, canEdit, onChange }: Props) {
  return (
    <div className="setting" data-testid="settings-row-contentMode">
      <div className="setting__head">
        <span className="setting__label" id="content-mode-label">
          Content
        </span>
        <span className="setting__value" data-testid="settings-value-contentMode">
          {CONTENT_MODE_INFO[value].label}
        </span>
      </div>
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
              disabled={!canEdit}
              onClick={() => onChange(mode)}
              data-testid={`content-mode-${mode}`}
            >
              <span className="content-mode__head">
                <span className="content-mode__label">{info.label}</span>
                {mode === 'unhinged' && (
                  <span className="pill content-mode__age" aria-label="Adults only">
                    18+
                  </span>
                )}
              </span>
              <span className="content-mode__blurb">{info.blurb}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
