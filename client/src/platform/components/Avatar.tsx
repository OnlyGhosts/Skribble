import { useState } from 'react';
import { avatarColor, avatarFace, type AvatarFace, type Avatar as AvatarData } from '@shared/platform/avatar';

type Size = 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  avatar: AvatarData;
  size?: Size;
  className?: string;
  /** Dimmed when the player is disconnected. */
  dimmed?: boolean;
  /** Read out where nothing else names the face; without it the avatar is decoration beside the player's name. */
  label?: string;
}

export function faceSrc(face: AvatarFace): string {
  return `${import.meta.env.BASE_URL}avatars/${face.file}.webp`;
}

interface FaceProps {
  face: AvatarFace;
  /** The alt text; empty when the surroundings already say what it is. */
  alt?: string;
  className?: string;
}

/** The face's picture, sized by the font size around it; the emoji itself if the picture fails to load. */
export function FaceImage({ face, alt = '', className = '' }: FaceProps) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === face.file) {
    return (
      <span className={`face-img face-img--text ${className}`.trim()} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
        {face.emoji}
      </span>
    );
  }
  return (
    <img
      className={`face-img ${className}`.trim()}
      src={faceSrc(face)}
      alt={alt}
      width={52}
      height={52}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(face.file)}
    />
  );
}

export function Avatar({ avatar, size = 'md', className, dimmed, label }: Props) {
  return (
    <span
      className={['avatar', `avatar--${size}`, dimmed ? 'avatar--dimmed' : '', className ?? ''].join(' ').trim()}
      style={{ background: avatarColor(avatar) }}
      aria-hidden={label ? undefined : true}
    >
      <FaceImage face={avatarFace(avatar)} alt={label} />
    </span>
  );
}
