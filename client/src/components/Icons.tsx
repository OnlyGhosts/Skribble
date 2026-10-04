import type { SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'd'> & { size?: number };

function Icon({ size = 18, paths: pathData, ...svgProps }: IconProps & { paths: string | string[] }) {
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...svgProps}
    >
      {paths.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

export const PencilIcon = (p: IconProps) => <Icon {...p} paths="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />;
export const EraserIcon = (p: IconProps) => (
  <Icon {...p} paths={['m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21', 'M22 21H7', 'm5 11 9 9']} />
);
export const BucketIcon = (p: IconProps) => (
  <Icon {...p} paths={['m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z', 'm5 2 5 5', 'M2 13h15', 'M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z']} />
);
export const UndoIcon = (p: IconProps) => <Icon {...p} paths={['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13']} />;
export const TrashIcon = (p: IconProps) => <Icon {...p} paths={['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6M14 11v6']} />;
export const CrownIcon = (p: IconProps) => <Icon {...p} paths="m2 8 5 4 5-8 5 8 5-4-2 12H4L2 8Z" />;
export const CheckIcon = (p: IconProps) => <Icon {...p} paths="m20 6-11 11-5-5" />;
export const CopyIcon = (p: IconProps) => <Icon {...p} paths={['M8 8h12v12H8z', 'M16 8V4H4v12h4']} />;
export const LinkIcon = (p: IconProps) => <Icon {...p} paths={['M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1', 'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1']} />;
export const SunIcon = (p: IconProps) => <Icon {...p} paths={['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4']} />;
export const MoonIcon = (p: IconProps) => <Icon {...p} paths="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />;
export const SoundOnIcon = (p: IconProps) => <Icon {...p} paths={['M11 5 6 9H2v6h4l5 4V5Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13']} />;
export const SoundOffIcon = (p: IconProps) => <Icon {...p} paths={['M11 5 6 9H2v6h4l5 4V5Z', 'm23 9-6 6', 'm17 9 6 6']} />;
export const ThumbUpIcon = (p: IconProps) => <Icon {...p} paths={['M7 10v12', 'M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.4 21H7V10l4.2-7.6A1.5 1.5 0 0 1 14 3a2 2 0 0 1 1 2.9Z']} />;
export const ThumbDownIcon = (p: IconProps) => <Icon {...p} paths={['M17 14V2', 'M9 18.1 10 14H4.2a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 5.6 3H17v11l-4.2 7.6A1.5 1.5 0 0 1 10 21a2 2 0 0 1-1-2.9Z']} />;
export const DiceIcon = (p: IconProps) => <Icon {...p} paths={['M4 4h16v16H4z', 'M8.5 8.5h.01M15.5 8.5h.01M8.5 15.5h.01M15.5 15.5h.01M12 12h.01']} />;
export const CloseIcon = (p: IconProps) => <Icon {...p} paths="M18 6 6 18M6 6l12 12" />;
export const UsersIcon = (p: IconProps) => <Icon {...p} paths={['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M23 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8']} />;
export const ChevronIcon = (p: IconProps) => <Icon {...p} paths="m6 9 6 6 6-6" />;
export const LogoutIcon = (p: IconProps) => <Icon {...p} paths={['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9']} />;
export const PlayIcon = (p: IconProps) => <Icon {...p} paths="m6 4 14 8-14 8V4Z" />;
export const KickIcon = (p: IconProps) => <Icon {...p} paths={['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'm17 8 5 5', 'm22 8-5 5']} />;
export const SparkIcon = (p: IconProps) => <Icon {...p} paths="m12 3 1.9 5.6L19.5 10l-5.6 1.4L12 17l-1.9-5.6L4.5 10l5.6-1.4L12 3Z" />;
export const EditIcon = (p: IconProps) => <Icon {...p} paths={['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z']} />;
export const SendIcon = (p: IconProps) => <Icon {...p} paths={['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13']} />;
export const MoreIcon = (p: IconProps) => <Icon {...p} paths={['M12 12h.01', 'M19 12h.01', 'M5 12h.01']} strokeWidth={3} />;
