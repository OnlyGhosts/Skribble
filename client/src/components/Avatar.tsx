import { avatarColor, avatarEmoji, type Avatar as AvatarData } from '@shared/avatar';

type Size = 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  avatar: AvatarData;
  size?: Size;
  className?: string;
  /** Dimmed when the player is disconnected. */
  dimmed?: boolean;
}

export function Avatar({ avatar, size = 'md', className, dimmed }: Props) {
  return (
    <span
      className={['avatar', `avatar--${size}`, dimmed ? 'avatar--dimmed' : '', className ?? ''].join(' ').trim()}
      style={{ background: avatarColor(avatar) }}
      role="img"
      aria-label="Avatar"
    >
      <span className="avatar__emoji">{avatarEmoji(avatar)}</span>
    </span>
  );
}
