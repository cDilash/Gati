/**
 * colorEngine.ts — Pace/HR/Elevation zone coloring for route maps.
 *
 * Takes an array of RoutePoints (with pace, HR, elevation) and splits them
 * into ColorSegments — runs of consecutive points sharing the same zone.
 * Pre-smoothing with a moving average prevents hundreds of micro-segments
 * from noisy GPS/HR data.
 */

import { RoutePoint, ColorSegment } from './routeData';
import { PaceZones, HRZones } from '../types';
import { Coordinate } from './polyline';

// ─── Color Modes ───────────────────────────────────────────

export type ColorMode = 'pace' | 'heartrate' | 'elevation' | 'none';

// ─── Zone Color Palettes ────────────────────────────────────

export const PACE_ZONE_COLORS: Record<string, string> = {
  easy:        '#3B82F6',  // blue
  marathon:    '#22C55E',  // green
  threshold:   '#F59E0B',  // amber
  interval:    '#EF4444',  // red
  repetition:  '#A855F7',  // purple
  rest:        '#6B7280',  // gray (walking/stopped)
  unknown:     '#9CA3AF',  // light gray (GPS dropout)
};

export const HR_ZONE_COLORS: Record<string, string> = {
  zone1: '#3B82F6',  // blue  — very easy
  zone2: '#22C55E',  // green — aerobic
  zone3: '#F59E0B',  // amber — tempo
  zone4: '#EF4444',  // red   — threshold
  zone5: '#A855F7',  // purple — max
  unknown: '#9CA3AF',
};

export const ELEVATION_COLORS: Record<string, string> = {
  downhill: '#3B82F6',  // blue
  flat:     '#22C55E',  // green
  gentle:   '#F59E0B',  // amber
  steep:    '#EF4444',  // red
};

// ─── Smoothing ─────────────────────────────────────────────

/**
 * Apply a simple moving average to a numeric stream.
 * Reduces noise in pace/HR data so zone transitions are meaningful,
 * not artifact from momentary GPS or HR spikes.
 *
 * Null values are preserved — they represent GPS dropout or missing data.
 */
export function smoothStream(
  data: (number | null)[],
  windowSize: number = 5,
): (number | null)[] {
  if (data.length <= windowSize) return data;

  const half = Math.floor(windowSize / 2);
  return data.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(data.length - 1, i + half);
    const slice = data.slice(start, end + 1).filter(v => v !== null) as number[];
    if (slice.length === 0) return null;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

// ─── Segment Builder ───────────────────────────────────────

/**
 * Group consecutive route points sharing the same zone into ColorSegments.
 * Overlap the boundary point between segments so there are no visual gaps.
 */
function groupByZone(
  points: RoutePoint[],
  getZone: (p: RoutePoint, index: number) => string,
  getColor: (zone: string) => string,
): ColorSegment[] {
  if (points.length === 0) return [];

  const segments: ColorSegment[] = [];
  let currentZone = getZone(points[0], 0);
  let currentCoords: Coordinate[] = [{ latitude: points[0].latitude, longitude: points[0].longitude }];

  for (let i = 1; i < points.length; i++) {
    const zone = getZone(points[i], i);
    const coord: Coordinate = { latitude: points[i].latitude, longitude: points[i].longitude };

    if (zone === currentZone) {
      currentCoords.push(coord);
    } else {
      // Include the transition point in the outgoing segment to avoid gaps
      currentCoords.push(coord);
      segments.push({ coordinates: currentCoords, color: getColor(currentZone), zone: currentZone });
      currentZone = zone;
      currentCoords = [coord]; // New segment starts at same point
    }
  }

  if (currentCoords.length >= 2) {
    segments.push({ coordinates: currentCoords, color: getColor(currentZone), zone: currentZone });
  }

  return segments;
}

// ─── Pace Zone Coloring ─────────────────────────────────────

/**
 * Determine Daniels zone name from a pace (seconds per mile).
 * Zones are derived from the user's actual VDOT pace zones.
 *
 * Pace zones: paceZones.E.min = slowest easy pace (most seconds/mile)
 *             paceZones.R.max = fastest rep pace (fewest seconds/mile)
 */
function paceToZone(pace: number | null, paceZones: PaceZones): string {
  if (pace === null) return 'unknown';
  if (pace <= 0) return 'unknown';
  // Walking/stopped: slower than easy min by >2 min/mi
  if (pace > paceZones.E.min + 120) return 'rest';
  if (pace >= paceZones.E.max) return 'easy';
  if (pace >= paceZones.M.max) return 'marathon';
  if (pace >= paceZones.T.max) return 'threshold';
  if (pace >= paceZones.I.max) return 'interval';
  return 'repetition';
}

export function colorByPaceZone(
  points: RoutePoint[],
  paceZones: PaceZones,
): ColorSegment[] {
  // Smooth the pace stream before zone classification
  const paces = smoothStream(points.map(p => p.pace));
  const smoothedPoints = points.map((p, i) => ({ ...p, pace: paces[i] }));

  return groupByZone(
    smoothedPoints,
    (p) => paceToZone(p.pace, paceZones),
    zone => PACE_ZONE_COLORS[zone] ?? PACE_ZONE_COLORS.unknown,
  );
}

// ─── Heart Rate Zone Coloring ───────────────────────────────

function hrToZone(hr: number | null, hrZones: HRZones): string {
  if (hr === null) return 'unknown';
  if (hr >= hrZones.zone5.min) return 'zone5';
  if (hr >= hrZones.zone4.min) return 'zone4';
  if (hr >= hrZones.zone3.min) return 'zone3';
  if (hr >= hrZones.zone2.min) return 'zone2';
  return 'zone1';
}

export function colorByHRZone(
  points: RoutePoint[],
  hrZones: HRZones,
): ColorSegment[] {
  const hrs = smoothStream(points.map(p => p.heartRate));
  const smoothedPoints = points.map((p, i) => ({ ...p, heartRate: hrs[i] !== null ? Math.round(hrs[i]!) : null }));

  return groupByZone(
    smoothedPoints,
    (p) => hrToZone(p.heartRate, hrZones),
    zone => HR_ZONE_COLORS[zone] ?? HR_ZONE_COLORS.unknown,
  );
}

// ─── Elevation Gradient Coloring ────────────────────────────

/** Haversine distance between two lat/lng points in meters. */
function haversineMeters(a: Coordinate, b: Coordinate): number {
  const R = 6371000;
  const dLat = (b.latitude - a.latitude) * (Math.PI / 180);
  const dLng = (b.longitude - a.longitude) * (Math.PI / 180);
  const lat1 = a.latitude * (Math.PI / 180);
  const lat2 = b.latitude * (Math.PI / 180);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function gradeToZone(grade: number): string {
  if (grade < -2) return 'downhill';
  if (grade < 2)  return 'flat';
  if (grade < 5)  return 'gentle';
  return 'steep';
}

export function colorByElevation(points: RoutePoint[]): ColorSegment[] {
  if (points.length < 2) return [];

  // Calculate per-point grade (%) using elevation and haversine distance
  const grades: number[] = points.map((p, i) => {
    if (i === 0) return 0;
    const prev = points[i - 1];
    const elevDelta = (p.elevation ?? 0) - (prev.elevation ?? 0);
    const distM = haversineMeters(prev, p);
    if (distM < 1) return 0; // Avoid divide-by-zero on duplicate points
    return (elevDelta / distM) * 100;
  });

  // Smooth grades to reduce GPS noise
  const smoothedGrades = smoothStream(grades).map(g => g ?? 0);

  const gradeByIdx = smoothedGrades;

  return groupByZone(
    points,
    (_p, i) => gradeToZone(gradeByIdx[i] ?? 0),
    zone => ELEVATION_COLORS[zone] ?? ELEVATION_COLORS.flat,
  );
}

// ─── Plain (single color) ───────────────────────────────────

function colorPlain(points: RoutePoint[]): ColorSegment[] {
  if (points.length < 2) return [];
  return [{
    coordinates: points.map(p => ({ latitude: p.latitude, longitude: p.longitude } as Coordinate)),
    color: '#007AFF',
    zone: 'plain',
  }];
}

// ─── Main Export ────────────────────────────────────────────

/**
 * Generate color segments for a route given a display mode.
 *
 * @param points    Route points from buildRouteData()
 * @param mode      Which data channel to color by
 * @param paceZones User's Daniels pace zones
 * @param hrZones   User's Karvonen HR zones
 */
export function generateColorSegments(
  points: RoutePoint[],
  mode: ColorMode,
  paceZones: PaceZones,
  hrZones: HRZones,
): ColorSegment[] {
  if (points.length < 2) return [];

  switch (mode) {
    case 'pace':      return colorByPaceZone(points, paceZones);
    case 'heartrate': return colorByHRZone(points, hrZones);
    case 'elevation': return colorByElevation(points);
    case 'none':      return colorPlain(points);
    default:          return colorPlain(points);
  }
}
