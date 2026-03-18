/**
 * AppleHealthLogo — Apple Health heart icon rendered as SVG.
 * The Apple Health app uses a heart shape with a gradient fill.
 */

import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

interface Props {
  size?: number;
}

export function AppleHealthLogo({ size = 16 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id="ahGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF6B6B" />
          <Stop offset="1" stopColor="#FF2D55" />
        </LinearGradient>
      </Defs>
      <Path
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
        fill="url(#ahGrad)"
      />
    </Svg>
  );
}
