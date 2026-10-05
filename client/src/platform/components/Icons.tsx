import type { SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'd'> & { size?: number };

/** The stroke-icon primitive every icon (platform or game) is built from. */
export function Icon({ size = 18, paths: pathData, ...svgProps }: IconProps & { paths: string | string[] }) {
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

export const DiceIcon = (p: IconProps) => <Icon {...p} paths={['M4 4h16v16H4z', 'M8.5 8.5h.01M15.5 8.5h.01M8.5 15.5h.01M15.5 15.5h.01M12 12h.01']} />;
export const CrownIcon = (p: IconProps) => <Icon {...p} paths="m2 8 5 4 5-8 5 8 5-4-2 12H4L2 8Z" />;
export const CheckIcon = (p: IconProps) => <Icon {...p} paths="m20 6-11 11-5-5" />;
export const CopyIcon = (p: IconProps) => <Icon {...p} paths={['M8 8h12v12H8z', 'M16 8V4H4v12h4']} />;
export const LinkIcon = (p: IconProps) => <Icon {...p} paths={['M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1', 'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1']} />;
export const SunIcon = (p: IconProps) => <Icon {...p} paths={['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4']} />;
export const MoonIcon = (p: IconProps) => <Icon {...p} paths="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />;
export const SoundOnIcon = (p: IconProps) => <Icon {...p} paths={['M11 5 6 9H2v6h4l5 4V5Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13']} />;
export const SoundOffIcon = (p: IconProps) => <Icon {...p} paths={['M11 5 6 9H2v6h4l5 4V5Z', 'm23 9-6 6', 'm17 9 6 6']} />;
export const CloseIcon = (p: IconProps) => <Icon {...p} paths="M18 6 6 18M6 6l12 12" />;
export const UsersIcon = (p: IconProps) => <Icon {...p} paths={['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M23 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8']} />;
export const ChevronIcon = (p: IconProps) => <Icon {...p} paths="m6 9 6 6 6-6" />;
export const ArrowRightIcon = (p: IconProps) => <Icon {...p} paths={['M5 12h14', 'm13 6 6 6-6 6']} />;
export const LogoutIcon = (p: IconProps) => <Icon {...p} paths={['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9']} />;
export const PlayIcon = (p: IconProps) => <Icon {...p} paths="m6 4 14 8-14 8V4Z" />;
export const KickIcon = (p: IconProps) => <Icon {...p} paths={['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'm17 8 5 5', 'm22 8-5 5']} />;
export const SparkIcon = (p: IconProps) => <Icon {...p} paths="m12 3 1.9 5.6L19.5 10l-5.6 1.4L12 17l-1.9-5.6L4.5 10l5.6-1.4L12 3Z" />;
export const EditIcon = (p: IconProps) => <Icon {...p} paths={['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z']} />;
export const SendIcon = (p: IconProps) => <Icon {...p} paths={['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13']} />;
export const MoreIcon = (p: IconProps) => <Icon {...p} paths={['M12 12h.01', 'M19 12h.01', 'M5 12h.01']} strokeWidth={3} />;
export const GamepadIcon = (p: IconProps) => (
  <Icon {...p} paths={['M6 11h4M8 9v4', 'M15 12h.01M18 10h.01', 'M7 6h10a5 5 0 0 1 5 5v2a5 5 0 0 1-5 5h-1l-2-2h-4l-2 2H7a5 5 0 0 1-5-5v-2a5 5 0 0 1 5-5Z']} />
);
