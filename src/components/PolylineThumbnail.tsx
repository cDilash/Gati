/**
 * PolylineThumbnail — lightweight SVG rendering of a route polyline.
 * Used in list cards where a full MapView would be too heavy.
 */

import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { COLORS } from '../utils/constants';

interface Props {
  polyline: string;
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
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

    points.push([lng / 1e5, lat / 1e5]); // x=lng, y=lat
  }
  return points;
}

export function PolylineThumbnail({
  polyline,
  width = 80,
  height = 60,
  strokeColor = COLORS.accent,
  strokeWidth = 2,
}: Props) {
  const svgPoints = useMemo(() => {
    const raw = decodePolyline(polyline);
    if (raw.length < 2) return '';

    const xs = raw.map(p => p[0]);
    const ys = raw.map(p => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeX = maxX - minX || 0.001;
    const rangeY = maxY - minY || 0.001;

    const padding = 4;
    const w = width - padding * 2;
    const h = height - padding * 2;

    // Maintain aspect ratio
    const scaleX = w / rangeX;
    const scaleY = h / rangeY;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = padding + (w - rangeX * scale) / 2;
    const offsetY = padding + (h - rangeY * scale) / 2;

    return raw
      .map(p => {
        const x = (p[0] - minX) * scale + offsetX;
        const y = height - ((p[1] - minY) * scale + offsetY); // flip Y
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [polyline, width, height]);

  if (!svgPoints) return null;

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg width={width} height={height}>
        <Polyline
          points={svgPoints}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
    overflow: 'hidden',
  },
});
