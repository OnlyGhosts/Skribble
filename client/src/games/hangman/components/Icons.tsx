import { Icon, type IconProps } from '../../../platform/components/Icons';

/** A knotted rope: the game's mark and the hangman's badge. */
export const RopeIcon = (p: IconProps) => <Icon {...p} paths={['M12 2v5', 'M9.5 9.5a2.5 2.5 0 1 1 5 0c0 2-5 2-5 4a2.5 2.5 0 0 0 5 0', 'M12 16v6']} />;
export const KeyboardIcon = (p: IconProps) => <Icon {...p} paths={['M3 6h18v12H3z', 'M7 10h.01M11 10h.01M15 10h.01M7 14h10']} />;
export const SkullIcon = (p: IconProps) => <Icon {...p} paths={['M12 2a8 8 0 0 0-8 8c0 3 1.5 4.5 3 6v3h10v-3c1.5-1.5 3-3 3-6a8 8 0 0 0-8-8Z', 'M9 11h.01M15 11h.01', 'M10 19v3M14 19v3']} />;
