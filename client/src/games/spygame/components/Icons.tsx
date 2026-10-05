import { Icon, type IconProps } from '../../../platform/components/Icons';

/** A magnifying glass: the spy's mark. */
export const SpyIcon = (p: IconProps) => <Icon {...p} paths={['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3']} />;
/** An exclamation mark: the accused. */
export const AlertIcon = (p: IconProps) => <Icon {...p} paths={['M12 7v6', 'M12 17h.01']} strokeWidth={3} />;
/** An eye: a spectator. */
export const EyeIcon = (p: IconProps) => <Icon {...p} paths={['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z']} />;
export const PauseIcon = (p: IconProps) => <Icon {...p} paths={['M9 5v14', 'M15 5v14']} strokeWidth={3} />;
export const ChatIcon = (p: IconProps) => <Icon {...p} paths="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />;
