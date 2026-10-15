import { Icon, type IconProps } from '../components/Icons';

export const PencilIcon = (p: IconProps) => <Icon {...p} paths="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />;
export const EraserIcon = (p: IconProps) => (
  <Icon {...p} paths={['m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21', 'M22 21H7', 'm5 11 9 9']} />
);
export const BucketIcon = (p: IconProps) => (
  <Icon {...p} paths={['m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z', 'm5 2 5 5', 'M2 13h15', 'M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z']} />
);
export const UndoIcon = (p: IconProps) => <Icon {...p} paths={['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11']} />;
export const RedoIcon = (p: IconProps) => <Icon {...p} paths={['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13']} />;
export const TrashIcon = (p: IconProps) => <Icon {...p} paths={['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6M14 11v6']} />;
export const PlusIcon = (p: IconProps) => <Icon {...p} paths="M12 5v14M5 12h14" />;
