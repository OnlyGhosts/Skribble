import { Icon, type IconProps } from '../../../platform/components/Icons';

export const CrosshairIcon = (p: IconProps) => <Icon {...p} paths={['M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M12 2v4M12 18v4M2 12h4M18 12h4']} />;
export const SkullIcon = (p: IconProps) => <Icon {...p} paths={['M12 2a8 8 0 0 0-8 8c0 3 1.5 4.5 3 6v3h10v-3c1.5-1.5 3-3 3-6a8 8 0 0 0-8-8Z', 'M9 11h.01M15 11h.01', 'M10 19v3M14 19v3']} />;
export const AnchorIcon = (p: IconProps) => <Icon {...p} paths={['M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M12 8v14', 'M5 13H2a10 10 0 0 0 20 0h-3', 'M9 13h6']} />;
export const RotateIcon = (p: IconProps) => <Icon {...p} paths={['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3v6h-6']} />;
export const ListIcon = (p: IconProps) => <Icon {...p} paths={['M8 6h13M8 12h13M8 18h13', 'M3 6h.01M3 12h.01M3 18h.01']} />;
export const ArrowIcon = ({ direction, ...p }: IconProps & { direction: 'left' | 'right' | 'up' | 'down' }) => {
  const paths = {
    left: ['M19 12H5', 'm11 6-6 6 6 6'],
    right: ['M5 12h14', 'm13 6 6 6-6 6'],
    up: ['M12 19V5', 'm6 11 6-6 6 6'],
    down: ['M12 5v14', 'm6 13 6 6 6-6'],
  }[direction];
  return <Icon {...p} paths={paths} />;
};
export const MoveIcon = (p: IconProps) => <Icon {...p} paths={['M12 3v18M3 12h18', 'm9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3']} />;
export const UndoIcon = (p: IconProps) => <Icon {...p} paths={['M9 14 4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3']} />;
