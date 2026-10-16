import { Icon, type IconProps } from '../components/Icons';

/** Two overlapping cards: the badge of the player whose turn it is. */
export const CardsIcon = (p: IconProps) => <Icon {...p} paths={['M4 7h9v13H4z', 'm13 4 7 2-3.5 13-7-2']} />;
/** A slashed circle: out of chips. */
export const OutIcon = (p: IconProps) => <Icon {...p} paths={['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm5.6 5.6 12.8 12.8']} />;
export const StopIcon = (p: IconProps) => <Icon {...p} paths="M6 6h12v12H6z" />;
/** A star: a natural blackjack. */
export const StarIcon = (p: IconProps) => <Icon {...p} paths="m12 3 2.7 5.6 6.3.9-4.5 4.3 1 6.2L12 17l-5.5 3 1-6.2L3 9.5l6.3-.9L12 3Z" />;
/** A card with a plus: take another card (Hit). */
export const HitIcon = (p: IconProps) => <Icon {...p} paths={['M6 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M10.5 9v6M7.5 12h6']} />;
/** An open hand: no more cards (Stand); also Poker's Check. */
export const StandIcon = (p: IconProps) => <Icon {...p} paths={['M8 13V5.5a1.5 1.5 0 0 1 3 0V12', 'M11 11V4a1.5 1.5 0 0 1 3 0v7', 'M14 11V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 15.5L3 12.5a1.5 1.5 0 0 1 2.7-1.2L8 14']} />;
/** One card becoming two (Split). */
export const SplitIcon = (p: IconProps) => <Icon {...p} paths={['M12 3v6', 'm12 9-6 6v6', 'm12 9 6 6v6']} />;
/** Two stacked chips: twice the stake (Double). */
export const DoubleIcon = (p: IconProps) => <Icon {...p} paths={['M12 10c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Z', 'M4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7', 'M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5']} />;
/** A card turned away, struck through: give up the hand (Poker's Fold). */
export const FoldIcon = (p: IconProps) => <Icon {...p} paths={['M7 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'm4 20 16-16']} />;
/** An arrow up: put more in (Poker's Bet or Raise). */
export const RaiseIcon = (p: IconProps) => <Icon {...p} paths={['M12 19V5', 'm6 11 6-6 6 6']} />;
/** A tall stack of chips: everything in (Poker's All in). */
export const AllInIcon = (p: IconProps) => <Icon {...p} paths={['M12 7c4.4 0 8-1 8-2.5S16.4 2 12 2 4 3 4 4.5 7.6 7 12 7Z', 'M4 4.5v5C4 11 7.6 12 12 12s8-1 8-2.5v-5', 'M4 9.5v5c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5v-5', 'M4 14.5v5c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5v-5']} />;
