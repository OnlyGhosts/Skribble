import { Icon, type IconProps } from '../../../platform/components/Icons';

/** A spade: the game's mark. */
export const SpadeIcon = (p: IconProps) => <Icon {...p} paths={['M12 3c3 4 7 6.5 7 10a4 4 0 0 1-7 2.6A4 4 0 0 1 5 13c0-3.5 4-6 7-10Z', 'M12 15v6M9 21h6']} />;
/** Two overlapping cards: the acting player's badge. */
export const CardsIcon = (p: IconProps) => <Icon {...p} paths={['M4 7h9v13H4z', 'm13 4 7 2-3.5 13-7-2']} />;
/** A slashed circle: out of chips. */
export const OutIcon = (p: IconProps) => <Icon {...p} paths={['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm5.6 5.6 12.8 12.8']} />;
export const ChatIcon = (p: IconProps) => <Icon {...p} paths="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />;
export const StopIcon = (p: IconProps) => <Icon {...p} paths="M6 6h12v12H6z" />;
