import { Icon, type IconProps } from '../../../platform/components/Icons';

/** Two overlapping cards: the game's mark and the acting player's badge. */
export const CardsIcon = (p: IconProps) => <Icon {...p} paths={['M4 7h9v13H4z', 'm13 4 7 2-3.5 13-7-2']} />;
/** A star: a natural blackjack. */
export const StarIcon = (p: IconProps) => <Icon {...p} paths="m12 3 2.7 5.6 6.3.9-4.5 4.3 1 6.2L12 17l-5.5 3 1-6.2L3 9.5l6.3-.9L12 3Z" />;
/** A slashed circle: out of chips. */
export const OutIcon = (p: IconProps) => <Icon {...p} paths={['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm5.6 5.6 12.8 12.8']} />;
export const ChatIcon = (p: IconProps) => <Icon {...p} paths="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />;
