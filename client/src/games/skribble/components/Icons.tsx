import { Icon, type IconProps } from '../../../platform/components/Icons';

/** The drawing tools' icons belong to the platform canvas; Skribble reuses them for its brand mark and badges. */
export { BucketIcon, EraserIcon, PencilIcon, TrashIcon, UndoIcon } from '../../../platform/canvas';

export const ThumbUpIcon = (p: IconProps) => <Icon {...p} paths={['M7 10v12', 'M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.4 21H7V10l4.2-7.6A1.5 1.5 0 0 1 14 3a2 2 0 0 1 1 2.9Z']} />;
export const ThumbDownIcon = (p: IconProps) => <Icon {...p} paths={['M17 14V2', 'M9 18.1 10 14H4.2a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 5.6 3H17v11l-4.2 7.6A1.5 1.5 0 0 1 10 21a2 2 0 0 1-1-2.9Z']} />;
