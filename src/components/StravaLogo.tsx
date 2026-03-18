/**
 * StravaLogo — the Strava "S" zigzag mark rendered as SVG.
 * Works at any size, uses Strava brand orange (#FC4C02).
 */

import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme/colors';

interface Props {
  size?: number;
  color?: string;
}

export function StravaLogo({ size = 16, color = colors.strava }: Props) {
  // The Strava mark is two chevrons: a large one and a small one overlapping
  // Viewbox: 0 0 24 24, paths approximating the official mark
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066l-2.084 4.116z"
        fill={color}
        opacity={0.6}
      />
      <Path
        d="M10.233 13.828L15.387 24l5.15-10.172h-3.066l-2.084 4.116-2.089-4.116z"
        fill={color}
        opacity={0.6}
      />
      <Path
        d="M7.164 0L1.5 11.25h3.6l2.064-4.083 2.067 4.083h3.6L7.164 0z"
        fill={color}
      />
    </Svg>
  );
}
