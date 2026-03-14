/**
 * RouteMap.tsx — Interactive route map with pace/HR/elevation zone coloring.
 *
 * Lazy-loads react-native-maps (requires native build — not available in Expo Go).
 * Builds RouteData from Strava streams, then renders color-coded polyline segments.
 *
 * iOS-only: uses Apple Maps with mutedStandard style for a clean basemap.
 * All gestures disabled — this is a static route viewer, not a full map.
 */

import React, { useState, useRef, useMemo, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS } from '../utils/constants';
import type { PaceZones, HRZones } from '../types';
import { buildRouteData } from '../maps/routeData';
import {
  ColorMode,
  generateColorSegments,
  PACE_ZONE_COLORS,
  HR_ZONE_COLORS,
  ELEVATION_COLORS,
} from '../maps/colorEngine';

// ─── Lazy-load react-native-maps ─────────────────────────────
// react-native-maps requires native modules unavailable in Expo Go.
// Wrap in try/catch so the screen still loads without crashing.

let MapView: React.ComponentType<any> | null = null;
let Polyline: React.ComponentType<any> | null = null;
let Marker: React.ComponentType<any> | null = null;

try {
  const RNMaps = require('react-native-maps');
  MapView = RNMaps.default;
  Polyline = RNMaps.Polyline;
  Marker = RNMaps.Marker;
} catch {
  // Running in Expo Go or native modules not available
}

// ─── Mode Toggle Config ──────────────────────────────────────

const MODES: { key: ColorMode; label: string }[] = [
  { key: 'pace',      label: 'Pace' },
  { key: 'heartrate', label: 'HR'   },
  { key: 'elevation', label: 'Elev' },
  { key: 'none',      label: 'Plain'},
];

// ─── Legend Config ───────────────────────────────────────────

const LEGEND: Record<ColorMode, Array<{ label: string; color: string }>> = {
  pace: [
    { label: 'E',    color: PACE_ZONE_COLORS.easy },
    { label: 'M',    color: PACE_ZONE_COLORS.marathon },
    { label: 'T',    color: PACE_ZONE_COLORS.threshold },
    { label: 'I',    color: PACE_ZONE_COLORS.interval },
    { label: 'R',    color: PACE_ZONE_COLORS.repetition },
  ],
  heartrate: [
    { label: 'Z1', color: HR_ZONE_COLORS.zone1 },
    { label: 'Z2', color: HR_ZONE_COLORS.zone2 },
    { label: 'Z3', color: HR_ZONE_COLORS.zone3 },
    { label: 'Z4', color: HR_ZONE_COLORS.zone4 },
    { label: 'Z5', color: HR_ZONE_COLORS.zone5 },
  ],
  elevation: [
    { label: '▼',      color: ELEVATION_COLORS.downhill },
    { label: 'Flat',   color: ELEVATION_COLORS.flat },
    { label: 'Gentle', color: ELEVATION_COLORS.gentle },
    { label: 'Steep',  color: ELEVATION_COLORS.steep },
  ],
  none: [],
};

// ─── Component ───────────────────────────────────────────────

interface RouteMapProps {
  polylineEncoded: string | null;
  paceStream: number[] | null;
  hrStream: number[] | null;
  elevationStream: number[] | null;
  distanceStream: number[] | null;
  paceZones: PaceZones;
  hrZones: HRZones;
}

const MAP_HEIGHT = 240;

export function RouteMap({
  polylineEncoded,
  paceStream,
  hrStream,
  elevationStream,
  distanceStream,
  paceZones,
  hrZones,
}: RouteMapProps) {
  const [colorMode, setColorMode] = useState<ColorMode>('pace');
  const mapRef = useRef<any>(null);

  // Build structured route data from raw streams
  const routeData = useMemo(() => {
    if (!polylineEncoded) return null;
    return buildRouteData(
      polylineEncoded,
      paceStream,
      hrStream,
      elevationStream,
      distanceStream,
      paceZones,
      hrZones,
    );
  }, [polylineEncoded, paceStream, hrStream, elevationStream, distanceStream]);

  // Recompute color segments when mode changes
  const segments = useMemo(() => {
    if (!routeData) return [];
    return generateColorSegments(routeData.points, colorMode, paceZones, hrZones);
  }, [routeData, colorMode]);

  // Compute initial region from route bounds
  const initialRegion = useMemo(() => {
    if (!routeData) return undefined;
    const { north, south, east, west } = routeData.bounds;
    const latPad = (north - south) * 0.35;
    const lngPad = (east - west) * 0.35;
    return {
      latitude: (north + south) / 2,
      longitude: (east + west) / 2,
      latitudeDelta: (north - south) + latPad,
      longitudeDelta: (east - west) + lngPad,
    };
  }, [routeData]);

  // Mile markers — find first point that crosses each whole-mile boundary
  const mileMarkers = useMemo(() => {
    if (!routeData) return [];
    const markers: { coordinate: { latitude: number; longitude: number }; mile: number }[] = [];
    let nextMile = 1;
    for (const point of routeData.points) {
      if (point.distanceMiles >= nextMile) {
        markers.push({ coordinate: { latitude: point.latitude, longitude: point.longitude }, mile: nextMile });
        nextMile++;
        if (nextMile > 30) break; // safety cap for ultra-long routes
      }
    }
    return markers;
  }, [routeData]);

  // Fit camera to route after map renders
  const onMapReady = useCallback(() => {
    if (!routeData || !mapRef.current) return;
    const coords = routeData.points.map(p => ({
      latitude: p.latitude,
      longitude: p.longitude,
    }));
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 56, right: 20, bottom: 20, left: 20 },
      animated: false,
    });
  }, [routeData]);

  // ─── Fallback: no native maps ──────────────────────────────
  if (!MapView || !Polyline || !Marker) {
    return (
      <View style={[styles.placeholder, { height: MAP_HEIGHT }]}>
        <Text style={styles.placeholderText}>Map requires development build</Text>
        <Text style={styles.placeholderSub}>Not available in Expo Go</Text>
      </View>
    );
  }

  // ─── Fallback: no polyline data ────────────────────────────
  if (!polylineEncoded || !routeData) {
    return (
      <View style={[styles.placeholder, { height: MAP_HEIGHT }]}>
        <Text style={styles.placeholderText}>No route data</Text>
        <Text style={styles.placeholderSub}>Sync a recent activity to see the map</Text>
      </View>
    );
  }

  const legend = LEGEND[colorMode];

  return (
    <View style={styles.container}>
      {/* Map */}
      <View style={styles.mapWrapper}>
        <MapView
          ref={mapRef}
          style={styles.map}
          mapType="mutedStandard"
          initialRegion={initialRegion}
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
          {/* Route segments — each ColorSegment is a separate Polyline */}
          {segments.map((seg, i) => (
            <Polyline
              key={i}
              coordinates={seg.coordinates}
              strokeColor={seg.color}
              strokeWidth={4}
              lineCap="round"
              lineJoin="round"
            />
          ))}

          {/* Start marker — green dot */}
          <Marker coordinate={routeData.startPoint} anchor={{ x: 0.5, y: 0.5 }} flat>
            <View style={styles.startMarker} />
          </Marker>

          {/* End marker — red dot */}
          <Marker coordinate={routeData.endPoint} anchor={{ x: 0.5, y: 0.5 }} flat>
            <View style={styles.endMarker} />
          </Marker>

          {/* Mile markers — placed at each whole-mile point along the route */}
          {mileMarkers.map(m => (
            <Marker key={m.mile} coordinate={m.coordinate} anchor={{ x: 0.5, y: 0.5 }} flat>
              <View style={styles.mileMarker}>
                <Text style={styles.mileMarkerText}>{m.mile}</Text>
              </View>
            </Marker>
          ))}
        </MapView>

        {/* Mode toggle — overlaid at top of map */}
        <View style={styles.modeToggleBar}>
          {MODES.map(mode => (
            <Pressable
              key={mode.key}
              style={[styles.modeButton, colorMode === mode.key && styles.modeButtonActive]}
              onPress={() => setColorMode(mode.key)}
            >
              <Text style={[styles.modeButtonText, colorMode === mode.key && styles.modeButtonTextActive]}>
                {mode.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Legend */}
      {legend.length > 0 && (
        <View style={styles.legend}>
          {legend.map(item => (
            <View key={item.label} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: item.color }]} />
              <Text style={styles.legendLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  mapWrapper: {
    height: MAP_HEIGHT,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  map: {
    flex: 1,
  },
  // Mode toggle — floating pill bar overlaid on map top
  modeToggleBar: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  modeButtonText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: '#FFFFFF',
  },
  // Markers
  startMarker: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#34C759',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  endMarker: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF3B30',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  // Legend
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
  // Mile markers
  mileMarker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mileMarkerText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    lineHeight: 10,
  },
  // Placeholder
  placeholder: {
    marginVertical: 16,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  placeholderText: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  placeholderSub: {
    color: COLORS.textTertiary,
    fontSize: 13,
  },
});
