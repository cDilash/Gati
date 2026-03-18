/**
 * PolylineThumbnail — lightweight SVG rendering of a route polyline.
 * Gradient stroke (cyan→orange) with glow effect and start/end dots.
 * Used in list cards where a full MapView would be too heavy.
 */

import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { colors } from '../theme/colors';

interface Props {
  polyline: string;
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
  /** Unique ID for SVG gradient — prevents conflicts in FlatList */
  gradientId?: string;
}

function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}

let _idCounter = 0;

export function PolylineThumbnail({
  polyline,
  width = 80,
  height = 60,
  strokeColor,
  strokeWidth = 2.5,
  gradientId,
}: Props) {
  // Unique gradient ID per instance
  const gId = useMemo(() => gradientId ?? `rg-${++_idCounter}`, [gradientId]);
  const glowId = `${gId}-glow`;

  const { svgPoints, startPt, endPt } = useMemo(() => {
    const raw = decodePolyline(polyline);
    if (raw.length < 2) return { svgPoints: '', startPt: null, endPt: null };

    const xs = raw.map(p => p[0]);
    const ys = raw.map(p => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeX = maxX - minX || 0.001;
    const rangeY = maxY - minY || 0.001;

    const padding = 6;
    const w = width - padding * 2;
    const h = height - padding * 2;

    const scaleX = w / rangeX;
    const scaleY = h / rangeY;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = padding + (w - rangeX * scale) / 2;
    const offsetY = padding + (h - rangeY * scale) / 2;

    const mapped = raw.map(p => {
      const x = (p[0] - minX) * scale + offsetX;
      const y = height - ((p[1] - minY) * scale + offsetY);
      return { x, y };
    });

    const pts = mapped.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return {
      svgPoints: pts,
      startPt: mapped[0],
      endPt: mapped[mapped.length - 1],
    };
  }, [polyline, width, height]);

  if (!svgPoints) return null;

  const useGradient = !strokeColor;

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg width={width} height={height}>
        {useGradient && (
          <Defs>
            <LinearGradient id={gId} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={colors.cyan} />
              <Stop offset="100%" stopColor={colors.orange} />
            </LinearGradient>
            <LinearGradient id={glowId} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={colors.cyan} stopOpacity="0.2" />
              <Stop offset="100%" stopColor={colors.orange} stopOpacity="0.2" />
            </LinearGradient>
          </Defs>
        )}

        {/* Glow layer */}
        {useGradient && (
          <Polyline
            points={svgPoints}
            fill="none"
            stroke={`url(#${glowId})`}
            strokeWidth={strokeWidth + 4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Main route line */}
        <Polyline
          points={svgPoints}
          fill="none"
          stroke={useGradient ? `url(#${gId})` : strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Start dot (cyan) */}
        {startPt && (
          <Circle cx={startPt.x} cy={startPt.y} r={3} fill={colors.cyan} />
        )}

        {/* End dot (orange) */}
        {endPt && (
          <Circle cx={endPt.x} cy={endPt.y} r={3} fill={colors.orange} />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    overflow: 'hidden',
  },
});
