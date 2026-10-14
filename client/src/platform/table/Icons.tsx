import { Icon, type IconProps } from '../components/Icons';

/** Two overlapping cards: the badge of the player whose turn it is. */
export const CardsIcon = (p: IconProps) => <Icon {...p} paths={['M4 7h9v13H4z', 'm13 4 7 2-3.5 13-7-2']} />;
/** A slashed circle: out of chips. */
export const OutIcon = (p: IconProps) => <Icon {...p} paths={['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm5.6 5.6 12.8 12.8']} />;
/** A round speech bubble: the chat button in a table's top bar. */
export const BubbleIcon = (p: IconProps) => <Icon {...p} paths="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />;
export const StopIcon = (p: IconProps) => <Icon {...p} paths="M6 6h12v12H6z" />;
