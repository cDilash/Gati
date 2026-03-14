/**
 * RouteThumbnail.tsx — Compact static route map for list views.
 *
 * Shows the route polyline on a muted Apple Maps tile with start/end markers.
 * Uses Douglas-Peucker simplification to reduce point count for performance.
 * No controls, no interaction (unless onPress is provided).
 */

import React, { useMemo, useRef, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MapPin } from 'phosphor-react-native';
import { COLORS } from '../utils/constants';
import { decodePolyline } from '../maps/polyline';
import { simplifyPolyline } from '../maps/simplify';

// ─── Lazy-load react-native-maps ─────────────────────────────

let MapView: React.ComponentType<any> | null = null;
let Polyline: React.ComponentType<any> | null = null;
let Marker: React.ComponentType<any> | null = null;

try {
  const RNMaps = require('react-native-maps');
  MapView = RNMaps.default;
  Polyline = RNMaps.Polyline;
  Marker = RNMaps.Marker;
} catch {
  // Expo Go or native modules unavailable
}

// ─── Component ───────────────────────────────────────────────

interface RouteThumbnailProps {
  polylineEncoded: string;
  height?: number;
  color?: string;
  onPress?: () => void;
}

export function RouteThumbnail({
  polylineEncoded,
  height = 120,
  color = COLORS.accent,
  onPress,
}: RouteThumbnailProps) {
  const mapRef = useRef<any>(null);

  // Decode + simplify once — thumbnail doesn't need full resolution
  const { coords, startPoint, endPoint, region } = useMemo(() => {
    const full = decodePolyline(polylineEncoded);
    if (full.length < 2) return { coords: [], startPoint: null, endPoint: null, region: undefined };

    // ε = 0.00015° ≈ 16m — tighter than default keeps shape on small canvas
    const simplified = simplifyPolyline(full, 0.00015);

    let north = -90, south = 90, east = -180, west = 180;
    for (const c of full) {
      if (c.latitude > north) north = c.latitude;
      if (c.latitude < south) south = c.latitude;
      if (c.longitude > east) east = c.longitude;
      if (c.longitude < west) west = c.longitude;
    }

    const latPad = (north - south) * 0.4;
    const lngPad = (east - west) * 0.4;

    return {
      coords: simplified,
      startPoint: full[0],
      endPoint: full[full.length - 1],
      region: {
        latitude: (north + south) / 2,
        longitude: (east + west) / 2,
        latitudeDelta: (north - south) + latPad,
        longitudeDelta: (east - west) + lngPad,
      },
    };
  }, [polylineEncoded]);

  const onMapReady = useCallback(() => {
    if (!mapRef.current || coords.length === 0) return;
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 12, right: 12, bottom: 12, left: 12 },
      animated: false,
    });
  }, [coords]);

  // ─── Fallback: no native maps ──────────────────────────────
  if (!MapView || !Polyline || !Marker) {
    return (
      <Pressable
        style={[styles.fallback, { height }]}
        onPress={onPress}
        disabled={!onPress}
      >
        <MapPin size={20} color={COLORS.textTertiary} />
        <Text style={styles.fallbackText}>Route</Text>
      </Pressable>
    );
  }

  if (coords.length < 2 || !startPoint || !endPoint) return null;

  const content = (
    <View style={[styles.container, { height }]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType="mutedStandard"
        initialRegion={region}
        onMapReady={onMapReady}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
        showsPointsOfInterest={false}
        showsBuildings={false}
        showsTraffic={false}
        showsScale={false}
        showsCompass={false}
      >
        <Polyline
          coordinates={coords}
          strokeColor={color}
          strokeWidth={3}
          lineCap="round"
          lineJoin="round"
        />
        <Marker coordinate={startPoint} anchor={{ x: 0.5, y: 0.5 }} flat>
          <View style={styles.dotStart} />
        </Marker>
        <Marker coordinate={endPoint} anchor={{ x: 0.5, y: 0.5 }} flat>
          <View style={styles.dotEnd} />
        </Marker>
      </MapView>

      {onPress && (
        <View style={styles.tapHint}>
          <Text style={styles.tapHintText}>View route →</Text>
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={styles.pressable}>
        {content}
      </Pressable>
    );
  }

  return content;
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  pressable: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  map: {
    flex: 1,
  },
  dotStart: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#34C759',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  dotEnd: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  tapHint: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingVertical: 5,
    alignItems: 'center',
  },
  tapHintText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  fallback: {
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  fallbackText: {
    color: COLORS.textTertiary,
    fontSize: 11,
  },
});
