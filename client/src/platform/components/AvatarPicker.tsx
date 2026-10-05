import { AVATAR_COLORS, AVATAR_EMOJIS, randomAvatar, type Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from './Avatar';
import { DiceIcon } from './Icons';

interface Props {
  value: AvatarData;
  onChange(next: AvatarData): void;
  compact?: boolean;
}

export function AvatarPicker({ value, onChange, compact }: Props) {
  return (
    <div className={`avatar-picker${compact ? ' avatar-picker--compact' : ''}`} data-testid="avatar-picker">
      <div className="avatar-picker__preview">
        <Avatar avatar={value} size="xl" />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onChange(randomAvatar())}
          data-testid="avatar-random"
        >
          <DiceIcon /> Randomize
        </button>
      </div>
      <div className="avatar-picker__group" role="radiogroup" aria-label="Avatar colour">
        {AVATAR_COLORS.map((hex, i) => (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={value.color === i}
            aria-label={`Colour ${i + 1}`}
            className={`swatch swatch--round${value.color === i ? ' is-selected' : ''}`}
            style={{ background: hex }}
            onClick={() => onChange({ ...value, color: i })}
          />
        ))}
      </div>
      <div className="avatar-picker__group avatar-picker__emojis" role="radiogroup" aria-label="Avatar face">
        {AVATAR_EMOJIS.map((emoji, i) => (
          <button
            key={emoji}
            type="button"
            role="radio"
            aria-checked={value.emoji === i}
            aria-label={`Face ${i + 1}`}
            className={`emoji-choice${value.emoji === i ? ' is-selected' : ''}`}
            onClick={() => onChange({ ...value, emoji: i })}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
