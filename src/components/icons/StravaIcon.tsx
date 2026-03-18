/**
 * StravaIcon — official Strava two-tone arrow mark.
 * Light orange (#F9B797) for the smaller chevron, dark orange (#F05222) for the larger one.
 * Pass `color` to render mono-color (e.g., white on a button).
 */

import Svg, { Path } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
}

export function StravaIcon({ size = 20, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path
        d="M41.03 47.852l-5.572-10.976h-8.172L41.03 64l13.736-27.124h-8.18"
        fill={color ?? '#F9B797'}
      />
      <Path
        d="M27.898 21.944l7.564 14.928h11.124L27.898 0 9.234 36.876H20.35"
        fill={color ?? '#F05222'}
      />
    </Svg>
  );
}
