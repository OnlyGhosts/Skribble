import type { SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'd'> & { size?: number };

/** The stroke-icon primitive every icon (platform or game) is built from: Pocket Party line icons, 24px grid, 1.8px round stroke. */
export function Icon({ size = 18, paths: pathData, ...svgProps }: IconProps & { paths: string | string[] }) {
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
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
export const CheckIcon = (p: IconProps) => <Icon {...p} paths="M4 12l5 5L20 6" />;
export const CopyIcon = (p: IconProps) => <Icon {...p} paths={['M10 8h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z', 'M16 4H6a2 2 0 0 0-2 2v10']} />;
/** Three linked nodes: the share glyph on the brand board. */
export const ShareIcon = (p: IconProps) => (
  <Icon {...p} paths={['M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'm8.6 13.5 6.8 4', 'm15.4 6.5-6.8 4']} />
);
export const MoonIcon = (p: IconProps) => <Icon {...p} paths="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />;
export const BackIcon = (p: IconProps) => <Icon {...p} paths={['M20 12H4', 'm10 6-6 6 6 6']} />;
export const ChatIcon = (p: IconProps) => <Icon {...p} paths="M3 4h18v13H9l-6 4z" />;
export const GearIcon = (p: IconProps) => (
  <Icon
    {...p}
    paths={[
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
      'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
    ]}
  />
);
export const LinkIcon = (p: IconProps) => <Icon {...p} paths={['M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1', 'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1']} />;
export const AlertIcon = (p: IconProps) => <Icon {...p} paths={['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 8v5', 'M12 16h.01']} />;
export const CloseIcon = (p: IconProps) => <Icon {...p} paths="M5 5l14 14M19 5 5 19" />;
export const UsersIcon = (p: IconProps) => <Icon {...p} paths={['M8 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8', 'M2 21v-3q0-4 6-4t6 4v3', 'M16 5q6 0 4 6', 'M17 14q5 0 5 7']} />;
export const ChevronIcon = (p: IconProps) => <Icon {...p} paths="m6 9 6 6 6-6" />;
export const LogoutIcon = (p: IconProps) => <Icon {...p} paths={['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9']} />;
export const PlayIcon = (p: IconProps) => <Icon {...p} paths="m6 4 14 8-14 8V4Z" />;
export const PauseIcon = (p: IconProps) => <Icon {...p} paths={['M9 5v14', 'M15 5v14']} strokeWidth={3} />;
export const KickIcon = (p: IconProps) => <Icon {...p} paths={['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'm17 8 5 5', 'm22 8-5 5']} />;
export const SparkIcon = (p: IconProps) => <Icon {...p} paths="m12 3 1.9 5.6L19.5 10l-5.6 1.4L12 17l-1.9-5.6L4.5 10l5.6-1.4L12 3Z" />;
export const EditIcon = (p: IconProps) => <Icon {...p} paths={['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z']} />;
export const SendIcon = (p: IconProps) => <Icon {...p} paths={['M3 3l18 9-18 9 4-9z', 'M7 12h14']} />;
export const UploadIcon = (p: IconProps) => <Icon {...p} paths={['M12 15V4', 'm7 9 5-5 5 5', 'M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4']} />;
export const EyeIcon = (p: IconProps) => <Icon {...p} paths={['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z']} />;
export const PartyIcon = (p: IconProps) => <Icon {...p} paths={['m5.8 11.3 7 7L2 22l3.8-10.7Z', 'M4 3h.01M22 8h.01M15 2h.01M22 20h.01', 'M22 2 12.3 11.7', 'M11 13 22 2']} />;
export const RefreshIcon = (p: IconProps) => <Icon {...p} paths={['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3v6h-6']} />;
export const MenuIcon = (p: IconProps) => <Icon {...p} paths="M4 6h16M4 12h16M4 18h16" />;
export const MoreIcon = (p: IconProps) => <Icon {...p} paths={['M12 12h.01', 'M19 12h.01', 'M5 12h.01']} strokeWidth={3} />;
