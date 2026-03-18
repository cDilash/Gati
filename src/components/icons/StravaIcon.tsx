/**
 * StravaIcon — official Strava arrow/chevron mark.
 * Path from Bootstrap Icons (MIT licensed).
 * Default color: #FC5200 (Strava brand orange).
 */

import Svg, { Path } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
}

export function StravaIcon({ size = 20, color = '#FC5200' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path
        d="M6.731 0 2 9.125h2.788L6.73 5.497l1.93 3.628h2.766zm4.694 9.125-1.372 2.756L8.66 9.125H6.547L10.053 16l3.484-6.875z"
        fill={color}
      />
    </Svg>
  );
}
