import { Icon, type IconProps } from '../../../platform/components/Icons';

/** A pen: still writing. */
export const PenIcon = (p: IconProps) => <Icon {...p} paths={['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z']} />;
/** An eye: a spectator. */
export const EyeIcon = (p: IconProps) => <Icon {...p} paths={['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z']} />;
/** A megaphone: the announcer. */
export const MegaphoneIcon = (p: IconProps) => <Icon {...p} paths={['m3 11 18-7v16L3 13v-2Z', 'M7 13v5a2 2 0 0 0 4 0v-3']} />;
