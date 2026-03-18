/**
 * HealthIcon — Apple Health app icon with white rounded square background
 * and pink→red gradient heart.
 */

import Svg, { Rect, Path, Defs, LinearGradient, Stop } from 'react-native-svg';

interface Props {
  size?: number;
}

export function HealthIcon({ size = 20 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 728 728">
      <Defs>
        <LinearGradient id="ahGrad" x1="0.6" y1="0.1" x2="0.8" y2="0.85">
          <Stop offset="0" stopColor="#FF6AD2" />
          <Stop offset="0.1" stopColor="#FE65C9" />
          <Stop offset="0.27" stopColor="#FB58B0" />
          <Stop offset="0.48" stopColor="#F74387" />
          <Stop offset="0.72" stopColor="#F1254E" />
          <Stop offset="1" stopColor="#E90006" />
        </LinearGradient>
      </Defs>
      {/* White rounded square background */}
      <Rect x="0.5" y="0.5" width="727" height="727" rx="160" fill="#FFFFFF" />
      {/* Gradient heart */}
      <Path
        d="M650.84,183.86c0-50.1-41.49-90.72-92.68-90.72a93.48,93.48,0,0,0-59.49,21.17,93.51,93.51,0,0,0-59.5-21.17c-51.19,0-92.68,40.62-92.68,90.72a89.1,89.1,0,0,0,18.3,54.14h0l.06.06a91.67,91.67,0,0,0,11.4,12.4l122.42,133.15L621,250.54A89.64,89.64,0,0,0,650.84,183.86Z"
        fill="url(#ahGrad)"
      />
    </Svg>
  );
}
